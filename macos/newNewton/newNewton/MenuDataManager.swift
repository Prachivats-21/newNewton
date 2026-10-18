import Foundation
import SwiftUI
#if canImport(WidgetKit)
import WidgetKit
#endif

public final class MenuDataManager: @unchecked Sendable {
    public static let shared = MenuDataManager()

    private let appGroupID = "group.com.newton.enhancer"
    private let remoteMenuURL = URL(string: "https://raw.githubusercontent.com/suwupnil/newNewton/main/menu.json")!
    private let dayOffsetKey = "newton_menu_day_offset"
    private let selectedDayKey = "newton_menu_selected_day"
    private let mealKey = "newton_menu_meal_override"
    private let lastUpdatedKey = "newton_menu_last_updated"
    private let memoryLock = NSLock()

    private var inMemoryCache: WeeklyMenu?
    private var inMemoryDayOffset: Int = 0
    private var inMemorySelectedDay: DayOfWeek?
    private var inMemoryMealOverride: MealType?

    private init() {
        self.inMemoryDayOffset = defaults.integer(forKey: dayOffsetKey)
        if let savedDay = defaults.string(forKey: selectedDayKey),
           let day = DayOfWeek(rawValue: savedDay) {
            self.inMemorySelectedDay = day
        }
        if let savedMeal = defaults.string(forKey: mealKey),
           let meal = MealType(rawValue: savedMeal) {
            self.inMemoryMealOverride = meal
        }
    }

    private var defaults: UserDefaults {
        if let groupDefaults = UserDefaults(suiteName: appGroupID) {
            return groupDefaults
        }
        return UserDefaults.standard
    }

