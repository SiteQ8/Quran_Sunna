import WidgetKit
import SwiftUI
import AppIntents

/* The widgets read what the app last wrote to the shared container: the
   times the adhan keeps ("times"), and everything else the page hands for
   them in one piece ("widget", handWidgetData in docs/js/app.js) in the
   reader's own language: seven days, each with its five prayers, its hijri
   date, the occasion coming, the turns of its painted sky, its ayah and its
   adhkar, then the khatma. They work nothing out for themselves beyond which
   part of it is now, so they never tell the reader something the app would
   not. A website cannot put any of this on a home screen, which is the
   clearest answer to Apple's 4.2. */

/* a word of the page's, in the reader's language; before the app has handed
   any, the phone's own, from the Localizable.strings beside this file, which
   is keyed by the same Arabic */
func says(_ data: WData?, _ key: String, _ arabic: String) -> String {
  if let w = data?.words?[key], !w.isEmpty { return w }
  return NSLocalizedString(arabic, comment: "")
}

// MARK: - what the app wrote

struct Times: Codable {
  let names: [String]
  let at: [Double]
  var head: String? = nil
  var days: [String]? = nil
  var hijris: [String]? = nil

  static let empty = Times(names: [], at: [])
}

struct SkyStop: Codable {
  let at: Double
  let name: String
  init(from decoder: Decoder) throws {
    var c = try decoder.unkeyedContainer()
    at = try c.decode(Double.self)
    name = try c.decode(String.self)
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.unkeyedContainer()
    try c.encode(at)
    try c.encode(name)
  }
}

struct WPrayer: Codable {
  let key: String
  let label: String
  let clock: String
  /* the time without its half of the day, for the day's five narrow columns */
  var short: String? = nil
  let at: Double
  var sub: String? = nil
  var iqama: Double? = nil
  var iqclock: String? = nil
  var prayed: Bool? = nil
  var when: Date { Date(timeIntervalSince1970: at / 1000) }
  var iqamaDate: Date? { (iqama ?? 0) > 0 ? Date(timeIntervalSince1970: iqama! / 1000) : nil }
}

struct WOccasion: Codable {
  let name: String
  let when: String
}

struct WAyah: Codable {
  let t: String
  let ref: String
  var page: Int? = nil
}

struct WAdhkar: Codable {
  let key: String
  let title: String
  var from: Double? = nil
  var to: Double? = nil
  let done: Int
  let total: Int
}

struct WDay: Codable {
  let date: String
  let day: String
  let hijri: String
  var ramadan: Bool? = nil
  var occasion: WOccasion? = nil
  var civil: String? = nil
  let five: [WPrayer]
  var adhkar: [WAdhkar]? = nil
  var sky: [SkyStop]? = nil
  var ayah: WAyah? = nil
}

/* a du'a of the book, its topic, and its place in the book for the tap */
struct WDua: Codable {
  let t: String
  let n: String
  /* its source: the surah and ayah, or the book of hadith */
  var r: String? = nil
  var i: Int? = nil
}

/* the tasbih as the reader left the app */
struct WTasbih: Codable {
  let t: String
  let count: Int
  let target: Int
  let total: Int
}

struct WKhatma: Codable {
  let read: Int
  let total: Int
  let page: Int
  var wird: String? = nil
}

struct WData: Codable {
  let days: [WDay]
  var words: [String: String]? = nil
  var place: String? = nil
  var khatma: WKhatma? = nil
  /* what the refresh of the ayah and du'a widgets turns to, and the tasbih */
  var ayat: [WAyah]? = nil
  var duas: [WDua]? = nil
  var tasbih: WTasbih? = nil
  var lang: String? = nil
  var digits: String? = nil

  func word(_ key: String, _ fallback: String) -> String {
    if let w = words?[key], !w.isEmpty { return w }
    return fallback
  }

  /* a count the widget makes itself, in the figures of the reader's
     language: Bengali and Persian have their own, and the page hands them */
  func figures(_ text: String) -> String {
    guard let d = digits, d.count == 10, d != "0123456789" else { return text }
    let map = Array(d)
    return String(text.map { c -> Character in
      if let v = c.wholeNumberValue, c.isASCII { return map[v] }
      return c
    })
  }

  /* a day of the handed week, by the date a moment falls on */
  func day(_ at: Date) -> WDay? {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    let key = f.string(from: at)
    return days.first { $0.date == key }
  }

  var prayers: [WPrayer] { days.flatMap { $0.five } }

  /* the prayer gone and the prayer coming, around a moment */
  func around(_ now: Date) -> (prev: WPrayer?, next: WPrayer?) {
    let all = prayers
    for (i, p) in all.enumerated() where p.when > now {
      return (i > 0 ? all[i - 1] : nil, p)
    }
    return (all.last, nil)
  }

  /* the painting the sky is nearest at a moment; it turns halfway between
     two stops, as the app's own sky does */
  func sky(_ now: Date) -> String {
    guard let stops = day(now)?.sky, let first = stops.first else { return Sky.byHour(now) }
    var name = first.name
    let t = now.timeIntervalSince1970 * 1000
    for i in 1..<max(1, stops.count) where (stops[i - 1].at + stops[i].at) / 2 <= t {
      name = stops[i].name
    }
    return name
  }

  /* the adhkar of the part of the day a moment falls in; the night's run
     past midnight, so the day before is asked too */
  func adhkar(_ now: Date) -> WAdhkar? {
    let t = now.timeIntervalSince1970 * 1000
    for back in [0.0, 86400.0] {
      if let a = day(now.addingTimeInterval(-back))?.adhkar?.first(where: { ($0.from ?? .infinity) <= t && t < ($0.to ?? -.infinity) }) { return a }
    }
    return nil
  }

