import AppKit
import SwiftUI

public final class MenuBarController: NSObject {
    private var statusItem: NSStatusItem!
    private var menu: NSMenu!

    public override init() {
        super.init()
        setupStatusItem()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "fork.knife", accessibilityDescription: "Newton Mess Menu")
            button.imagePosition = .imageLeft
        }

        buildMenu()
    }

    public func buildMenu() {
        menu = NSMenu()

        // 1. Title item
        let titleItem = NSMenuItem(title: "Newton Widgets", action: nil, keyEquivalent: "")
        titleItem.isEnabled = false
        menu.addItem(titleItem)

        // 2. Current Status
        let (currentMeal, nextMeal) = MealType.status()
        let (day, _, _) = MenuDataManager.shared.loadMenuForSelectedDay()

        let statusText: String
        if let current = currentMeal {
            statusText = "\(day.rawValue) • Serving Now: \(current.rawValue)"
        } else if let next = nextMeal {
            statusText = "\(day.rawValue) • Next Up: \(next.rawValue)"
        } else {
            statusText = "\(day.rawValue) • Campus Mess"
        }

        let statusMenuItem = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
        statusMenuItem.image = NSImage(systemSymbolName: "clock.fill", accessibilityDescription: nil)
        menu.addItem(statusMenuItem)

        menu.addItem(NSMenuItem.separator())

        // 3. Instructions for macOS Desktop WidgetKit widget
        let guideItem = NSMenuItem(title: "How to Add to Desktop / Home Screen…", action: #selector(showWidgetGuide), keyEquivalent: "w")
        guideItem.target = self
        guideItem.image = NSImage(systemSymbolName: "plus.rectangle.on.rectangle", accessibilityDescription: nil)
        menu.addItem(guideItem)

        // 5. Refresh Menu
        let refreshItem = NSMenuItem(title: "Refresh Menu from GitHub", action: #selector(refreshMenu), keyEquivalent: "r")
        refreshItem.target = self
        refreshItem.image = NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: nil)
        menu.addItem(refreshItem)

        menu.addItem(NSMenuItem.separator())

        // 6. Quit
        let quitItem = NSMenuItem(title: "Quit Newton Widgets", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    @objc private func showWidgetGuide() {
        let alert = NSAlert()
        alert.messageText = "How to add Newton Widget to your Desktop"
        alert.informativeText = """
        1. Right-click anywhere on your macOS Desktop wallpaper.
        2. Click 'Edit Widgets…' from the contextual menu.
        3. Search for 'Newton' or 'Campus Mess Menu' in the widget gallery.
        4. Select your preferred size (Medium, Large, or Extra Large) and drag it directly onto your desktop home screen!

        Note: You can use the top buttons (< and >) directly on the widget to view meals for previous or next days.
        """
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Got it!")
        alert.runModal()
    }

    @objc private func refreshMenu() {
        Task {
            let success = await MenuDataManager.shared.refreshFromRemote()
            await MainActor.run {
                self.buildMenu()
                let alert = NSAlert()
                alert.messageText = success ? "Menu Updated!" : "Could not reach GitHub"
                alert.informativeText = success
                    ? "The mess menu has been refreshed with the latest data from GitHub and widget timelines have been updated."
                    : "Using the cached/offline menu. Please check your internet connection."
                alert.alertStyle = success ? .informational : .warning
                alert.addButton(withTitle: "OK")
                alert.runModal()
            }
        }
    }

    @objc private func quitApp() {
        NSApplication.shared.terminate(nil)
    }
}
