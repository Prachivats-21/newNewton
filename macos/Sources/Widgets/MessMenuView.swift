import SwiftUI
import AppIntents

public struct MessMenuView: View {
    public let day: DayOfWeek
    public let menu: DailyMenu
    public let isToday: Bool
    public let currentDate: Date
    public let selectedMeal: MealType
    public let is2x1Mode: Bool

    // Callbacks for non-intent standalone execution if ever needed
    public var onSelectDay: ((DayOfWeek) -> Void)? = nil
    public var onPreviousMeal: (() -> Void)? = nil
    public var onNextMeal: (() -> Void)? = nil

    public init(
        day: DayOfWeek,
        menu: DailyMenu,
        isToday: Bool,
        currentDate: Date = Date(),
        selectedMeal: MealType,
        is2x1Mode: Bool = false,
        onSelectDay: ((DayOfWeek) -> Void)? = nil,
        onPreviousMeal: (() -> Void)? = nil,
        onNextMeal: (() -> Void)? = nil
    ) {
        self.day = day
        self.menu = menu
        self.isToday = isToday
        self.currentDate = currentDate
        self.selectedMeal = selectedMeal
        self.is2x1Mode = is2x1Mode
        self.onSelectDay = onSelectDay
        self.onPreviousMeal = onPreviousMeal
        self.onNextMeal = onNextMeal
    }