  /* every moment in the coming day at which something a widget shows changes */
  func turns(after now: Date) -> [Date] {
    let end = now.addingTimeInterval(86400)
    var out: [Date] = []
    for p in prayers {
      out.append(p.when.addingTimeInterval(1))
      if let q = p.iqamaDate { out.append(q.addingTimeInterval(1)) }
    }
    for d in days {
      if let s = d.sky, s.count > 1 {
        for i in 1..<s.count { out.append(Date(timeIntervalSince1970: (s[i - 1].at + s[i].at) / 2000)) }
      }
      for a in d.adhkar ?? [] { if let to = a.to { out.append(Date(timeIntervalSince1970: to / 1000 + 1)) } }
    }
    out.append(Calendar.current.startOfDay(for: now).addingTimeInterval(86400 + 5))
    return Array(Set(out.filter { $0 > now && $0 <= end })).sorted()
  }

  var rightToLeft: Bool { ["ar", "ur", "fa"].contains(lang ?? "ar") }
}

enum Sky {
  static func byHour(_ now: Date) -> String {
    let h = Calendar.current.component(.hour, from: now)
    switch h {
    case 4: return "fajr"
    case 5: return "fajr"
    case 6: return "sunrise"
    case 7...10: return "morning"
    case 11...13: return "noon"
    case 14...16: return "afternoon"
    case 17: return "sunset"
    case 18, 19: return "dusk"
    default: return "night"
    }
  }
}

// MARK: - the timeline every widget shares

struct Entry: TimelineEntry {
  let date: Date
  let data: WData?
  let times: Times
}

struct Provider: TimelineProvider {
  /* the app and the widget share one container, named for the team and the
     bundle; the app writes there whenever it recomputes */
  private let store = UserDefaults(suiteName: "group.com.eworldq8.sunnati")

  func read() -> (WData?, Times) {
    var data: WData? = nil
    if let raw = store?.data(forKey: "widget") { data = try? JSONDecoder().decode(WData.self, from: raw) }
    var times = Times.empty
    if let raw = store?.data(forKey: "times"), let t = try? JSONDecoder().decode(Times.self, from: raw) { times = t }
    return (data, times)
  }

  func placeholder(in context: Context) -> Entry { Entry(date: Date(), data: nil, times: .empty) }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    let (d, t) = read()
    completion(Entry(date: Date(), data: d, times: t))
  }

  /* an entry at each moment something changes, so the sky turns, the next
     prayer moves on and the adhkar change on time, without waking every few
     minutes; the bars and the counts between move by themselves */
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let (d, t) = read()
    let now = Date()
    var dates = [now]
    if let d = d { dates += d.turns(after: now) }
    else {
      for s in t.at where s > now.timeIntervalSince1970 && s < now.timeIntervalSince1970 + 86400 {
        dates.append(Date(timeIntervalSince1970: s + 1))
      }
    }
    let entries = dates.prefix(60).map { Entry(date: $0, data: d, times: t) }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

// MARK: - pieces

/* The app's own faces, as every screen of it is written: IBM Plex Sans Arabic
   for a language written in Arabic letters and IBM Plex Sans for one written
   in Latin or Cyrillic ones, each growing with the reader's text size from
   the size it is drawn at. A letter neither has, Bengali's, comes from the
   phone's own face. */
enum Face { case regular, semibold, bold }

func plex(_ data: WData?, _ size: CGFloat, _ face: Face = .regular, _ style: Font.TextStyle = .body) -> Font {
  let arabic = data?.rightToLeft ?? phoneReadsFromRight
  let name: String
  switch face {
  case .regular: name = arabic ? "IBMPlexSansArabic" : "IBMPlexSans"
  case .semibold: name = arabic ? "IBMPlexSansArabic-SmBld" : "IBMPlexSans-SmBld"
  case .bold: name = arabic ? "IBMPlexSansArabic-Bold" : "IBMPlexSans-Bold"
  }
  return .custom(name, size: size, relativeTo: style)
}

/* before the app has handed anything, the phone's first language decides */
let phoneReadsFromRight: Bool = {
  let code = String((Locale.preferredLanguages.first ?? "ar").prefix(2)).lowercased()
  return ["ar", "ur", "fa"].contains(code)
}()

/* Eight pointed stars in interlaced bands, the geometry of the mosques' doors
   and windows, rising from the corner at the end of the line and fading
   before the words: gold and faint on paper, a single white line on the
   painted skies. Drawn by tools/android/widget-ornament.py, the same picture
   the Android widgets wear; it turns itself for a page read from the right. */
struct Ornament: View {
  let onSky: Bool
  var body: some View {
    Image(onSky ? "ornament_line" : "ornament_band")
      .renderingMode(.template)
      .resizable()
      .frame(width: 150, height: 150)
      .foregroundStyle(onSky ? Color.white.opacity(0.34) : Color("Ornament"))
      .flipsForRightToLeftLayoutDirection(true)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
      .accessibilityHidden(true)
  }
}

/* the backgrounds a widget wears, turned the way the app's language reads */
func paperBack(_ data: WData?) -> some View {
  ZStack { Palette.paper; Ornament(onSky: false) }.direction(data)
}

func skyBack(_ data: WData?, _ name: String) -> some View {
  ZStack { SkyBackground(name: name); Ornament(onSky: true) }.direction(data)
}


