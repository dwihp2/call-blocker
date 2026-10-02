import Foundation

/**
 The matching and expansion engine for iOS.

 Two things use it at two different times. The app calls `evaluate` for a Number
 check and `effectiveBlockList` when Blocking is pushed to the platform; the
 Call Directory extension only reads what the app already wrote, so it never
 matches anything itself. Because the extension target compiles this file too,
 it must stay free of ExpoModulesCore — Foundation only.

 `fixtures/matching.json` is the contract: `fixtureFailures` runs it, and the
 Kotlin engine runs the same table.
 */

// MARK: - Contract types

/** One Rule as the engine sees it. `kind` is `block` or `allow`, `pattern` is `single`, `prefix` or `interval`. */
public struct EngineRule {
  public let kind: String
  public let pattern: String
  /** A Single number, the digits a Prefix matches, or an Interval's start. */
  public let number: String
  /** Interval only: the inclusive end. */
  public let end: String?
  /**
   The lengths a Canonical number in this Rule's country can have, ascending
   and country code included. The app supplies them from number metadata so a
   Prefix expands across the lengths the country actually dials; without them
   the engine falls back to every length E.164 allows, which overstates what a
   Prefix costs and leaves shorter countries over-refused.
   */
  public let nationalLengths: [Int]?

  public init(kind: String, pattern: String, number: String, end: String? = nil, nationalLengths: [Int]? = nil) {
    self.kind = kind
    self.pattern = pattern
    self.number = number
    self.end = end
    self.nationalLengths = nationalLengths
  }
}

/** Everything the engine needs to answer a query, in the app's canonical Rule order. */
public struct EngineInput {
  public let blocking: Bool
  public let contactsAllowance: Bool
  public let contacts: [String]
  public let rules: [EngineRule]

  public init(blocking: Bool, contactsAllowance: Bool, contacts: [String] = [], rules: [EngineRule]) {
    self.blocking = blocking
    self.contactsAllowance = contactsAllowance
    self.contacts = contacts
    self.rules = rules
  }
}

/** What settled a decision. `rule` carries the index into `EngineInput.rules`. */
public enum EngineDecision: Equatable {
  case rule(Int)
  case contacts
  case off
  case none
}

public struct EngineResult {
  public let blocked: Bool
  public let decidedBy: EngineDecision
  /** Every Rule the number matches, in input order, including ones that lost. */
  public let matches: [Int]

  public init(blocked: Bool, decidedBy: EngineDecision, matches: [Int]) {
    self.blocked = blocked
    self.decidedBy = decidedBy
    self.matches = matches
  }
}

extension EngineDecision: CustomStringConvertible {
  public var description: String {
    switch self {
    case .rule(let index): return "rule(\(index))"
    case .contacts: return "contacts"
    case .off: return "off"
    case .none: return "none"
    }
  }
}

// MARK: - Numbers

/**
 Capacity: how many numbers the iPhone can hold in its blocking list at once. A
 change that would push the Effective block list past it is refused, never
 silently trimmed (see `docs/adr/0004`).

 The number is measured, not chosen: on an iPhone 15 running iOS 27.0, lists of
 1, 1'111, 11'111 and 50'000 entries all reload cleanly and load, while 75'000,
 100'000 and 111'112 make CallKit answer `loadingInterrupted` and never launch
 the extension at all — the failure that kept this app from blocking anything
 (see `docs/research/ios-call-blocking.md` §4b). 25'000 leaves half the measured
 ceiling as headroom.
 */
public let callDirectoryCapacity = 25_000

/** The longest number E.164 allows, and so the length a Prefix expands to. */
private let maxE164Digits = 15

/** E.164 digits only: the leading `+` and any separators a typed number may carry are dropped. */
func engineDigits(_ value: String) -> String {
  return String(value.filter { $0.isASCII && $0.isNumber })
}

private func pow10(_ exponent: Int) -> Int64 {
  var result: Int64 = 1
  for _ in 0..<max(0, exponent) {
    result *= 10
  }
  return result
}

/** An inclusive run of numbers. */
private struct NumberRange {
  let lower: Int64
  let upper: Int64

  var count: Int {
    let span = upper - lower + 1
    return span > Int64(Int.max) ? Int.max : Int(span)
  }
}