    private var cacheFileURL: URL {
        let fileManager = FileManager.default
        if let groupURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupID) {
            return groupURL.appendingPathComponent("menu.json")
        }
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let newtonDir = appSupport.appendingPathComponent("com.newton.enhancer", isDirectory: true)
        try? fileManager.createDirectory(at: newtonDir, withIntermediateDirectories: true)
        return newtonDir.appendingPathComponent("menu.json")
    }

    // MARK: - Day Navigation
    public func selectDay(_ day: DayOfWeek) {
        memoryLock.lock()
        let today = DayOfWeek.from(date: Date())
        if day == today {
            inMemorySelectedDay = nil
            defaults.removeObject(forKey: selectedDayKey)
        } else {
            inMemorySelectedDay = day
            defaults.set(day.rawValue, forKey: selectedDayKey)
        }
        inMemoryDayOffset = 0
        defaults.removeObject(forKey: dayOffsetKey)
        inMemoryMealOverride = nil
        defaults.removeObject(forKey: mealKey)
        memoryLock.unlock()
        notifyWidgets()
    }

    public var currentDayOffset: Int {
        get {
            memoryLock.lock()
            defer { memoryLock.unlock() }
            return inMemoryDayOffset
        }
        set {
            memoryLock.lock()
            inMemoryDayOffset = newValue
            defaults.set(newValue, forKey: dayOffsetKey)
            inMemorySelectedDay = nil
            defaults.removeObject(forKey: selectedDayKey)
            inMemoryMealOverride = nil
            defaults.removeObject(forKey: mealKey)
            memoryLock.unlock()
            notifyWidgets()
        }
    }

    public func advanceDay(by offset: Int) {
        memoryLock.lock()
        let current = selectedDayOfWeekLocked().day
        let all = DayOfWeek.allCases
        if let idx = all.firstIndex(of: current) {
            let count = all.count
            let nextIdx = (idx + offset) % count
            let finalIdx = nextIdx >= 0 ? nextIdx : (nextIdx + count)
            let newDay = all[finalIdx]
            let today = DayOfWeek.from(date: Date())
            if newDay == today {
                inMemorySelectedDay = nil
                defaults.removeObject(forKey: selectedDayKey)
            } else {
                inMemorySelectedDay = newDay
                defaults.set(newDay.rawValue, forKey: selectedDayKey)
            }
        }
        inMemoryDayOffset = 0
        defaults.removeObject(forKey: dayOffsetKey)
        memoryLock.unlock()
        notifyWidgets()
    }

    public func resetDay() {
        memoryLock.lock()
        inMemorySelectedDay = nil
        defaults.removeObject(forKey: selectedDayKey)
        inMemoryDayOffset = 0
        defaults.set(0, forKey: dayOffsetKey)
        inMemoryMealOverride = nil
        defaults.removeObject(forKey: mealKey)
        memoryLock.unlock()
        notifyWidgets()
    }

    public func selectedDayOfWeek(relativeTo baseDate: Date = Date()) -> (day: DayOfWeek, isToday: Bool) {
        memoryLock.lock()
        defer { memoryLock.unlock() }
        return selectedDayOfWeekLocked(relativeTo: baseDate)
    }

    private func selectedDayOfWeekLocked(relativeTo baseDate: Date = Date()) -> (day: DayOfWeek, isToday: Bool) {
        let today = DayOfWeek.from(date: baseDate)
        if let selected = inMemorySelectedDay {
            return (day: selected, isToday: selected == today)
        }
        if let saved = defaults.string(forKey: selectedDayKey),
           let day = DayOfWeek(rawValue: saved) {
            return (day: day, isToday: day == today)
        }
        let offset = inMemoryDayOffset != 0 ? inMemoryDayOffset : defaults.integer(forKey: dayOffsetKey)
        if offset != 0 {
            let calculated = today.offset(by: offset)
            return (day: calculated, isToday: calculated == today)
        }
        return (day: today, isToday: true)
    }

    // MARK: - Meal Navigation
    public var currentMeal: MealType {
        memoryLock.lock()
        defer { memoryLock.unlock() }
        return currentMealLocked()
    }

    private func currentMealLocked() -> MealType {
        if let override = inMemoryMealOverride {
            return override
        }
        if let saved = defaults.string(forKey: mealKey),
           let meal = MealType(rawValue: saved) {
            return meal
        }
        let (_, isToday) = selectedDayOfWeekLocked()
        return defaultMealLocked(isToday: isToday)
    }

    private func defaultMealLocked(isToday: Bool) -> MealType {
        if isToday {
            let (current, next) = MealType.status(at: Date())
            return current ?? next ?? .breakfast
        }
        return .breakfast
    }

    public func selectMeal(_ meal: MealType) {
        memoryLock.lock()
        inMemoryMealOverride = meal
        defaults.set(meal.rawValue, forKey: mealKey)
        defaults.synchronize()
        memoryLock.unlock()
        notifyWidgets()
    }

    public func advanceMeal(by step: Int) {
        memoryLock.lock()
        let all = MealType.allCases
        let active = currentMealLocked()
        let currentIndex = all.firstIndex(of: active) ?? 0
        let count = all.count
        let nextIndex = (currentIndex + step) % count
        let finalIndex = nextIndex >= 0 ? nextIndex : (nextIndex + count)
        let newMeal = all[finalIndex]
        inMemoryMealOverride = newMeal
        defaults.set(newMeal.rawValue, forKey: mealKey)
        memoryLock.unlock()
        notifyWidgets()
    }

    public func resetMeal() {
        memoryLock.lock()
        inMemoryMealOverride = nil
        defaults.removeObject(forKey: mealKey)
        memoryLock.unlock()
        notifyWidgets()
    }

    // MARK: - Loading Menu
    public func loadMenu() -> WeeklyMenu {
        memoryLock.lock()
        if let cached = inMemoryCache {
            memoryLock.unlock()
            return cached
        }
        memoryLock.unlock()

        // 1. Try Cache File
        if let data = try? Data(contentsOf: cacheFileURL),
           let decoded = try? JSONDecoder().decode(WeeklyMenu.self, from: data) {
            updateMemoryCache(decoded)
            return decoded
        }

        // 2. Try Bundled Resource
        if let bundleURL = Bundle.main.url(forResource: "menu", withExtension: "json"),
           let data = try? Data(contentsOf: bundleURL),
           let decoded = try? JSONDecoder().decode(WeeklyMenu.self, from: data) {
            updateMemoryCache(decoded)
            return decoded
        }

        // 3. Fallback to Local Repository Path (Development support)
        let devFallbackPath = "/Users/swap/Developer/newton-enhancer/menu.json"
        if let data = try? Data(contentsOf: URL(fileURLWithPath: devFallbackPath)),
           let decoded = try? JSONDecoder().decode(WeeklyMenu.self, from: data) {
            updateMemoryCache(decoded)
            return decoded
        }

        return [:]
    }

    public func loadMenuForSelectedDay() -> (day: DayOfWeek, menu: DailyMenu, isToday: Bool, meal: MealType, todayDay: DayOfWeek, todayMenu: DailyMenu, todayMeal: MealType) {
        let (day, isToday) = selectedDayOfWeek()
        let today = DayOfWeek.from(date: Date())
        let fullMenu = loadMenu()
        let daily = fullMenu[day.rawValue] ?? DailyMenu()
        let todayDaily = fullMenu[today.rawValue] ?? DailyMenu()

        memoryLock.lock()
        let overrideMeal = inMemoryMealOverride ?? defaults.string(forKey: mealKey).flatMap(MealType.init)
        let meal = overrideMeal ?? defaultMealLocked(isToday: isToday)
        let todayMeal = overrideMeal ?? defaultMealLocked(isToday: true)
        memoryLock.unlock()

        return (day: day, menu: daily, isToday: isToday, meal: meal, todayDay: today, todayMenu: todayDaily, todayMeal: todayMeal)
    }

    // MARK: - Remote Synchronization
    @discardableResult
    public func refreshFromRemote() async -> Bool {
        do {
            var request = URLRequest(url: remoteMenuURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 10

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                return false
            }

            let decoded = try JSONDecoder().decode(WeeklyMenu.self, from: data)
            try? data.write(to: cacheFileURL, options: .atomic)
            updateMemoryCache(decoded)
            defaults.set(Date().timeIntervalSince1970, forKey: lastUpdatedKey)
            notifyWidgets()
            return true
        } catch {
            return false
        }
    }

    private func updateMemoryCache(_ menu: WeeklyMenu) {
        memoryLock.lock()
        inMemoryCache = menu
        memoryLock.unlock()
    }

    private func notifyWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: "com.newton.enhancer.widget.menu")
        WidgetCenter.shared.reloadTimelines(ofKind: "com.newton.enhancer.widget.today")
        WidgetCenter.shared.reloadAllTimelines()
        #endif
        NotificationCenter.default.post(name: Notification.Name("NewtonMenuUpdated"), object: nil)
    }
}
