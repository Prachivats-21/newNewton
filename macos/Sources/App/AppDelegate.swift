import AppKit

public final class AppDelegate: NSObject, NSApplicationDelegate {
    private var menuBarController: MenuBarController?

    public func applicationDidFinishLaunching(_ notification: Notification) {
        // Set up the menu bar item
        menuBarController = MenuBarController()

        // Background fetch of latest menu on launch
        Task {
            await MenuDataManager.shared.refreshFromRemote()
        }
    }

    public func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        return true
    }
}
