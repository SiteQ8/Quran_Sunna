import Foundation
import UserNotifications

/* Every reminder the page schedules becomes a local notification here. Three
   sounds, matching what android does: the phone's own tone, the app's quiet
   chime, and silence. iOS decides a notification is silent by being handed no
   sound at all, so «silent» is the absence of one rather than a sound file
   that happens to be quiet. */
enum Chime: String {
  case device, chime, silent

  var sound: UNNotificationSound? {
    switch self {
    case .device: return .default
    case .chime:  return UNNotificationSound(named: UNNotificationSoundName("chime.caf"))
    case .silent: return nil
    }
  }
}

final class Notifier: NSObject, UNUserNotificationCenterDelegate {
  static let shared = Notifier()
  private let centre = UNUserNotificationCenter.current()

  func ask(_ done: @escaping (Bool) -> Void) {
    centre.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
      DispatchQueue.main.async { done(ok) }
    }
  }

  /* iOS keeps at most sixty four pending notifications for an app and drops
     anything past that without saying so. The page sends more than ninety when
     every reminder is on: a week of prayers, a week of qiyam, and fifty odd
     reminders. So each kind gets a share of the sixty four rather than one
     kind quietly eating it and the others vanishing. The nearest ones are
     kept, since the app reschedules whenever it opens. */
  private static let room = 64
  private static let share = ["adhan-": 25, "remind-": 32, "qiyam-": 7]

  /* The page hands over the whole list each time, so the old ones go first:
     rescheduling must not leave yesterday's reminders behind. Reminders and
     adhans are cleared separately, since each has its own bridge. */
  func replace(_ items: [Reminder], prefix: String) {
    centre.getPendingNotificationRequests { pending in
      let mine = pending.map(\.identifier).filter { $0.hasPrefix(prefix) }
      self.centre.removePendingNotificationRequests(withIdentifiers: mine)
      let keep = Notifier.share[prefix] ?? 16
      let soonest = items.filter { $0.at > Date() }.sorted { $0.at < $1.at }.prefix(keep)
      for (i, item) in soonest.enumerated() {
        let body = UNMutableNotificationContent()
        body.title = item.title
        body.body = item.text
        body.sound = Notifier.sound(for: item)
        if !item.kind.isEmpty { body.userInfo = ["kind": item.kind] }
        let parts = Calendar.current.dateComponents(
          [.year, .month, .day, .hour, .minute], from: item.at)
        let when = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        self.centre.add(UNNotificationRequest(identifier: "\(prefix)\(i)", content: body, trigger: when))
      }
    }
  }

  /* The sound a notification carries. Silence is silence whatever else is
     named, a muadhin's clip is used where one is named, and otherwise the
     choice of the three. A named file that is not in the bundle falls back to
     the phone's own tone, which is iOS's doing and not a silence. */
  static func sound(for item: Reminder) -> UNNotificationSound? {
    if item.chime == .silent { return nil }
    if let named = item.sound, !named.isEmpty {
      return UNNotificationSound(named: UNNotificationSoundName(named))
    }
    return item.chime.sound
  }

  /* The page hands over the address of the adhan it would play, and the app
     carries a clip of each muadhin under adhan-<id>.caf, cut to 29 seconds
     since iOS plays nothing longer than 30 as a notification. The fajr and the
     ordinary adhan of one muadhin open the same way, so one clip serves both. */
  static func adhanClip(_ address: String) -> String? {
    guard let last = address.split(separator: "/").last, last.hasSuffix(".mp3") else { return nil }
    var id = String(last.dropLast(4))
    if id.hasSuffix("-fajr") { id = String(id.dropLast(5)) }
    guard !id.isEmpty, id.allSatisfy({ $0.isLetter }) else { return nil }
    return "adhan-\(id).caf"
  }

  /* iOS hides a notification while its own app is in front, which would mean a
     reader looking at the app never sees the adhan arrive. */
  func userNotificationCenter(_ c: UNUserNotificationCenter,
                              willPresent n: UNNotification,
                              withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound])
  }

  /* A tapped notification. There was no handler for this at all, so tapping a
     morning adhkar reminder opened the app whereever the reader had left it
     and said nothing more about the adhkar. The kind is handed to the page,
     which knows which screen belongs to it. */
  func userNotificationCenter(_ c: UNUserNotificationCenter,
                              didReceive response: UNNotificationResponse,
                              withCompletionHandler done: @escaping () -> Void) {
    let kind = response.notification.request.content.userInfo["kind"] as? String ?? ""
    if !kind.isEmpty {
      if let tell = onTap { tell(kind) } else { waiting = kind }
    }
    done()
  }

  /* Set by the reader once its web view exists. Held here rather than reached
     for, so the notifier knows nothing about the view it is talking to.

     With a scene the window is made after launch rather than during it, so a
     tap that started the app can arrive before the reader is there to hear
     it. It is held until the reader sets this, and handed over then. */
  var onTap: ((String) -> Void)? {
    didSet {
      if let tell = onTap, let kind = waiting { waiting = nil; tell(kind) }
    }
  }
  private var waiting: String?
}

struct Reminder {
  let at: Date
  let title: String
  let text: String
  let chime: Chime
  /* which reminder this is, carried through to the notification so a tap can
     open the app on its own subject rather than wherever it was last left */
  var kind: String = ""
  /* a sound file in the bundle, for the adhan in the muadhin's own voice */
  var sound: String? = nil
}
