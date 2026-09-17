import WidgetKit
import SwiftUI

/* A widget is the clearest answer to Apple's 4.2: a website cannot put the
   next prayer on someone's home screen. It reads what the app last wrote to
   the shared container, so it shows the same times the reader sees, computed
   for their place by the same code, rather than guessing its own. */

struct Times: Codable {
  let names: [String]
  let at: [Double]

  static let empty = Times(names: [], at: [])

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

  var body: some View {
    VStack(alignment: .trailing, spacing: 6) {
      if let next = entry.times.next {
        Text("الصلاة القادمة")
          .font(.caption2)
          .foregroundStyle(.secondary)
        Text(next.name)
          .font(.title3.weight(.bold))
          .foregroundStyle(Color(red: 0.49, green: 0.12, blue: 0.12))
        Text(next.when, style: .timer)
          .font(.title2.monospacedDigit())
          .foregroundStyle(.primary)
      } else {
        Text("سُنّتي")
          .font(.headline)
        Text("افتح التطبيق لحساب الأوقات")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .environment(\.layoutDirection, .rightToLeft)
  }
}

@main
struct PrayerWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiPrayer", provider: Provider()) { entry in
      if #available(iOS 17.0, *) {
        PrayerView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
      } else {
        PrayerView(entry: entry).padding()
      }
    }
    .configurationDisplayName("أوقات الصلاة")
    .description("الصلاة القادمة والوقت الباقي عليها")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