enum Palette {
  static let accent = Color("Accent")
  static let paper = Color("Paper")
  static let ink = Color("Ink")
  static let muted = Color("Muted")
  static let gold = Color(red: 1.0, green: 0.88, blue: 0.70)
  /* the strapwork's gold, for a rule drawn on the paper */
  static let rule = Color(red: 0.69, green: 0.53, blue: 0.20)
}

/* the app's painted sky for the hour, darkened at the top and the foot so
   white words read on the brightest noon */
struct SkyBackground: View {
  let name: String
  var body: some View {
    ZStack {
      Image("sky_" + name).resizable().scaledToFill()
      LinearGradient(colors: [.black.opacity(0.42), .black.opacity(0.10), .black.opacity(0.52)],
                     startPoint: .top, endPoint: .bottom)
    }
  }
}

/* the time gone from one moment to the next, filling by itself */
struct GoneBar: View {
  let from: Date
  let to: Date
  var tint: Color = .white

  var body: some View {
    if #available(iOSApplicationExtension 16.0, *) {
      if from < to { live } else { still }
    } else {
      still
    }
  }

  @available(iOSApplicationExtension 16.0, *)
  private var live: some View {
    ProgressView(timerInterval: from...to, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
      .progressViewStyle(.linear)
      .tint(tint)
  }

  private var still: some View {
    ProgressView(value: fraction).progressViewStyle(.linear).tint(tint)
  }

  private var fraction: Double {
    let span = max(1, to.timeIntervalSince(from))
    return min(1, max(0, Date().timeIntervalSince(from) / span))
  }
}

/* What the next prayer widget says at a moment: between an adhan and its
   iqama it counts to the iqama, as the app's clock does. */
struct NextLine {
  let head: String
  let name: String
  let sub: String
  let to: Date
  let from: Date
  /* the time as the app writes it, when the page gave it */
  var clock: String? = nil

  static func at(_ now: Date, _ data: WData?, _ times: Times) -> NextLine? {
    if let d = data {
      let (prev, next) = d.around(now)
      if let p = prev, let q = p.iqamaDate, q > now {
        return NextLine(head: says(d, "iqama", "الإقامة"), name: p.label, sub: "", to: q, from: p.when, clock: p.iqclock)
      }
      if let n = next {
        let from = prev?.when ?? n.when.addingTimeInterval(-6 * 3600)
        return NextLine(head: says(d, "next", "الصلاة القادمة"), name: n.label, sub: n.sub ?? "", to: n.when, from: from, clock: n.clock)
      }
    }
    let t = now.timeIntervalSince1970
    for (i, s) in times.at.enumerated() where s > t && i < times.names.count {
      let to = Date(timeIntervalSince1970: s)
      let from = i > 0 ? Date(timeIntervalSince1970: times.at[i - 1]) : to.addingTimeInterval(-6 * 3600)
      return NextLine(head: times.head ?? "الصلاة القادمة", name: times.names[i], sub: "", to: to, from: min(from, to))
    }
    return nil
  }
}

/* The background a widget wears: from iOS 17 the system's, which the lock
   screen takes away by itself; under it the view's own, and none at all on
   the lock screen, where the system draws in one tint. */
struct Framed<Content: View, Back: View>: View {
  @Environment(\.widgetFamily) private var family
  let content: Content
  let back: Back

  var body: some View {
    if #available(iOSApplicationExtension 17.0, *) {
      content.containerBackground(for: .widget) { back }
    } else {
      legacy
    }
  }

  @ViewBuilder private var legacy: some View {
    if onHomeScreen {
      content.frame(maxWidth: .infinity, maxHeight: .infinity).padding().background(back)
    } else { content }
  }

  private var onHomeScreen: Bool {
    switch family {
    case .systemSmall, .systemMedium, .systemLarge, .systemExtraLarge: return true
    default: return false
    }
  }
}

extension View {
  func widgetBackground<B: View>(_ back: B) -> some View { Framed(content: self, back: back) }

  func shadowed() -> some View { self.shadow(color: .black.opacity(0.35), radius: 3, x: 0, y: 1) }

  func direction(_ data: WData?) -> some View {
    self.environment(\.layoutDirection, (data?.rightToLeft ?? phoneReadsFromRight) ? .rightToLeft : .leftToRight)
  }
}

func widgetLink(_ kind: String) -> URL { URL(string: "sunnati://screen/" + kind)! }

/* A fixed time as the app writes it: in the reader's language and figures,
   and in twelve or twenty-four hours as chosen there. The phone's own format
   only when the page gave none, as for the iqama. */
func clockText(_ clock: String?, _ at: Date) -> Text {
  if let c = clock, !c.isEmpty { return Text(verbatim: c) }
  return Text(at, style: .time)
}

// MARK: - the next prayer

