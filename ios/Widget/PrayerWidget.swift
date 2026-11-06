import WidgetKit
import SwiftUI

/* A widget is the clearest answer to Apple's 4.2: a website cannot put the
   next prayer on someone's home screen. It reads what the app last wrote to
   the shared container, so it shows the same times the reader sees, computed
   for their place by the same code, rather than guessing its own. */

struct Times: Codable {
  let names: [String]
  let at: [Double]
  /* the heading in the reader's own language, handed by the page */
  var head: String? = nil
  /* each prayer's weekday and hijri date, in the reader's language */
  var days: [String]? = nil
  var hijris: [String]? = nil

  static let empty = Times(names: [], at: [])

  var heading: String { head ?? "الصلاة القادمة" }

  /* today's weekday and hijri date: those of the first prayer still ahead
     today, or nothing, and the widget falls back on the phone's calendar */
  var today: (day: String, hijri: String)? {
    let now = Date()
    for (i, t) in at.enumerated() {
      let when = Date(timeIntervalSince1970: t)
      guard when > now else { continue }
      guard Calendar.current.isDate(when, inSameDayAs: now),
            let h = hijris?[safe: i], !h.isEmpty else { return nil }
      return (days?[safe: i] ?? "", h)
    }
    return nil
  }

  /* the next few prayers, for the large widget */
  var ahead: [(name: String, when: Date)] {
    let now = Date()
    var out: [(name: String, when: Date)] = []
    for (i, t) in at.enumerated() where i < names.count {
      let when = Date(timeIntervalSince1970: t)
      if when > now { out.append((name: names[i], when: when)) }
      if out.count == 6 { break }
    }
    return out
  }

  /* the prayers still ahead today, for the wider widget */
  var restOfToday: [(name: String, when: Date)] {
    let now = Date()
    let end = Calendar.current.startOfDay(for: now).addingTimeInterval(86400)
    var out: [(name: String, when: Date)] = []
    for (i, t) in at.enumerated() where i < names.count {
      let when = Date(timeIntervalSince1970: t)
      if when > now && when < end { out.append((name: names[i], when: when)) }
    }
    return out
  }

  /* the first prayer still ahead, and how long until it */
  var next: (name: String, when: Date)? {
    let now = Date().timeIntervalSince1970
    for (i, t) in at.enumerated() where t > now && i < names.count {
      return (names[i], Date(timeIntervalSince1970: t))
    }
    return nil
  }
}

extension Array {
  subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

struct Entry: TimelineEntry {
  let date: Date
  let times: Times
}

struct Provider: TimelineProvider {
  /* the app and the widget share one container, named for the team and the
     bundle; the app writes the day's times there whenever it recomputes them */
  private let store = UserDefaults(suiteName: "group.com.eworldq8.sunnati")

  private func read() -> Times {
    guard let raw = store?.data(forKey: "times"),
          let t = try? JSONDecoder().decode(Times.self, from: raw)
    else { return .empty }
    return t
  }

  func placeholder(in: Context) -> Entry { Entry(date: Date(), times: .empty) }

  func getSnapshot(in: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: Date(), times: read()))
  }

  func getTimeline(in: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let times = read()
    /* refresh when the next prayer arrives, not on a fixed clock: a widget
       that wakes every fifteen minutes spends battery saying the same thing */
    let again = times.next?.when ?? Date().addingTimeInterval(3600)
    completion(Timeline(entries: [Entry(date: Date(), times: times)],
                        policy: .after(again)))
  }
}