    public var body: some View {
        VStack(spacing: is2x1Mode ? 0 : 8) {
            if !is2x1Mode {
                dayPillsBar
            }
            mealCard
        }
        .padding(.horizontal, is2x1Mode ? 10 : 10)
        .padding(.vertical, is2x1Mode ? 8 : 9)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: day)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: selectedMeal)
    }

    // MARK: - Top Day Selector Pills (2x2 widget only)
    private var dayPillsBar: some View {
        let todayDay = DayOfWeek.from(date: currentDate)

        return HStack(spacing: 5) {
            ForEach(DayOfWeek.allCases) { d in
                let isSelected = (d == day)
                let isDayToday = (d == todayDay)

                dayPill(for: d, isSelected: isSelected, isToday: isDayToday)
            }
        }
    }

    @ViewBuilder
    private func dayPill(for d: DayOfWeek, isSelected: Bool, isToday: Bool) -> some View {
        if #available(macOS 14.0, *), onSelectDay == nil {
            Button(intent: SelectDayIntent(day: d)) {
                dayPillContent(for: d, isSelected: isSelected, isToday: isToday)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(d.rawValue)\(isToday ? ", Today" : "")")
            .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : [.isButton])
        } else {
            Button(action: { onSelectDay?(d) }) {
                dayPillContent(for: d, isSelected: isSelected, isToday: isToday)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(d.rawValue)\(isToday ? ", Today" : "")")
            .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : [.isButton])
        }
    }

    private func dayPillContent(for d: DayOfWeek, isSelected: Bool, isToday: Bool) -> some View {
        VStack(spacing: 2) {
            Text(d.abbreviation.uppercased())
                .font(.system(size: 12, weight: isSelected ? .heavy : (isToday ? .bold : .semibold), design: .rounded))
                .foregroundStyle(pillTextColor(isSelected: isSelected, isToday: isToday))

            // Subtly visible indicator dot for today
            Circle()
                .fill(pillDotColor(isSelected: isSelected, isToday: isToday))
                .frame(width: 4, height: 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .background(pillBackgroundColor(isSelected: isSelected, isToday: isToday))
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(pillBorderColor(isSelected: isSelected, isToday: isToday), lineWidth: isSelected ? 1.2 : 0.8)
        )
    }

    private func pillTextColor(isSelected: Bool, isToday: Bool) -> Color {
        if isSelected {
            return .white
        } else if isToday {
            return NewtonTheme.orange
        } else {
            return NewtonTheme.textSecondary
        }
    }

    private func pillDotColor(isSelected: Bool, isToday: Bool) -> Color {
        if isSelected && isToday {
            return .white
        } else if isToday {
            return NewtonTheme.orange
        } else {
            return .clear
        }
    }

    private func pillBackgroundColor(isSelected: Bool, isToday: Bool) -> Color {
        if isSelected {
            return NewtonTheme.brandPrimary
        } else if isToday {
            return NewtonTheme.orange.opacity(0.18)
        } else {
            return Color.white.opacity(0.04)
        }
    }

    private func pillBorderColor(isSelected: Bool, isToday: Bool) -> Color {
        if isSelected {
            return NewtonTheme.brandHover.opacity(0.9)
        } else if isToday {
            return NewtonTheme.orange.opacity(0.45)
        } else {
            return Color.white.opacity(0.06)
        }
    }

    // MARK: - Meal Card
    private var mealCard: some View {
        let items = menu.items(for: selectedMeal)
        let classified = DishClassifier.classify(items)
        let badge = selectedMeal.statusBadge(at: currentDate, isToday: isToday)

        return VStack(alignment: .leading, spacing: is2x1Mode ? 5 : 7) {
            // Meal Card Header
            HStack(alignment: .center, spacing: 6) {
                Text(selectedMeal.emoji)
                    .font(.system(size: is2x1Mode ? 17 : 19))

                Text(selectedMeal.rawValue.uppercased())
                    .font(.system(size: is2x1Mode ? 15.5 : 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(selectedMeal.accentColor)

                if is2x1Mode || isToday {
                    Text("TODAY")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(NewtonTheme.orange)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(NewtonTheme.orange.opacity(0.18))
                        .clipShape(Capsule())
                        .overlay(
                            Capsule()
                                .stroke(NewtonTheme.orange.opacity(0.4), lineWidth: 0.8)
                        )
                }

                Spacer(minLength: 4)

                // Status Badge (Serving Now / Next Up / Timing)
                HStack(spacing: 4) {
                    Circle()
                        .fill(badge.isServing ? NewtonTheme.success : selectedMeal.accentColor)
                        .frame(width: 5, height: 5)
                    Text(badge.label)
                        .font(.system(size: 10.5, weight: .bold, design: .rounded))
                        .foregroundStyle(badge.isServing ? NewtonTheme.success : NewtonTheme.textSecondary)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background((badge.isServing ? NewtonTheme.success : selectedMeal.accentColor).opacity(0.14))
                .clipShape(Capsule())
            }

            Divider()
                .overlay(Color.white.opacity(0.09))

            // Food Items & Meal Switcher Area
            if items.isEmpty {
                Text("No items listed for this meal.")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(NewtonTheme.textMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 14)
            } else {
                HStack(alignment: .top, spacing: 6) {
                    // Side-by-side Columns: Main Course | Side Course
                    HStack(alignment: .top, spacing: 0) {
                        // Main Course Column (Left)
                        mainCourseColumn(classified: classified)
                            .frame(maxWidth: .infinity, alignment: .topLeading)

                        // Vertical Divider Bar
                        Rectangle()
                            .fill(Color.white.opacity(0.18))
                            .frame(width: 1)
                            .padding(.horizontal, is2x1Mode ? 7 : 10)
                            .padding(.vertical, 2)

                        // Side Course Column (Right)
                        sideCourseColumn(classified: classified)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

                    // Vertical Arrow Switcher (cycling meals)
                    VStack(alignment: .center, spacing: 3) {
                        previousMealButton

                        Spacer()

                        // Center: Meal Indicator Dots (B, L, S, D)
                        VStack(spacing: 3) {
                            ForEach(MealType.allCases) { m in
                                Capsule()
                                    .fill(m == selectedMeal ? selectedMeal.accentColor : Color.white.opacity(0.20))
                                    .frame(width: 3.5, height: m == selectedMeal ? 9 : 3.5)
                                    .animation(.spring(response: 0.25, dampingFraction: 0.8), value: selectedMeal)
                            }
                        }

                        Spacer()

                        nextMealButton
                    }
                    .frame(width: 24)
                }
            }
        }
        .padding(is2x1Mode ? 9 : 10)
        .background(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(NewtonTheme.bgCardSubtle)
                .overlay(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .stroke(Color.white.opacity(0.07), lineWidth: 0.5)
                )
        )
    }

    // MARK: - Main Course Column
    @ViewBuilder
    private func mainCourseColumn(classified: (mainCourse: [String], sideCourse: [String])) -> some View {
        let maxAllowed = is2x1Mode ? 4 : 7
        let totalCount = classified.mainCourse.count
        let showMore = totalCount > maxAllowed
        let visibleCount = showMore ? (maxAllowed - 1) : totalCount
        let visibleItems = Array(classified.mainCourse.prefix(visibleCount))
        let remaining = totalCount - visibleCount

        VStack(alignment: .leading, spacing: is2x1Mode ? 3.5 : 5) {
            HStack(spacing: 3.5) {
                Image(systemName: "sparkles")
                    .font(.system(size: 10.5, weight: .bold))
                    .foregroundStyle(selectedMeal.accentColor)

                Text("MAIN COURSE")
                    .font(.system(size: 11.5, weight: .heavy, design: .rounded))
                    .tracking(0.4)
                    .foregroundStyle(selectedMeal.accentColor)

                Text("\(totalCount)")
                    .font(.system(size: 9.5, weight: .bold, design: .rounded))
                    .foregroundStyle(selectedMeal.accentColor)
                    .padding(.horizontal, 4.5)
                    .padding(.vertical, 1)
                    .background(selectedMeal.accentColor.opacity(0.15))
                    .clipShape(Capsule())
            }
            .padding(.bottom, 1)

            if classified.mainCourse.isEmpty {
                Text("Standard only")
                    .font(.system(size: 12.5, weight: .medium, design: .rounded))
                    .foregroundStyle(NewtonTheme.textMuted)
            } else {
                VStack(alignment: .leading, spacing: is2x1Mode ? 3.5 : 5) {
                    ForEach(visibleItems, id: \.self) { dish in
                        HStack(alignment: .top, spacing: 4.5) {
                            Circle()
                                .fill(selectedMeal.accentColor)
                                .frame(width: 4.5, height: 4.5)
                                .padding(.top, 4.5)

                            Text(dish)
                                .font(.system(size: is2x1Mode ? 13 : 13.5, weight: .semibold, design: .rounded))
                                .foregroundStyle(NewtonTheme.textPrimary)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                    }

                    if showMore {
                        Text("+\(remaining) more")
                            .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(NewtonTheme.textMuted)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1.5)
                            .background(Color.white.opacity(0.06))
                            .clipShape(Capsule())
                    }
                }
            }

            Spacer(minLength: 0)
        }
    }

    // MARK: - Side Course Column (Daily Staples)
    @ViewBuilder
    private func sideCourseColumn(classified: (mainCourse: [String], sideCourse: [String])) -> some View {
        let maxAllowed = is2x1Mode ? 4 : 7
        let totalCount = classified.sideCourse.count
        let showMore = totalCount > maxAllowed
        let visibleCount = showMore ? (maxAllowed - 1) : totalCount
        let visibleItems = Array(classified.sideCourse.prefix(visibleCount))
        let remaining = totalCount - visibleCount

        VStack(alignment: .leading, spacing: is2x1Mode ? 3.5 : 5) {
            HStack(spacing: 3.5) {
                Image(systemName: "fork.knife")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(NewtonTheme.textSecondary)

                Text("SIDE COURSE")
                    .font(.system(size: 11.5, weight: .heavy, design: .rounded))
                    .tracking(0.4)
                    .foregroundStyle(NewtonTheme.textSecondary)

                Text("\(totalCount)")
                    .font(.system(size: 9.5, weight: .bold, design: .rounded))
                    .foregroundStyle(NewtonTheme.textSecondary)
                    .padding(.horizontal, 4.5)
                    .padding(.vertical, 1)
                    .background(Color.white.opacity(0.08))
                    .clipShape(Capsule())
            }
            .padding(.bottom, 1)

            if classified.sideCourse.isEmpty {
                Text("None")
                    .font(.system(size: 12.5, weight: .medium, design: .rounded))
                    .foregroundStyle(NewtonTheme.textMuted)
            } else {
                VStack(alignment: .leading, spacing: is2x1Mode ? 3.5 : 5) {
                    ForEach(visibleItems, id: \.self) { dish in
                        HStack(alignment: .top, spacing: 4.5) {
                            Circle()
                                .fill(Color.white.opacity(0.4))
                                .frame(width: 4, height: 4)
                                .padding(.top, 4.5)

                            Text(dish)
                                .font(.system(size: is2x1Mode ? 12.5 : 13, weight: .medium, design: .rounded))
                                .foregroundStyle(NewtonTheme.textSecondary)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                    }

                    if showMore {
                        Text("+\(remaining) more")
                            .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(NewtonTheme.textMuted)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1.5)
                            .background(Color.white.opacity(0.06))
                            .clipShape(Capsule())
                    }
                }
            }

            Spacer(minLength: 0)
        }
    }

    // MARK: - Meal Navigation Buttons
    @ViewBuilder
    private var previousMealButton: some View {
        if #available(macOS 14.0, *), onPreviousMeal == nil {
            Button(intent: PreviousMealIntent()) {
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .frame(width: 22, height: 22)
                    .background(Color.white.opacity(0.08))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Previous Meal")
        } else {
            Button(action: { onPreviousMeal?() }) {
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .frame(width: 22, height: 22)
                    .background(Color.white.opacity(0.08))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Previous Meal")
        }
    }

    @ViewBuilder
    private var nextMealButton: some View {
        if #available(macOS 14.0, *), onNextMeal == nil {
            Button(intent: NextMealIntent()) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .frame(width: 22, height: 22)
                    .background(Color.white.opacity(0.08))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Next Meal")
        } else {
            Button(action: { onNextMeal?() }) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .frame(width: 22, height: 22)
                    .background(Color.white.opacity(0.08))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Next Meal")
        }
    }
}