struct PrayerView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family

  private var data: WData? { entry.data }
  private var next: NextLine? { NextLine.at(entry.date, data, entry.times) }

  var body: some View {
    Group {
      if let n = next {
        switch family {
        case .systemMedium: medium(n)
        case .systemLarge: large(n)
        case .systemSmall: small(n)
        default:
          if #available(iOSApplicationExtension 16.0, *) { lock(n) } else { small(n) }
        }
      } else {
        VStack(alignment: .leading, spacing: 4) {
          Text("سُنّتي").font(plex(data, 17, .semibold, .headline))
          Text(says(data, "open", "افتح التطبيق لحساب الأوقات")).font(plex(data, 11, .regular, .caption2))
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .direction(data)
    .widgetURL(widgetLink("widgetPrayer"))
  }

  private func small(_ n: NextLine) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(n.head).font(plex(data, 11, .semibold, .caption2)).opacity(0.85)
      Text(n.name).font(plex(data, 22, .bold, .title2)).lineLimit(1).minimumScaleFactor(0.7)
      if !n.sub.isEmpty { Text(n.sub).font(plex(data, 12, .bold, .caption)).foregroundStyle(Palette.gold) }
      clockText(n.clock, n.to).font(plex(data, 12, .regular, .caption)).opacity(0.9)
      Spacer(minLength: 0)
      Text(n.to, style: .timer).font(plex(data, 20, .semibold, .title3).monospacedDigit())
      GoneBar(from: n.from, to: n.to)
    }
    .foregroundStyle(.white)
    .shadowed()
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  private func medium(_ n: NextLine) -> some View {
    HStack(alignment: .top, spacing: 16) {
      small(n)
      FiveList(data: data, now: entry.date, compact: true)
        .frame(maxWidth: .infinity)
    }
  }

  private func large(_ n: NextLine) -> some View {
    let today = data?.day(entry.date)
    return VStack(alignment: .leading, spacing: 10) {
      if let t = today {
        HStack {
          Text("\(t.day)  \(t.hijri)").font(plex(data, 12, .semibold, .caption))
          Spacer(minLength: 4)
          Text(data?.place ?? "").font(plex(data, 11, .regular, .caption2)).opacity(0.85)
        }
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(n.head).font(plex(data, 12, .semibold, .caption)).opacity(0.85)
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(n.name).font(plex(data, 34, .bold, .largeTitle))
          if !n.sub.isEmpty { Text(n.sub).font(plex(data, 15, .bold, .subheadline)).foregroundStyle(Palette.gold) }
          Spacer(minLength: 4)
          Text(n.to, style: .timer).font(plex(data, 22, .semibold, .title2).monospacedDigit())
        }
        GoneBar(from: n.from, to: n.to)
      }
      FiveList(data: data, now: entry.date, compact: false)
      Spacer(minLength: 0)
      if let o = today?.occasion {
        HStack {
          Image(systemName: "moon.stars.fill").font(.caption)
          Text(o.name).font(plex(data, 12, .semibold, .caption))
          Spacer(minLength: 4)
          Text(o.when).font(plex(data, 12, .regular, .caption))
        }
        .opacity(0.9)
      }
    }
    .foregroundStyle(.white)
    .shadowed()
  }

  /* The lock screen and the watch face draw in one tint, so the widget gives
     them words and figures only. */
  @available(iOSApplicationExtension 16.0, *)
  @ViewBuilder private func lock(_ n: NextLine) -> some View {
    switch family {
    case .accessoryInline:
      Text("\(n.name) ") + clockText(n.clock, n.to)
    case .accessoryCircular:
      ProgressView(timerInterval: min(n.from, n.to)...n.to, countsDown: false) {
        EmptyView()
      } currentValueLabel: {
        VStack(spacing: 0) {
          Text(n.name).font(plex(data, 10, .semibold, .caption2)).lineLimit(1).minimumScaleFactor(0.5)
          clockText(n.clock, n.to).font(plex(data, 11, .regular, .caption2).monospacedDigit()).lineLimit(1).minimumScaleFactor(0.5)
        }
      }
      .progressViewStyle(.circular)
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 4) {
          Text(n.name).font(plex(data, 17, .semibold, .headline))
          clockText(n.clock, n.to).font(plex(data, 12, .regular, .caption).monospacedDigit())
        }
        Text(n.to, style: .timer).font(plex(data, 17, .regular, .body).monospacedDigit())
        GoneBar(from: n.from, to: n.to, tint: .primary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    default:
      small(n)
    }
  }
}

/* the day's five prayers, the one coming in bold, the ones gone faded and
   marked when the reader marked them prayed; after the isha, the day ahead */
struct FiveList: View {
  let data: WData?
  let now: Date
  let compact: Bool

  private var five: [WPrayer] {
    guard let d = data else { return [] }
    if let today = d.day(now), let last = today.five.last, last.when > now { return today.five }
    return d.day(now.addingTimeInterval(86400))?.five ?? d.day(now)?.five ?? []
  }

  var body: some View {
    let list = five
    let nextKey = list.first(where: { $0.when > now })?.key
    VStack(alignment: .leading, spacing: compact ? 3 : 7) {
      ForEach(Array(list.enumerated()), id: \.offset) { _, p in
        let gone = p.when <= now
        let isNext = p.key == nextKey && !gone
        HStack(spacing: 6) {
          Text(p.label).font(plex(data, compact ? 12 : 15, isNext ? .bold : .regular, compact ? .caption : .subheadline))
          if p.prayed == true { Image(systemName: "checkmark").font(.caption2.weight(.bold)) }
          Spacer(minLength: 4)
          clockText(p.clock, p.when).font(plex(data, compact ? 12 : 15, isNext ? .bold : .regular, compact ? .caption : .subheadline).monospacedDigit())
        }
        .opacity(gone ? 0.6 : 1)
        .padding(.horizontal, isNext && !compact ? 8 : 0)
        .padding(.vertical, isNext && !compact ? 4 : 0)
        .background(isNext && !compact ? Capsule().fill(Color.white.opacity(0.22)) : nil)
      }
    }
    .foregroundStyle(.white)
  }
}

struct PrayerWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiPrayer", provider: Provider()) { entry in
      PrayerView(entry: entry).widgetBackground(skyBack(entry.data, entry.data?.sky(entry.date) ?? Sky.byHour(entry.date)))
    }
    .configurationDisplayName("الصلاة القادمة")
    .description("الصلاة القادمة والوقت الباقي عليها فوق سماء الساعة")
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

// MARK: - the day's five prayers in a row

