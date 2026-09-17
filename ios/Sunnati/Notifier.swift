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
        body.sound = item.chime.sound
        let parts = Calendar.current.dateComponents(
          [.year, .month, .day, .hour, .minute], from: item.at)
        let when = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        self.centre.add(UNNotificationRequest(identifier: "\(prefix)\(i)", content: body, trigger: when))
      }
    }
  }

  /* iOS hides a notification while its own app is in front, which would mean a
     reader looking at the app never sees the adhan arrive. */
  func userNotificationCenter(_ c: UNUserNotificationCenter,
                              willPresent n: UNNotification,
                              withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound])
  }
}

struct Reminder {
  let at: Date
  let title: String
  let text: String
  let chime: Chime
}