private func normalize(_ ranges: [NumberRange]) -> [NumberRange] {
  let sorted = ranges.filter { $0.lower <= $0.upper }.sorted { $0.lower < $1.lower }
  var merged: [NumberRange] = []
  for range in sorted {
    if let last = merged.last, range.lower <= last.upper + 1 {
      merged[merged.count - 1] = NumberRange(lower: last.lower, upper: max(last.upper, range.upper))
    } else {
      merged.append(range)
    }
  }
  return merged
}

/** `base` minus `cut`, both normalized ascending. */
private func subtract(_ base: [NumberRange], _ cut: [NumberRange]) -> [NumberRange] {
  guard !cut.isEmpty else { return base }
  var result: [NumberRange] = []
  var cutIndex = 0
  for range in base {
    var cursor = range.lower
    while cutIndex < cut.count, cut[cutIndex].upper < cursor {
      cutIndex += 1
    }
    var index = cutIndex
    while index < cut.count, cut[index].lower <= range.upper {
      let hole = cut[index]
      if hole.lower > cursor {
        result.append(NumberRange(lower: cursor, upper: hole.lower - 1))
      }
      cursor = max(cursor, hole.upper + 1)
      if cursor > range.upper {
        break
      }
      index += 1
    }
    if cursor <= range.upper {
      result.append(NumberRange(lower: cursor, upper: range.upper))
    }
  }
  return result
}

// MARK: - Matching

/** A Rule with its digits and its expansion precomputed once per query. */
private struct CompiledRule {
  let index: Int
  let kind: String
  let pattern: String
  let digits: String
  let isSingle: Bool
  /** Every number this Rule covers. Empty when its number cannot be read as one. */
  let ranges: [NumberRange]

  /** How many numbers the Rule covers, for ranking rules against each other. */
  var width: Int {
    return ranges.reduce(0) { $0 > Int.max - $1.count ? Int.max : $0 + $1.count }
  }

  init(index: Int, rule: EngineRule) {
    self.index = index
    self.kind = rule.kind
    self.pattern = rule.pattern
    self.isSingle = rule.pattern == "single"
    let digits = engineDigits(rule.number)
    self.digits = digits

    switch rule.pattern {
    case "single":
      self.ranges = Int64(digits).map { [NumberRange(lower: $0, upper: $0)] } ?? []
    case "prefix":
      // A Prefix covers every number that begins with it, at every length a
      // number in that country can have, so it is expanded arithmetically into
      // one run per length — never number by number. A prefix that short is
      // certain to pass Capacity; `sync` reports that instead of trimming.
      guard digits.count <= 18, let value = Int64(digits) else {
        self.ranges = []
        break
      }
      let countryLengths = (rule.nationalLengths ?? []).filter { $0 >= digits.count && $0 <= maxE164Digits }
      let lengths = countryLengths.isEmpty ? Array(digits.count...maxE164Digits) : countryLengths
      let ranges: [NumberRange] = lengths.map { length in
        let span = pow10(length - digits.count)
        let lower = value * span
        return NumberRange(lower: lower, upper: lower + span - 1)
      }
      self.ranges = ranges
    case "interval":
      let start = Int64(digits)
      let finish = Int64(engineDigits(rule.end ?? ""))
      if let start, let finish, start <= finish {
        self.ranges = [NumberRange(lower: start, upper: finish)]
      } else {
        self.ranges = []
      }
    default:
      self.ranges = []
    }
  }

  func matches(digits queryDigits: String, value queryValue: Int64?) -> Bool {
    switch pattern {
    case "single":
      return !digits.isEmpty && digits == queryDigits
    case "prefix":
      return !digits.isEmpty && queryDigits.hasPrefix(digits)
    case "interval":
      guard let queryValue else {
        return false
      }
      return ranges.contains { queryValue >= $0.lower && queryValue <= $0.upper }
    default:
      return false
    }
  }
}

private func compile(_ input: EngineInput) -> [CompiledRule] {
  return input.rules.enumerated().map { CompiledRule(index: $0.offset, rule: $0.element) }
}

// MARK: - Decisions

/**
 The precedence the fixture table states, highest first: Blocking off, a matching
 Allow rule, a matching Single number Block rule (beating Contacts allowance),
 Contacts allowance, any other matching Block rule, then allowed.

 Blocking off decides `off` without consulting a Rule, but `matches` still
 reports the Rules the number matches: it is a report for the Number check, not
 a decision.
 */