struct DayView: View {
  let entry: Entry
  private var data: WData? { entry.data }

  var body: some View {
    let now = entry.date
    let today = data?.day(now)
    let showTomorrow = (today?.five.last?.when ?? .distantFuture) <= now
    let day = showTomorrow ? (data?.day(now.addingTimeInterval(86400)) ?? today) : today
    let list = day?.five ?? []
    let nextKey = list.first(where: { $0.when > now })?.key
    return VStack(alignment: .leading, spacing: 8) {
      VStack(alignment: .leading, spacing: 2) {
        Text("\(day?.day ?? "")  \(day?.hijri ?? "")").font(plex(data, 15, .bold, .subheadline)).lineLimit(1).minimumScaleFactor(0.8)
        /* the civil date under the hijri one, and the place beside it */
        Text([day?.civil ?? "", data?.place ?? ""].filter { !$0.isEmpty }.joined(separator: "  \u{00B7}  "))
          .font(plex(data, 11, .regular, .caption2)).opacity(0.85).lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Spacer(minLength: 0)
      HStack(spacing: 4) {
        ForEach(Array(list.enumerated()), id: \.offset) { _, p in
          let gone = p.when <= now
          let isNext = p.key == nextKey && !gone
          VStack(spacing: 3) {
            Text(p.label).font(plex(data, 12, .regular, .caption)).lineLimit(1).minimumScaleFactor(0.7)
            clockText(p.short ?? p.clock, p.when).font(plex(data, 12, .bold, .caption).monospacedDigit()).lineLimit(1).minimumScaleFactor(0.7)
            Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).opacity(p.prayed == true ? 1 : 0)
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
          .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(isNext ? 0.25 : 0)))
          .opacity(gone ? 0.6 : 1)
        }
      }
    }
    .foregroundStyle(.white)
    .shadowed()
    .direction(data)
    .widgetURL(widgetLink("widgetDay"))
  }
}

struct DayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiDay", provider: Provider()) { entry in
      DayView(entry: entry).widgetBackground(skyBack(entry.data, entry.data?.sky(entry.date) ?? Sky.byHour(entry.date)))
    }
    .configurationDisplayName("صلوات اليوم")
    .description("صلوات اليوم الخمس بأوقاتها، والقادمة منها بارزة")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - the hijri date

struct HijriView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family
  private var data: WData? { entry.data }

  private var words: (day: String, hijri: String) {
    if let t = data?.day(entry.date) { return (t.day, t.hijri) }
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
      if #available(iOSApplicationExtension 16.0, *) { sized(words) } else { card(words) }
    }
    .direction(data)
    .widgetURL(widgetLink("widgetHijri"))
  }

  /* the civil date in the reader's language, as the page writes it; the
     phone's own before the app has handed anything */
  private var civil: Text {
    if let c = data?.day(entry.date)?.civil, !c.isEmpty { return Text(verbatim: c) }
    return Text(entry.date, style: .date)
  }

  private func card(_ t: (day: String, hijri: String)) -> some View {
    let occasion = data?.day(entry.date)?.occasion
    return VStack(spacing: 4) {
      Text(t.day).font(plex(data, 12, .regular, .caption)).foregroundStyle(Palette.muted)
      Text(t.hijri)
        .font(plex(data, 20, .bold, .title3))
        .multilineTextAlignment(.center)
        .minimumScaleFactor(0.6)
        .foregroundStyle(Palette.accent)
      civil.font(plex(data, 11, .regular, .caption2)).foregroundStyle(Palette.muted)
      if family == .systemMedium, let o = occasion {
        HStack(spacing: 6) {
          Image(systemName: "moon.stars.fill").font(.caption2)
          Text(o.name).font(plex(data, 12, .semibold, .caption))
          Text(o.when).font(plex(data, 12, .regular, .caption))
        }
        .foregroundStyle(Palette.ink)
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(Capsule().fill(Palette.accent.opacity(0.12)))
        .padding(.top, 4)
      }
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
      VStack(alignment: .leading, spacing: 1) {
        Text(t.day).font(plex(data, 11, .regular, .caption2)).foregroundStyle(.secondary)
        Text(t.hijri).font(plex(data, 17, .semibold, .headline)).minimumScaleFactor(0.7)
        if let o = data?.day(entry.date)?.occasion { Text("\(o.name) \(o.when)").font(plex(data, 11, .regular, .caption2)).lineLimit(1) }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    default:
      card(t)
    }
  }
}

struct HijriWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiHijri", provider: Provider()) { entry in
      HijriView(entry: entry).widgetBackground(paperBack(entry.data))
    }
    .configurationDisplayName("التاريخ الهجري")
    .description("التاريخ الهجري اليوم والمناسبة القادمة")
    .supportedFamilies(families)
  }

  private var families: [WidgetFamily] {
    if #available(iOSApplicationExtension 16.0, *) {
      return [.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline]
    }
    return [.systemSmall, .systemMedium]
  }
}

// MARK: - the ayah of the day

