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

  static let empty = Times(names: [], at: [])

  var heading: String { head ?? "الصلاة القادمة" }

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

@main
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
      return [.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline]
    }
    return [.systemSmall, .systemMedium]
  }
}
