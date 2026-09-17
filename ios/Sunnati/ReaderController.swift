import UIKit
import WebKit
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
final class ReaderController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
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
    let bridge = """
    window.SunnatiApp = new Proxy({}, {
      get: function (_, name) {
        return function () {
          var args = Array.prototype.slice.call(arguments);
          window.webkit.messageHandlers.sunnati.postMessage({ fn: String(name), args: args });
          return undefined;
        };
      },
      has: function () { return true; }
    });
    """
    setup.userContentController.add(self, name: "sunnati")
    setup.userContentController.addUserScript(
      WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))

    web = WKWebView(frame: view.bounds, configuration: setup)
    web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    web.navigationDelegate = self
    web.scrollView.contentInsetAdjustmentBehavior = .never
    view.addSubview(web)
    web.load(URLRequest(url: site))

    /* the adhan and the recitations must keep sounding with the screen off */
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
    try? AVAudioSession.sharedInstance().setActive(true)

    Notifier.shared.ask { _ in }

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

    default:
      /* setAdhanSilent, setSalawatEvery and the rest are carried in the list
         the page already sends, so there is nothing separate to do for them */
      break
    }
  }

  private var adhanSilent = false
  private var lastPrayers: [Reminder] = []

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
  func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler done: @escaping (WKNavigationActionPolicy) -> Void) {
    if let url = action.request.url, url.host != site.host, action.navigationType == .linkActivated {
      UIApplication.shared.open(url)
      done(.cancel)
      return
    }
    done(.allow)
  }

  override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
}