struct AyahView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family
  private var data: WData? { entry.data }

  var body: some View {
    /* the day's own ayah, then the others the page handed, as far round as
       the refresh has been tapped today */
    let own = data?.day(entry.date)?.ayah
    let pool: [WAyah] = own.map { [$0] + (data?.ayat ?? []) } ?? []
    let turn = pool.isEmpty ? 0 : Turn.count("ayah", on: entry.date) % pool.count
    let ayah = pool.isEmpty ? nil : pool[turn]
    let page = ayah?.page ?? 0
    let large = family == .systemLarge
    /* the heading at the top, the ayah filling the middle between its
       ornate brackets, a short gold rule and its surah and number under it */
    return VStack(spacing: 6) {
      Text(says(data, "ayah", "آية اليوم")).font(plex(data, 12, .bold, .caption)).foregroundStyle(Palette.accent)
        .frame(maxWidth: .infinity, alignment: .leading)
      Text(ayah.map { "\u{FD3F}\($0.t.trimmingCharacters(in: .whitespaces))\u{FD3E}" } ?? (says(data, "openApp", "افتح التطبيق")))
        .font(.custom("AmiriQuran-Regular", size: large ? 32 : 22))
        .foregroundStyle(Palette.ink)
        .multilineTextAlignment(.center)
        .lineSpacing(large ? 12 : 5)
        .lineLimit(large ? 10 : 4)
        .minimumScaleFactor(0.45)
        .environment(\.layoutDirection, .rightToLeft)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      if let ref = ayah?.ref, !ref.isEmpty {
        Capsule().fill(Palette.rule.opacity(0.7)).frame(width: 36, height: 1.5)
        /* the reference in the middle, and at the end the refresh that
           turns to an ayah of another surah */
        ZStack(alignment: .trailing) {
          Text(ref).font(plex(data, 11, .semibold, .caption2)).foregroundStyle(Palette.muted).lineLimit(1)
            .minimumScaleFactor(0.8).padding(.horizontal, 38).frame(maxWidth: .infinity)
          if #available(iOSApplicationExtension 17.0, *) {
            Button(intent: NextAyahIntent()) { RefreshMark() }.buttonStyle(.plain)
              .accessibilityLabel(says(data, "anotherAyah", "آية أخرى"))
          }
        }
      }
    }
    .direction(data)
    .widgetURL(widgetLink(turn > 0 && page > 0 ? "widgetPage\(page)" : "widgetAyah"))
  }
}

struct AyahWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiAyah", provider: Provider()) { entry in
      AyahView(entry: entry).widgetBackground(paperBack(entry.data))
    }
    .configurationDisplayName("آية اليوم")
    .description("آية كل يوم من المصحف، تفتح صفحتها بلمسة")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}

// MARK: - the khatma

struct KhatmaView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family
  private var data: WData? { entry.data }

  var body: some View {
    let k = data?.khatma
    let total = max(1, k?.total ?? 604)
    let read = min(total, max(0, k?.read ?? 0))
    let share = Double(read) / Double(total)
    let percent = Int((share * 100).rounded())
    return Group {
      if family == .systemSmall {
        VStack(spacing: 6) {
          Text(says(data, "khatma", "ختمتي")).font(plex(data, 12, .bold, .caption)).foregroundStyle(Palette.accent)
          ZStack {
            Circle().stroke(Palette.accent.opacity(0.15), lineWidth: 8)
            Circle().trim(from: 0, to: share)
              .stroke(Palette.accent, style: StrokeStyle(lineWidth: 8, lineCap: .round))
              .rotationEffect(.degrees(-90))
            Text(verbatim: data?.figures("\(percent)%") ?? "\(percent)%").font(plex(data, 20, .bold, .title3).monospacedDigit()).foregroundStyle(Palette.ink)
          }
          .frame(width: 70, height: 70)
          Text(verbatim: pageLine(k?.page ?? 1, total))
            .font(plex(data, 11, .regular, .caption2)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.7)
          if let w = k?.wird, !w.isEmpty {
            Text(verbatim: "\(says(data, "wird", "وردك اليوم")) \(w)").font(plex(data, 11, .regular, .caption2)).foregroundStyle(Palette.muted).lineLimit(1).minimumScaleFactor(0.7)
          }
        }
      } else {
        ring(share, percent)
      }
    }
    .direction(data)
    .widgetURL(widgetLink("widgetKhatma"))
  }

  private func pageLine(_ page: Int, _ total: Int) -> String {
    let f = { (n: Int) -> String in data?.figures(String(n)) ?? String(n) }
    return "\(says(data, "page", "صفحة")) \(f(page)) \(says(data, "of", "من")) \(f(total))"
  }

  /* on the lock screen, the system's own ring */
  @ViewBuilder private func ring(_ share: Double, _ percent: Int) -> some View {
    if #available(iOSApplicationExtension 16.0, *) {
      Gauge(value: share) { Text(verbatim: "") } currentValueLabel: { Text(verbatim: data?.figures(String(percent)) ?? String(percent)) }
        .gaugeStyle(.accessoryCircularCapacity)
    } else {
      Text(verbatim: data?.figures("\(percent)%") ?? "\(percent)%")
    }
  }
}

struct KhatmaWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiKhatma", provider: Provider()) { entry in
      KhatmaView(entry: entry).widgetBackground(paperBack(entry.data))
    }
    .configurationDisplayName("ختمتي")
    .description("ما قرأته من ختمتك وورد اليوم")
    .supportedFamilies(families)
  }

  private var families: [WidgetFamily] {
    if #available(iOSApplicationExtension 16.0, *) { return [.systemSmall, .accessoryCircular] }
    return [.systemSmall]
  }
}

// MARK: - the adhkar of the hour