struct PrayerView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    content.environment(\.layoutDirection, .rightToLeft)
  }

  @ViewBuilder private var content: some View {
    if let next = entry.times.next {
      switch family {
      case .systemMedium:
        HStack(alignment: .top, spacing: 14) {
          nextBlock(next)
          VStack(alignment: .trailing, spacing: 4) {
            ForEach(Array(entry.times.restOfToday.dropFirst().prefix(4).enumerated()), id: \.offset) { _, row in
              HStack {
                Text(row.name).font(.caption)
                Spacer(minLength: 6)
                Text(row.when, style: .time).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
              }
            }
          }
          .frame(maxWidth: .infinity)
        }
      case .systemLarge:
        VStack(alignment: .trailing, spacing: 10) {
          if let t = entry.times.today {
            Text("\(t.day)  \(t.hijri)").font(.caption).foregroundStyle(.secondary)
          }
          nextBlock(next)
          Divider()
          ForEach(Array(entry.times.ahead.dropFirst().enumerated()), id: \.offset) { _, row in
            HStack {
              Text(row.name).font(.subheadline)
              Spacer(minLength: 6)
              Text(row.when, style: .time).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
          }
          Spacer(minLength: 0)
        }
      default:
        if #available(iOSApplicationExtension 16.0, *) {
          lockScreen(next)
        } else {
          nextBlock(next)
        }
      }
    } else {
      VStack(alignment: .trailing, spacing: 4) {
        Text("سُنّتي").font(.headline)
        Text("افتح التطبيق لحساب الأوقات").font(.caption2).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
    }
  }

  private func nextBlock(_ next: (name: String, when: Date)) -> some View {
    VStack(alignment: .trailing, spacing: 6) {
      Text(entry.times.heading)
        .font(.caption2)
        .foregroundStyle(.secondary)
      Text(next.name)
        .font(.title3.weight(.bold))
        .foregroundStyle(Color(red: 0.49, green: 0.12, blue: 0.12))
      Text(next.when, style: .time)
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
      Text(next.when, style: .timer)
        .font(.title2.monospacedDigit())
        .foregroundStyle(.primary)
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
  }

  /* The lock screen and the watch face draw in one tint, so the widget gives
     them words and figures only: the next prayer and the time left on it. */
  @available(iOSApplicationExtension 16.0, *)
  @ViewBuilder private func lockScreen(_ next: (name: String, when: Date)) -> some View {
    switch family {
    case .accessoryInline:
      Text("\(next.name) ") + Text(next.when, style: .time)
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Text(next.name).font(.system(size: 11, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.6)
          Text(next.when, style: .time).font(.system(size: 12).monospacedDigit()).lineLimit(1).minimumScaleFactor(0.6)
        }
        .padding(4)
      }
    case .accessoryRectangular:
      VStack(alignment: .trailing, spacing: 1) {
        Text(entry.times.heading).font(.caption2).foregroundStyle(.secondary)
        HStack(spacing: 4) {
          Text(next.name).font(.headline)
          Text(next.when, style: .time).font(.caption.monospacedDigit())
        }
        Text(next.when, style: .timer).font(.body.monospacedDigit())
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
    default:
      nextBlock(next)
    }
  }
}

/* The widgets the app offers: the prayers in every size, and the hijri date. */
@main
struct SunnatiWidgets: WidgetBundle {
  var body: some Widget {
    PrayerWidget()
    HijriWidget()
  }
}

struct PrayerWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiPrayer", provider: Provider()) { entry in
      if #available(iOSApplicationExtension 17.0, *) {
        PrayerView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
      } else {
        PrayerView(entry: entry).padding()
      }
    }
    .configurationDisplayName("أوقات الصلاة")
    .description("الصلاة القادمة والوقت الباقي عليها")
    .supportedFamilies(families)
  }

  /* the lock screen kinds arrived with iOS 16, and the app still opens on 15 */
  private var families: [WidgetFamily] {
    if #available(iOSApplicationExtension 16.0, *) {
      return [.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline]
    }
    return [.systemSmall, .systemMedium, .systemLarge]
  }
}

/* Today's hijri date, as the reader's own app reckons it with his nudge for
   the moon of his town; before the app has said anything, the phone's Umm al
   Qura calendar. */
struct HijriView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family

  private var words: (day: String, hijri: String) {
    if let t = entry.times.today { return t }
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .islamicUmmAlQura)
    f.locale = Locale(identifier: "ar")
    f.dateFormat = "d MMMM y"
    let w = DateFormatter()
    w.locale = Locale(identifier: "ar")
    w.dateFormat = "EEEE"
    return (w.string(from: entry.date), f.string(from: entry.date))
  }

  var body: some View {
    Group {
      if #available(iOSApplicationExtension 16.0, *) {
        sized(words)
      } else {
        card(words)
      }
    }
    .environment(\.layoutDirection, .rightToLeft)
  }

  private func card(_ t: (day: String, hijri: String)) -> some View {
    VStack(spacing: 4) {
      Text(t.day).font(.caption).foregroundStyle(.secondary)
      Text(t.hijri)
        .font(.title3.weight(.bold))
        .multilineTextAlignment(.center)
        .minimumScaleFactor(0.6)
        .foregroundStyle(Color(red: 0.49, green: 0.12, blue: 0.12))
      Text(entry.date, style: .date).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  /* the lock screen kinds came with iOS 16 */
  @available(iOSApplicationExtension 16.0, *)
  @ViewBuilder private func sized(_ t: (day: String, hijri: String)) -> some View {
    switch family {
    case .accessoryInline:
      Text(t.hijri)
    case .accessoryRectangular:
      VStack(alignment: .trailing, spacing: 1) {
        Text(t.day).font(.caption2).foregroundStyle(.secondary)
        Text(t.hijri).font(.headline).minimumScaleFactor(0.7)
        Text(entry.date, style: .date).font(.caption2)
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
    default:
      card(t)
    }
  }
}

struct HijriProvider: TimelineProvider {
  private let inner = Provider()
  func placeholder(in context: Context) -> Entry { inner.placeholder(in: context) }
  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { inner.getSnapshot(in: context, completion: completion) }
  /* the date turns at midnight, and that is the only time it needs drawing */
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    inner.getSnapshot(in: context) { entry in
      let midnight = Calendar.current.startOfDay(for: Date()).addingTimeInterval(86400 + 5)
      completion(Timeline(entries: [entry], policy: .after(midnight)))
    }
  }
}

struct HijriWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiHijri", provider: HijriProvider()) { entry in
      if #available(iOSApplicationExtension 17.0, *) {
        HijriView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
      } else {
        HijriView(entry: entry).padding()
      }
    }
    .configurationDisplayName("التاريخ الهجري")
    .description("التاريخ الهجري اليوم")
    .supportedFamilies(families)
  }

  private var families: [WidgetFamily] {
    if #available(iOSApplicationExtension 16.0, *) {
      return [.systemSmall, .accessoryRectangular, .accessoryInline]
    }
    return [.systemSmall]
  }
}