public func evaluate(_ input: EngineInput, query: String) -> EngineResult {
  let queryDigits = engineDigits(query)
  let queryValue = Int64(queryDigits)
  let matched = compile(input).filter { $0.matches(digits: queryDigits, value: queryValue) }
  let matches = matched.map { $0.index }

  guard input.blocking else {
    return EngineResult(blocked: false, decidedBy: .off, matches: matches)
  }

  if let allow = matched.first(where: { $0.kind == "allow" }) {
    return EngineResult(blocked: false, decidedBy: .rule(allow.index), matches: matches)
  }
  if let single = matched.first(where: { $0.kind == "block" && $0.isSingle }) {
    return EngineResult(blocked: true, decidedBy: .rule(single.index), matches: matches)
  }
  if input.contactsAllowance, input.contacts.contains(where: { engineDigits($0) == queryDigits }) {
    return EngineResult(blocked: false, decidedBy: .contacts, matches: matches)
  }
  if let block = matched.first(where: { $0.kind == "block" }) {
    return EngineResult(blocked: true, decidedBy: .rule(block.index), matches: matches)
  }
  return EngineResult(blocked: false, decidedBy: .none, matches: matches)
}

// MARK: - Effective block list

/**
 The numbers actually blocked right now: the Block rules expanded, minus every
 number an Allow rule matches, minus the Contacts when the allowance is on. A
 Single number Block rule outranks Contacts allowance, so a contact covered by
 one stays blocked.
 */
private func effectiveRanges(_ input: EngineInput) -> [NumberRange] {
  guard input.blocking else {
    return []
  }
  let rules = compile(input)
  let blocks = rules.filter { $0.kind == "block" }.flatMap { $0.ranges }
  let allows = rules.filter { $0.kind == "allow" }.flatMap { $0.ranges }
  var result = subtract(normalize(blocks), normalize(allows))

  if input.contactsAllowance {
    let singlyBlocked = Set(rules.filter { $0.kind == "block" && $0.isSingle }.map { $0.digits })
    let contactRanges = input.contacts
      .map { engineDigits($0) }
      .filter { !singlyBlocked.contains($0) }
      .compactMap { Int64($0) }
      .map { NumberRange(lower: $0, upper: $0) }
    result = subtract(result, normalize(contactRanges))
  }
  return result
}

/**
 The Effective block list, ascending and de-duplicated as CallKit requires.

 The work stops at Capacity plus one entry, so an enormous Prefix is reported as
 an overflow instead of being enumerated number by number.
 */
public func effectiveBlockList(_ input: EngineInput) -> [Int64] {
  var budget = callDirectoryCapacity + 1
  var numbers: [Int64] = []
  for range in effectiveRanges(input) {
    var value = range.lower
    while value <= range.upper, budget > 0 {
      numbers.append(value)
      budget -= 1
      value += 1
    }
    if budget == 0 {
      break
    }
  }
  return numbers
}

/**
 How many numbers the Effective block list holds, counted arithmetically: the
 answer can be far past Capacity, which is exactly what `sync` reports.
 */
public func effectiveBlockCount(_ input: EngineInput) -> Int {
  var total = 0
  for range in effectiveRanges(input) {
    let count = range.count
    if total > Int.max - count {
      return Int.max
    }
    total += count
  }
  return total
}

/** A Block rule's index paired with how many numbers it covers. */
private struct RuleWidth {
  let index: Int
  let width: Int
}

/**
 The indices of the widest Prefix and Interval Block rules that would have to go
 for the list to fit Capacity, widest first. Empty when it already fits. Nothing
 is dropped on its own: `sync` refuses the change and reports these (see
 `docs/adr/0004`).
 */
public func rejectedRuleIndices(_ input: EngineInput, capacity: Int = callDirectoryCapacity) -> [Int] {
  guard effectiveBlockCount(input) > capacity else {
    return []
  }
  var candidates: [RuleWidth] = []
  for (offset, rule) in input.rules.enumerated() where rule.kind == "block" && (rule.pattern == "prefix" || rule.pattern == "interval") {
    candidates.append(RuleWidth(index: offset, width: CompiledRule(index: offset, rule: rule).width))
  }
  candidates.sort { left, right in
    return left.width == right.width ? left.index < right.index : left.width > right.width
  }

  func without(_ removed: [Int]) -> EngineInput {
    let dropped = Set(removed)
    return EngineInput(
      blocking: input.blocking,
      contactsAllowance: input.contactsAllowance,
      contacts: input.contacts,
      rules: input.rules.enumerated().filter { !dropped.contains($0.offset) }.map { $0.element }
    )
  }

  var removed: [Int] = []
  for candidate in candidates {
    if effectiveBlockCount(without(removed)) <= capacity {
      break
    }
    removed.append(candidate.index)
  }
  return removed
}