struct AdhkarView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family
  private var data: WData? { entry.data }

  var body: some View {
    let a = data?.adhkar(entry.date)
    let total = max(1, a?.total ?? 1)
    let done = min(total, max(0, a?.done ?? 0))
    let finished = a != nil && done >= total
    let f = { (n: Int) -> String in data?.figures(String(n)) ?? String(n) }
    let count = finished ? (says(data, "done", "أتممتها اليوم"))
      : "\(f(done)) \(says(data, "of", "من")) \(f(total))"
    return Group {
      if family == .systemSmall {
        VStack(alignment: .leading, spacing: 6) {
          Text(verbatim: says(data, "adhkar", "الأذكار")).font(plex(data, 12, .regular, .caption)).foregroundStyle(Palette.muted)
          Text(a?.title ?? "سُنّتي").font(plex(data, 20, .bold, .title3)).foregroundStyle(Palette.accent)
            .lineLimit(2).minimumScaleFactor(0.7)
          Spacer(minLength: 0)
          ProgressView(value: Double(done), total: Double(total)).tint(Palette.accent)
          HStack {
            Text(count).font(plex(data, 12, .regular, .caption).monospacedDigit()).foregroundStyle(Palette.ink)
            Spacer(minLength: 0)
            if finished { Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.accent) }
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      } else {
        VStack(alignment: .leading, spacing: 2) {
          Text(a?.title ?? "سُنّتي").font(plex(data, 17, .semibold, .headline)).lineLimit(1)
          ProgressView(value: Double(done), total: Double(total))
          Text(count).font(plex(data, 11, .regular, .caption2))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .direction(data)
    .widgetURL(widgetLink("widgetAdhkar"))
  }
}

struct AdhkarWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiAdhkar", provider: Provider()) { entry in
      AdhkarView(entry: entry).widgetBackground(paperBack(entry.data))
    }
    .configurationDisplayName("الأذكار")
    .description("أذكار الوقت وما أتممته منها اليوم")
    .supportedFamilies(families)
  }

  private var families: [WidgetFamily] {
    if #available(iOSApplicationExtension 16.0, *) { return [.systemSmall, .accessoryRectangular] }
    return [.systemSmall]
  }
}

// MARK: - turning to another

/* How many times a widget's refresh has been tapped today, kept in the
   container the app shares: the ayah and the du'a turn to the next of the
   ones the page handed, and a new day starts on the day's own again. */
enum Turn {
  /* read afresh each time: a shared object kept in a static would not be safe across threads */
  private static var store: UserDefaults? { UserDefaults(suiteName: "group.com.eworldq8.sunnati") }

  private static func day(_ at: Date) -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: at)
  }

  /* by the entry's own date: an entry drawn ahead for after midnight opens
     the new day on its own ayah, not on the one turned to the day before */
  static func count(_ key: String, on at: Date) -> Int {
    guard let s = store, s.string(forKey: "turnDay_" + key) == day(at) else { return 0 }
    return max(0, s.integer(forKey: "turn_" + key))
  }

  static func next(_ key: String) {
    let now = count(key, on: Date()) + 1
    store?.set(day(Date()), forKey: "turnDay_" + key)
    store?.set(now, forKey: "turn_" + key)
  }
}

@available(iOSApplicationExtension 17.0, *)
struct NextAyahIntent: AppIntent {
  static let title: LocalizedStringResource = "آية أخرى"
  func perform() async throws -> some IntentResult {
    Turn.next("ayah")
    return .result()
  }
}

@available(iOSApplicationExtension 17.0, *)
struct NextDuaIntent: AppIntent {
  static let title: LocalizedStringResource = "دعاء آخر"
  func perform() async throws -> some IntentResult {
    Turn.next("dua")
    return .result()
  }
}

/* the round refresh drawn on the paper */
struct RefreshMark: View {
  var body: some View {
    Image(systemName: "arrow.clockwise")
      .font(.system(size: 12, weight: .bold))
      .foregroundStyle(Palette.accent)
      .frame(width: 30, height: 30)
      .background(Circle().fill(Palette.accent.opacity(0.12)))
  }
}

// MARK: - the du'a of the day

struct DuaView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family
  private var data: WData? { entry.data }

  var body: some View {
    let pool = data?.duas ?? []
    let dua = pool.isEmpty ? nil : pool[Turn.count("dua", on: entry.date) % pool.count]
    let large = family == .systemLarge
    return VStack(spacing: 6) {
      HStack {
        Text(says(data, "dua", "دعاء اليوم")).font(plex(data, 12, .bold, .caption)).foregroundStyle(Palette.accent)
        Spacer(minLength: 6)
        Text(dua?.n ?? "").font(plex(data, 11, .semibold, .caption2)).foregroundStyle(Palette.muted).lineLimit(1)
      }
      Text(dua?.t ?? says(data, "openApp", "افتح التطبيق"))
        .font(plex(data, large ? 22 : 16, .semibold, .body))
        .foregroundStyle(Palette.ink)
        .multilineTextAlignment(.center)
        .lineSpacing(large ? 8 : 4)
        .lineLimit(large ? 9 : 4)
        .minimumScaleFactor(0.6)
        .environment(\.layoutDirection, .rightToLeft)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      Capsule().fill(Palette.rule.opacity(0.7)).frame(width: 36, height: 1.5)
      /* its source in the middle, and at the end the refresh */
      ZStack(alignment: .trailing) {
        Text(dua?.r ?? "").font(plex(data, 11, .semibold, .caption2)).foregroundStyle(Palette.muted).lineLimit(1)
          .minimumScaleFactor(0.8).padding(.horizontal, 38).frame(maxWidth: .infinity)
        if dua != nil {
          if #available(iOSApplicationExtension 17.0, *) {
            Button(intent: NextDuaIntent()) { RefreshMark() }.buttonStyle(.plain)
              .accessibilityLabel(says(data, "anotherDua", "دعاء آخر"))
          }
        }
      }
      .frame(height: 30)
    }
    .direction(data)
    .widgetURL(widgetLink(dua?.i.map { "widgetDua\($0)" } ?? "widgetDua"))
  }
}

