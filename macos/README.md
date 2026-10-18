# Newton Widgets for macOS

A lightweight, native, and headless macOS application that provides home screen / desktop widgets for Rishihood University campus life, starting with the **Campus Mess Menu Widget**.

---

## 🌟 Features

- **Native macOS Desktop & Home Screen Widget (WidgetKit)**:
  - Built using Apple's modern **WidgetKit**, **SwiftUI**, and **AppIntents**.
  - Available in **Medium**, **Large**, and **Extra Large** sizes.
  - Can be added directly to your macOS Desktop or Notification Center.
- **Interactive Day Navigation (`<` and `>`)**:
  - Top buttons let you flip to previous days or next days with instant updates.
  - Includes a quick **Reset** button to return to today's menu at any time.
- **Smart Meal Status**:
  - Real-time detection of whether breakfast, lunch, snacks, or dinner is currently being served.
  - Visual color badges and icons for each meal period.
- **Dual Mode (Native WidgetKit + Floating Desktop Panel)**:
  - **Native Widget**: Place it permanently on your Desktop via macOS's native Widget Gallery.
  - **Floating Desktop Window**: Click the menu bar icon (`fork.knife`) -> *Open Floating Desktop Widget* for a translucent, movable floating widget directly on your screen.
- **Reliable Data Sync**:
  - Automatically loads from the bundled `menu.json`.
  - Background auto-refresh fetches the latest menu from GitHub raw JSON (`https://raw.githubusercontent.com/suwupnil/newNewton/main/menu.json`).
  - Works 100% offline with persistent disk caching.

---

## 🛠️ Architecture & Structure

```text
macos/
├── build.sh                                  # Automated compiler, packager, and codesigner
├── README.md                                 # Documentation
├── Resources/
│   ├── App-Info.plist                        # Container App Info.plist (LSUIElement = true)
│   ├── Extension-Info.plist                  # WidgetKit Extension Info.plist
│   ├── App.entitlements                      # Sandbox & Network entitlements
│   ├── Extension.entitlements                # WidgetKit Extension entitlements
│   └── menu.json                             # Bundled offline campus mess menu
└── Sources/
    ├── Shared/
    │   ├── MenuModel.swift                   # Daily & Weekly menu models, meal times
    │   ├── MenuDataManager.swift             # Storage, caching, day offsets, & remote sync
    │   └── DayIntents.swift                  # AppIntents for interactive widget buttons
    ├── App/
    │   ├── AppDelegate.swift                 # Container lifecycle and background sync
    │   ├── DesktopWidgetWindow.swift         # Floating desktop panel window
    │   ├── MenuBarController.swift           # Menu bar status icon and actions
    │   └── MainApp.swift                     # Container app entry point
    └── Widgets/
        ├── MessMenuView.swift                # SwiftUI widget views (Compact & Full grid)
        ├── MessMenuWidget.swift              # WidgetKit timeline provider and configuration
        └── NewtonWidgetsBundle.swift         # WidgetBundle supporting multiple widgets
```

---

## 🚀 Building and Running

You can compile, package, and launch the application with a single command from the project root:

```bash
# Build the application and widget extension
./macos/build.sh

# Build and launch immediately
./macos/build.sh --run

# Build and install to /Applications/NewtonEnhancer.app
./macos/build.sh --install
```

---

## 📱 How to Add the Widget to Your macOS Desktop (Home Screen)

1. Make sure the app is running (you will see the small `fork.knife` icon in your top macOS menu bar).
2. Right-click anywhere on an empty area of your **Desktop wallpaper**.
3. Click **"Edit Widgets…"** from the menu.
4. Search for **"Newton"** or **"Campus Mess Menu"** in the widget gallery.
5. Choose your preferred size:
   - **Medium**: Shows active/upcoming meals with quick navigation buttons.
   - **Large**: Full 2x2 grid showing Breakfast, Lunch, Snacks, and Dinner with food items and active badges.
6. Drag the widget onto your desktop!

---

## 💡 Adding More Widgets in the Future

The project is structured with an extensible `WidgetBundle` in [`NewtonWidgetsBundle.swift`](Sources/Widgets/NewtonWidgetsBundle.swift). To add more widgets (such as an **Attendance Tracker Widget** or **Quizzes Widget**):
1. Create your new Widget struct conforming to `Widget` in `Sources/Widgets/`.
2. Add it to `NewtonWidgetsBundle.body`.
3. Re-run `./macos/build.sh`!