// MARK: - Fixture contract

private struct FixtureFilePayload: Decodable {
  struct Case: Decodable {
    struct Rule: Decodable {
      let kind: String
      let pattern: String
      let number: String
      let end: String?
    }
    struct Expectation: Decodable {
      struct Source: Decodable {
        let type: String
        let index: Int?
      }
      let blocked: Bool
      let decidedBy: Source
    }
    let name: String
    let blocking: Bool?
    let contactsAllowance: Bool?
    let contacts: [String]?
    let rules: [Rule]
    let query: String
    let expect: Expectation
  }
  let version: Int
  let cases: [Case]
}

private func expectation(of source: FixtureFilePayload.Case.Expectation.Source) -> EngineDecision {
  switch source.type {
  case "rule": return .rule(source.index ?? -1)
  case "contacts": return .contacts
  case "off": return .off
  default: return .none
  }
}

/**
 Runs the fixture table through this engine and returns one line per failing
 case, so the app can prove the shipped matcher still honours the contract.
 */
public func fixtureFailures(_ fixturesJSON: String) -> [String] {
  let payload: FixtureFilePayload
  do {
    payload = try JSONDecoder().decode(FixtureFilePayload.self, from: Data(fixturesJSON.utf8))
  } catch {
    return ["fixture file could not be read: \(error)"]
  }

  var failures: [String] = []
  for testCase in payload.cases {
    let input = EngineInput(
      blocking: testCase.blocking ?? true,
      contactsAllowance: testCase.contactsAllowance ?? false,
      contacts: testCase.contacts ?? [],
      rules: testCase.rules.map { EngineRule(kind: $0.kind, pattern: $0.pattern, number: $0.number, end: $0.end) }
    )
    let expected = expectation(of: testCase.expect.decidedBy)
    let got = evaluate(input, query: testCase.query)
    if got.blocked != testCase.expect.blocked || got.decidedBy != expected {
      failures.append(
        "\(testCase.name): expected blocked=\(testCase.expect.blocked) decidedBy=\(expected), got blocked=\(got.blocked) decidedBy=\(got.decidedBy)"
      )
    }
  }
  return failures
}

// MARK: - Shared store

/** What `sync` recorded alongside the list, for Protection status. */
public struct CallDirectoryMeta {
  public let entries: Int
  public let generatedAt: String
  public let overflow: Bool

  public init(entries: Int, generatedAt: String, overflow: Bool) {
    self.entries = entries
    self.generatedAt = generatedAt
    self.overflow = overflow
  }
}

public enum CallDirectoryStoreError: Error, LocalizedError {
  case notEncodable

  public var errorDescription: String? {
    return "The block list could not be encoded for storage."
  }
}

/**
 What the extension did the last time CallKit asked it to load. Without it,
 nothing distinguishes "the extension loaded the numbers" from "the system never
 ran the extension", which are the two very different reasons a call is not
 blocked.
 */
public struct CallDirectoryLoad {
  public let startedAt: String
  public let finishedAt: String?
  public let entries: Int
  public let incremental: Bool
  /** What CallKit said when it refused the load, if it did. */
  public let failure: String?

  public init(startedAt: String, finishedAt: String?, entries: Int, incremental: Bool, failure: String? = nil) {
    self.startedAt = startedAt
    self.finishedAt = finishedAt
    self.entries = entries
    self.incremental = incremental
    self.failure = failure
  }
}

/**
 The App Group store the app writes and the extension reads. It lives here rather
 than in a third file because both targets compile this one: the app through its
 pod, the extension through the plugin's copied sources.

 `blocked.json` holds the numbers as JSON strings, `meta.json` the counts.
 */
public struct CallDirectoryStore {
  public static let defaultAppGroup = "group.com.callblocker.app"
  public static let numbersKey = "blocked.json"
  public static let metaKey = "meta.json"
  public static let loadKey = "load.json"
  public static let reloadKey = "reload.json"
  public static let loadedKey = "loaded.json"

  public let appGroup: String
  private let defaults: UserDefaults

  public init(appGroup: String = CallDirectoryStore.defaultAppGroup) {
    self.appGroup = appGroup
    self.defaults = UserDefaults(suiteName: appGroup) ?? .standard
  }