struct DuaWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiDua", provider: Provider()) { entry in
      DuaView(entry: entry).widgetBackground(paperBack(entry.data))
    }
    .configurationDisplayName("دعاء اليوم")
    .description("دعاء كل يوم من القرآن والسنة بمصدره، وغيره بلمسة")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}

// MARK: - the tasbih

struct TasbihView: View {
  let entry: Entry
  private var data: WData? { entry.data }

  var body: some View {
    let t = data?.tasbih
    /* a count kept on another day is not today's */
    let today = data?.days.first?.date == data?.day(entry.date)?.date && data?.day(entry.date) != nil
    let target = max(1, t?.target ?? 33)
    let count = today ? max(0, t?.count ?? 0) : 0
    let total = today ? max(0, t?.total ?? 0) : 0
    let f = { (n: Int) -> String in data?.figures(String(n)) ?? String(n) }
    let under: String = total > count ? "\(says(data, "today", "مجموع اليوم")) \(f(total))"
      : count >= target ? says(data, "reached", "بلغت الهدف")
      : "\(says(data, "target", "الهدف")) \(f(target))"
    return VStack(spacing: 5) {
      Text(says(data, "tasbih", "المسبحة")).font(plex(data, 12, .bold, .caption)).foregroundStyle(Palette.accent)
      ZStack {
        Circle().stroke(Palette.accent.opacity(0.15), lineWidth: 8)
        Circle().trim(from: 0, to: min(1, Double(count) / Double(target)))
          .stroke(Palette.accent, style: StrokeStyle(lineWidth: 8, lineCap: .round))
          .rotationEffect(.degrees(-90))
        Text(verbatim: f(count)).font(plex(data, 22, .bold, .title3).monospacedDigit()).foregroundStyle(Palette.ink)
          .minimumScaleFactor(0.6)
      }
      .frame(width: 70, height: 70)
      Text(t?.t ?? "سبحان الله").font(plex(data, 13, .bold, .footnote)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.7)
      Text(verbatim: under).font(plex(data, 11, .regular, .caption2)).foregroundStyle(Palette.muted).lineLimit(1).minimumScaleFactor(0.7)
    }
    .direction(data)
    .widgetURL(widgetLink("widgetTasbih"))
  }
}

struct TasbihWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiTasbih", provider: Provider()) { entry in
      TasbihView(entry: entry).widgetBackground(paperBack(entry.data))
    }
    .configurationDisplayName("المسبحة")
    .description("ذكرك وعدّه، والمسبحة على بعد لمسة")
    .supportedFamilies([.systemSmall])
  }
}

// MARK: - my prayers today

struct LogView: View {
  let entry: Entry
  private var data: WData? { entry.data }

  var body: some View {
    let day = data?.day(entry.date)
    /* only the first day handed carries the marks of prayers prayed */
    let marked = day != nil && day?.date == data?.days.first?.date
    let five = day?.five ?? []
    let done = five.map { marked && ($0.prayed ?? false) }
    let next = five.firstIndex { !(marked && ($0.prayed ?? false)) && $0.when > entry.date }
    let prayed = done.filter { $0 }.count
    let f = { (n: Int) -> String in data?.figures(String(n)) ?? String(n) }
    let count: String = five.isEmpty ? says(data, "openApp", "افتح التطبيق")
      : prayed >= 5 ? says(data, "allPrayed", "صلّيت الصلوات الخمس")
      : "\(f(prayed)) \(says(data, "of", "من")) \(f(5))"
    return VStack(spacing: 10) {
      HStack {
        Text(says(data, "log", "صلواتي اليوم")).font(plex(data, 12, .bold, .caption)).foregroundStyle(Palette.accent)
        Spacer(minLength: 6)
        Text(verbatim: count).font(plex(data, 11, .semibold, .caption2)).foregroundStyle(Palette.muted).lineLimit(1)
      }
      HStack(spacing: 0) {
        ForEach(Array(five.enumerated()), id: \.offset) { i, p in
          VStack(spacing: 5) {
            ZStack {
              if done[i] {
                Circle().fill(Palette.accent)
                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Palette.paper)
              } else if next == i {
                Circle().fill(Palette.accent.opacity(0.12))
                Circle().stroke(Palette.accent, lineWidth: 2)
              } else {
                Circle().stroke(Palette.muted.opacity(0.35), lineWidth: 2)
              }
            }
            .frame(width: 30, height: 30)
            Text(p.label).font(plex(data, 11, .bold, .caption2)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.7)
          }
          .frame(maxWidth: .infinity)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(spoken(p.label, done[i]))
        }
      }
      .frame(maxHeight: .infinity)
    }
    .direction(data)
    .widgetURL(widgetLink("widgetLog"))
  }
}

extension LogView {
  /* a prayer's name, and that it is prayed */
  func spoken(_ name: String, _ prayed: Bool) -> String {
    prayed ? name + "، " + says(data, "prayed", "صلّيت") : name
  }
}

struct LogWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SunnatiLog", provider: Provider()) { entry in
      LogView(entry: entry).widgetBackground(paperBack(entry.data))
    }
    .configurationDisplayName("صلواتي اليوم")
    .description("صلوات اليوم الخمس وما علّمته منها")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - all of them

@main
struct SunnatiWidgets: WidgetBundle {
  var body: some Widget {
    PrayerWidget()
    DayWidget()
    HijriWidget()
    AyahWidget()
    KhatmaWidget()
    AdhkarWidget()
    DuaWidget()
    TasbihWidget()
    LogWidget()
  }
}
