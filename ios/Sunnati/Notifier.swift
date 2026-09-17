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

  /* The page hands over the whole list each time, so the old ones go first:
     rescheduling must not leave yesterday's reminders behind. Reminders and
     adhans are cleared separately, since each has its own bridge. */
  func replace(_ items: [Reminder], prefix: String) {
    centre.getPendingNotificationRequests { pending in
      let mine = pending.map(\.identifier).filter { $0.hasPrefix(prefix) }
      self.centre.removePendingNotificationRequests(withIdentifiers: mine)
      for (i, item) in items.enumerated() where item.at > Date() {
        let body = UNMutableNotificationContent()
        body.title = item.title
        body.body = item.text
        body.sound = item.chime.sound
        let parts = Calendar.current.dateComponents(
          [.year, .month, .day, .hour, .minute], from: item.at)
        let when = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        centre.add(UNNotificationRequest(identifier: "\(prefix)\(i)", content: body, trigger: when))
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
