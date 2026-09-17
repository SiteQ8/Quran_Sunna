import UIKit
import UserNotifications

/* سُنّتي on iOS. The app is the same site the reader already uses; what the
   wrapper adds is what a web page cannot do on a phone: notifications that
   arrive with the app closed, each with the sound the reader chose, and the
   adhan at its time for their place. Apple turns away a wrapper that only
   opens a website, and it would deserve turning away: the value here is the
   scheduling, not the frame. */
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(_ app: UIApplication,
                   didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    UNUserNotificationCenter.current().delegate = Notifier.shared
    let w = UIWindow(frame: UIScreen.main.bounds)
    w.rootViewController = ReaderController()
    w.makeKeyAndVisible()
    window = w
    return true
  }
}