  /** The Effective block list, ascending and de-duplicated, as the extension needs it. */
  public func readNumbers() -> [Int64] {
    guard let json = defaults.string(forKey: Self.numbersKey),
          let strings = try? JSONDecoder().decode([String].self, from: Data(json.utf8)) else {
      return []
    }
    return Array(Set(strings.compactMap { Int64(engineDigits($0)) })).sorted()
  }

  public func readMeta() -> CallDirectoryMeta? {
    guard let json = defaults.string(forKey: Self.metaKey),
          let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
      return nil
    }
    return CallDirectoryMeta(
      entries: object["entries"] as? Int ?? 0,
      generatedAt: object["generatedAt"] as? String ?? "",
      overflow: object["overflow"] as? Bool ?? false
    )
  }

  public func write(numbers: [Int64], meta: CallDirectoryMeta) throws {
    let encoder = JSONEncoder()
    let strings = numbers.map { "+\($0)" }
    guard let numbersJSON = String(data: try encoder.encode(strings), encoding: .utf8) else {
      throw CallDirectoryStoreError.notEncodable
    }
    let metaJSON = try JSONSerialization.data(withJSONObject: [
      "entries": meta.entries,
      "generatedAt": meta.generatedAt,
      "overflow": meta.overflow
    ])
    defaults.set(numbersJSON, forKey: Self.numbersKey)
    defaults.set(String(decoding: metaJSON, as: UTF8.self), forKey: Self.metaKey)
  }

  /**
   The numbers this extension last handed to CallKit. Incremental requests must
   say what changed, not re-state everything, so the difference against this list
   is the whole request.
   */
  public func writeLoaded(_ numbers: [Int64]) {
    guard let data = try? JSONEncoder().encode(numbers.map(String.init)) else {
      return
    }
    defaults.set(String(decoding: data, as: UTF8.self), forKey: Self.loadedKey)
  }

  /**
   The numbers CallKit holds for this extension. When nothing has been recorded
   yet, the blocking list itself is the best answer: an entry that is already
   there cannot be added again — CallKit answers `UNIQUE constraint failed:
   PhoneNumberBlockingEntry`, which only happens when the row exists.
   */
  public func readLoaded() -> [Int64] {
    guard let json = defaults.string(forKey: Self.loadedKey),
          let strings = try? JSONDecoder().decode([String].self, from: Data(json.utf8)) else {
      return readNumbers()
    }
    return Array(Set(strings.compactMap { Int64($0) })).sorted()
  }

  /**
   What the app's last reload request came back with. The extension's own report
   says whether it ran; this says whether CallKit even accepted the request, and
   the two together are the only way to tell "never asked" from "asked and
   refused".
   */
  public func writeReload(at: String, error: String?) {
    let object: [String: Any] = ["at": at, "error": error ?? ""]
    guard let data = try? JSONSerialization.data(withJSONObject: object) else {
      return
    }
    defaults.set(String(decoding: data, as: UTF8.self), forKey: Self.reloadKey)
  }

  public func readReload() -> [String: String]? {
    guard let json = defaults.string(forKey: Self.reloadKey),
          let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
      return nil
    }
    return ["at": object["at"] as? String ?? "", "error": object["error"] as? String ?? ""]
  }

  /** Records what the extension did, for the app to show in Protection status. */
  public func writeLoad(_ load: CallDirectoryLoad) {
    let object: [String: Any] = [
      "startedAt": load.startedAt,
      "finishedAt": load.finishedAt ?? "",
      "entries": load.entries,
      "incremental": load.incremental,
      "failure": load.failure ?? ""
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: object) else {
      return
    }
    defaults.set(String(decoding: data, as: UTF8.self), forKey: Self.loadKey)
  }

  public func readLoad() -> CallDirectoryLoad? {
    guard let json = defaults.string(forKey: Self.loadKey),
          let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
      return nil
    }
    let finished = object["finishedAt"] as? String ?? ""
    let failure = object["failure"] as? String ?? ""
    return CallDirectoryLoad(
      startedAt: object["startedAt"] as? String ?? "",
      finishedAt: finished.isEmpty ? nil : finished,
      entries: object["entries"] as? Int ?? 0,
      incremental: object["incremental"] as? Bool ?? false,
      failure: failure.isEmpty ? nil : failure
    )
  }
}
