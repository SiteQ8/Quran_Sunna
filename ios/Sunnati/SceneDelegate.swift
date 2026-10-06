import UIKit

/* The window lives in a scene now, not in the app delegate.

   Built with the iOS 27 SDK, an app that still makes its own window at launch
   stops on a trap inside UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption
   before anything is drawn. iPhone Duo is built for with Xcode 27.1, so this
   is the door to it: without a scene the app cannot be built for the phone
   that folds at all. It changes nothing on the phones the app runs on today;
   scenes have been there since iOS 13 and the app asks for iOS 15.

   The window is made from the scene and never from the size of the screen.
   On iPhone Duo the app moves between two displays as the phone opens and
   closes, and the scene is what carries the size it is given. */
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
             options connection: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let w = UIWindow(windowScene: windowScene)
    w.rootViewController = ReaderController()
    w.makeKeyAndVisible()
    window = w
    /* a cold start from a link comes with the connection, not as a call */
    if let url = connection.urlContexts.first?.url { open(url) }
  }

  /* sunnati://screen/<name>, which the app delegate used to answer */
  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    if let url = contexts.first?.url { open(url) }
  }

  private func open(_ url: URL) {
    guard url.scheme == "sunnati", url.host == "screen" else { return }
    (window?.rootViewController as? ReaderController)?.show(url.lastPathComponent)
  }
}
