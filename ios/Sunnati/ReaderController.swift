import UIKit
import WebKit
import UserNotifications
import AVFoundation
import WidgetKit

/* wrapped so the app still builds where WidgetKit is missing */
enum WidgetCentre {
  static func reload() {
    if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
  }
}

/* The site in a web view, plus the bridge the page already talks to. Android
   exposes SunnatiApp with seventeen methods; the page checks for each before
   calling it, so iOS answers the ones a phone can honour and stays quiet about
   the rest rather than pretending. */
final class ReaderController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UIDocumentInteractionControllerDelegate {
  private let site = URL(string: "https://sunnati.3li.info/")!
  private var web: WKWebView!
  private var player: AVAudioPlayer?

  override func viewDidLoad() {
    super.viewDidLoad()
    let setup = WKWebViewConfiguration()
    setup.allowsInlineMediaPlayback = true
    setup.mediaTypesRequiringUserActionForPlayback = []

    /* The page calls SunnatiApp.someMethod(...); each call is posted here as a
       message naming the method and its arguments. Declaring it before the
       page loads means the page finds the bridge on its first look. */
    /* While the store screenshots are taken the page must not ask for the
       location: the system dialog then stands in the middle of every picture.
       Passing -shooting removes the geolocation api before the page loads, so
       the page falls back to the city it already knows and asks nobody. */
    if ProcessInfo.processInfo.arguments.contains("-shooting") {
      /* and the page must not offer to set the place either: GitHub's mac is
         not in Kuwait, so the page saw a foreign zone and laid its banner
         across the bottom of every picture. It is marked as already asked. */
      let hide = """
      try { Object.defineProperty(navigator, 'geolocation', { get: function () { return undefined; } }); } catch (e) {}
      try {
        var k = 'sunnati.settings';
        var s = JSON.parse(localStorage.getItem(k) || '{}');
        s.placeAsked = true;
        localStorage.setItem(k, JSON.stringify(s));
      } catch (e) {}
      """
      setup.userContentController.addUserScript(
        WKUserScript(source: hide, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    /* The bridge names only what this wrapper answers. It used to be a Proxy
       that said yes to every name and then did nothing for most of them: the
       page saw openMap, addToCalendar, shareImage and saveFile and called them
       instead of its own web fallbacks, and each call fell into silence, or
       into a toast saying the app had failed. canNotify came back undefined
       and the page read that as notifications being off. And version came
       back undefined, so the about screen printed «حزمة أندرويد» with no
       number on an iPhone. What is not here the page handles itself. */
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    let bridge = """
    (function () {
      function send(name, args) {
        try { window.webkit.messageHandlers.sunnati.postMessage({ fn: name, args: args }); } catch (e) {}
        return true;
      }
      function call(name) { return function () { return send(name, Array.prototype.slice.call(arguments)); }; }
      window.SunnatiApp = {
        __canNotify: true,
        platform: function () { return 'ios'; },
        version: function () { return '\(version)'; },
        canNotify: function () { return window.SunnatiApp.__canNotify !== false; },
        setReminders: call('setReminders'),
        setQiyamTimes: call('setQiyamTimes'),
        setPrayerTimes: call('setPrayerTimes'),
        setAdhanSilent: call('setAdhanSilent'),
        shareText: call('shareText'),
        shareImage: call('shareImage'),
        shareImageWithText: call('shareImageWithText'),
        saveFile: call('saveFile'),
        saveAndOpen: call('saveFile'),
        openMap: call('openMap'),
        addToCalendar: call('addToCalendar')
      };
    }());
    """
    setup.userContentController.add(self, name: "sunnati")
    setup.userContentController.addUserScript(
      WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))

    /* The page is shared with the web, where Safari ignores user-scalable
       anyway. WKWebView honours it, so it is added here alone: an app does
       not pinch, and this one has its own text size in its settings. */
    let noZoom = """
    (function () {
      var m = document.querySelector('meta[name=viewport]');
      if (m) m.setAttribute('content', m.getAttribute('content') + ',maximum-scale=1,user-scalable=no');
    }());
    """
    setup.userContentController.addUserScript(
      WKUserScript(source: noZoom, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

    /* App-bound domains: without this WKWebView refuses to run a service
       worker, so the page could neither work offline nor notice a new
       version, and it waited on the http cache for every fix. The domain is
       listed in Info.plist under WKAppBoundDomains. */
    setup.limitsNavigationsToAppBoundDomains = true

    web = WKWebView(frame: view.bounds, configuration: setup)
    web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    web.navigationDelegate = self
    web.uiDelegate = self
    web.scrollView.contentInsetAdjustmentBehavior = .never
    /* three habits of a browser that make an app feel like a web page */
    web.scrollView.bounces = false
    web.allowsLinkPreview = false
    web.allowsBackForwardNavigationGestures = false
    view.addSubview(web)
    web.load(URLRequest(url: site))

    /* the adhan and the recitations must keep sounding with the screen off */
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
    try? AVAudioSession.sharedInstance().setActive(true)

    /* Not while the store screenshots are taken: simctl can grant location
       but has no way to grant notifications, so the question stood in the
       middle of all six pictures, and a permission dialog in a screenshot is
       a rejection. */
    if !ProcessInfo.processInfo.arguments.contains("-shooting") {
      Notifier.shared.ask { _ in }
    }

    /* The page schedules a week ahead and then goes quiet. Without this the
       reminders run out for anyone who does not open the app, which is exactly
       the reader the notifications were for. Coming back to the app makes the
       page recompute, and its bridge calls land here again. */
    NotificationCenter.default.addObserver(
      self, selector: #selector(refresh),
      name: UIApplication.willEnterForegroundNotification, object: nil)
  }

  /* Opening sunnati://screen/quran moves the page to that screen. It exists so
     the store screenshots can be taken without pretending to be a finger:
     simctl has no tap command, and guessing pixel positions for a tab bar is
     the kind of thing that silently photographs the same screen six times. */
  func show(_ view: String) {
    let safe = view.filter { $0.isLetter }
    web.evaluateJavaScript("window.App && App.go && App.go('\(safe)')")
  }

  @objc private func refresh() {
    tellCanNotify()
    /* the four bridges the page schedules through, called by name rather than
       through a render pass that may or may not reach them */
    let js = "(function(){var h=window.App&&window.App.helpers;if(!h)return;"
      + "if(h.handTimesToApp)h.handTimesToApp();"
      + "if(h.handRemindersToApp)h.handRemindersToApp();"
      + "if(h.handQiyamToApp)h.handQiyamToApp();"
      + "if(h.handSalawatToApp)h.handSalawatToApp();}());"
    web.evaluateJavaScript(js)
  }

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let call = message.body as? [String: Any],
          let fn = call["fn"] as? String else { return }
    let args = call["args"] as? [Any] ?? []

    switch fn {
    case "setReminders":
      guard let json = args.first as? String else { return }
      Notifier.shared.replace(parse(json), prefix: "remind-")

    case "setQiyamTimes":
      guard let json = args.first as? String else { return }
      Notifier.shared.replace(parse(json), prefix: "qiyam-")

    case "setPrayerTimes":
      guard let json = args.first as? String else { return }
      /* prayer times come as {at, name}, not the {at, t, b, s} a reminder uses:
         reading them with the reminder parser lost every name and left every
         adhan on the default sound */
      let times = parsePrayers(json)
      Notifier.shared.replace(times, prefix: "adhan-")
      shareWithWidget(times)

    case "setAdhanSilent":
      adhanSilent = (args.first as? Bool) ?? ((args.first as? Int) == 1)
      /* the times were scheduled before this arrived, so they are rebuilt with
         the sound the reader actually chose */
      Notifier.shared.replace(lastPrayers, prefix: "adhan-")

    case "shareText":
      guard let text = args.first as? String else { return }
      let sheet = UIActivityViewController(activityItems: [text], applicationActivities: nil)
      sheet.popoverPresentationController?.sourceView = view
      present(sheet, animated: true)

    case "canNotify":
      break

    /* the image the page drew of an ayah or a dua, as a data url */
    case "shareImage", "shareImageWithText":
      guard let dataUrl = args.first as? String else { return }
      var items: [Any] = []
      if let comma = dataUrl.firstIndex(of: ","),
         let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])),
         let image = UIImage(data: data) {
        items.append(image)
      }
      if fn == "shareImageWithText", args.count > 2, let words = args[2] as? String, !words.isEmpty {
        items.append(words)
      }
      guard !items.isEmpty else { return }
      let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
      sheet.popoverPresentationController?.sourceView = view
      present(sheet, animated: true)

    /* the backup: written to a temporary file and handed to Files, so it can
       be kept in iCloud Drive or sent on rather than lost with the phone */
    case "saveFile":
      guard args.count > 1, let name = args[0] as? String, let text = args[1] as? String else { return }
      let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
      do { try text.write(to: url, atomically: true, encoding: .utf8) } catch { return }
      let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
      present(picker, animated: true)

    /* directions in Apple Maps, from the coordinates the page passes */
    case "openMap":
      let coords = args.count > 1 ? (args[1] as? String ?? "") : ""
      var target: URL?
      if !coords.isEmpty, let u = URL(string: "maps://?daddr=\(coords)&dirflg=d") { target = u }
      else if let raw = args.first as? String, let u = URL(string: raw) { target = u }
      if let u = target { UIApplication.shared.open(u) }

    /* an .ics previewed by the system, whose sheet offers «Add to Calendar»
       with no calendar permission asked of the app itself */
    case "addToCalendar":
      guard args.count > 3, let name = args[0] as? String,
            let start = args[2] as? Double, let end = args[3] as? Double else { return }
      let note = (args[1] as? String ?? "").replacingOccurrences(of: "\n", with: "\\n")
      let f = DateFormatter(); f.dateFormat = "yyyyMMdd"; f.timeZone = TimeZone(identifier: "UTC")
      let s = f.string(from: Date(timeIntervalSince1970: start / 1000))
      let e = f.string(from: Date(timeIntervalSince1970: end / 1000))
      let ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//sunnati//ar", "BEGIN:VEVENT",
                 "UID:\(s)-sunnati@3li.info", "DTSTART;VALUE=DATE:\(s)", "DTEND;VALUE=DATE:\(e)",
                 "SUMMARY:\(name)", "DESCRIPTION:\(note)", "END:VEVENT", "END:VCALENDAR"].joined(separator: "\r\n")
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("sunnati-\(s).ics")
      do { try ics.write(to: url, atomically: true, encoding: .utf8) } catch { return }
      preview = UIDocumentInteractionController(url: url)
      preview?.delegate = self
      preview?.presentPreview(animated: true)

    default:
      /* setAdhanSilent, setSalawatEvery and the rest are carried in the list
         the page already sends, so there is nothing separate to do for them */
      break
    }
  }

  private var adhanSilent = false
  private var lastPrayers: [Reminder] = []
  private var preview: UIDocumentInteractionController?

  func documentInteractionControllerViewControllerForPreview(_ c: UIDocumentInteractionController) -> UIViewController { self }

  /* window.open from the page, which is how it reaches a map or a site: a web
     view with no ui delegate returns null and nothing happens. It opens in
     the phone's own browser or app instead. */
  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { UIApplication.shared.open(url) }
    return nil
  }

  /* whether notifications are allowed, told to the page rather than guessed:
     the page shows «الإشعارات مغلقة» when this says so, and undefined used
     to read as closed on every phone */
  private func tellCanNotify() {
    UNUserNotificationCenter.current().getNotificationSettings { s in
      let ok = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
      DispatchQueue.main.async {
        self.web.evaluateJavaScript("window.SunnatiApp && (window.SunnatiApp.__canNotify = \(ok))")
      }
    }
  }

  /* The prayer list is its own shape: {at, name}. Each becomes a notification
     titled with the prayer, silent or not as the reader asked. */
  private func parsePrayers(_ json: String) -> [Reminder] {
    guard let data = json.data(using: .utf8),
          let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    lastPrayers = rows.compactMap { row in
      guard let ms = row["at"] as? Double else { return nil }
      return Reminder(
        at: Date(timeIntervalSince1970: ms / 1000),
        title: row["name"] as? String ?? "الصلاة",
        text: "حان وقت الصلاة",
        chime: adhanSilent ? .silent : .device)
    }
    return lastPrayers
  }

  /* The page sends a list of {at, t, b, s}: when in milliseconds, a title, a
     line of text, and which of the three sounds. */
  private func parse(_ json: String) -> [Reminder] {
    guard let data = json.data(using: .utf8),
          let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    return rows.compactMap { row in
      guard let ms = row["at"] as? Double else { return nil }
      return Reminder(
        at: Date(timeIntervalSince1970: ms / 1000),
        title: row["t"] as? String ?? "سُنّتي",
        text: row["b"] as? String ?? "",
        chime: Chime(rawValue: row["s"] as? String ?? "device") ?? .device)
    }
  }

  /* The widget shows the same times the reader sees, so the app hands them
     over rather than letting the widget compute its own and drift. */
  private func shareWithWidget(_ times: [Reminder]) {
    guard let store = UserDefaults(suiteName: "group.com.eworldq8.sunnati") else { return }
    let payload = [
      "names": times.map(\.title),
      "at": times.map { $0.at.timeIntervalSince1970 }
    ] as [String: Any]
    if let data = try? JSONSerialization.data(withJSONObject: payload) {
      store.set(data, forKey: "times")
      WidgetCentre.reload()
    }
  }

  /* links to other sites open in the phone's browser, not inside the app */
  /* Once the page has loaded, open whichever screen was named on the command
     line. The screenshot job passes -screen azkar and so on; a url scheme made
     iOS ask "Open in سُنّتي?" first, and that dialog then sat in the middle of
     every photograph. A launch argument asks nobody. */
  func webView(_ w: WKWebView, didFinish navigation: WKNavigation!) {
    tellCanNotify()
    let args = ProcessInfo.processInfo.arguments
    guard let i = args.firstIndex(of: "-screen"), i + 1 < args.count else { return }
    let name = args[i + 1].filter { $0.isLetter }
    /* the page settles after loading, so the screen is asked for a moment later */
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.show(name) }
  }

  func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler done: @escaping (WKNavigationActionPolicy) -> Void) {
    /* any move to another site leaves the app, however the page asked for
       it: a link, a location change, a form. Only tapped links used to, and
       the rest either loaded inside the wrapper or, now that navigation is
       bound to the app's domain, were refused outright. */
    if let url = action.request.url, let host = url.host, host != site.host,
       ["http", "https", "mailto", "tel", "maps"].contains(url.scheme ?? "") {
      UIApplication.shared.open(url)
      done(.cancel)
      return
    }
    done(.allow)
  }

  override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
}
