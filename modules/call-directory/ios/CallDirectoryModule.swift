import CallKit
import ExpoModulesCore
import UIKit

/**
 The iOS Blocking engine: it keeps the Effective block list in the App Group store
 and asks CallKit to reload the Call Directory extension with it.

 Everything that decides or counts happens in `RuleEngine.swift`, which the
 extension compiles too, so the app and the extension can never disagree about
 what a Rule covers.
 */
public class CallDirectoryModule: Module {
  private let defaultExtensionName = "CallDirectoryExtension"

  public func definition() -> ModuleDefinition {
    Name("CallDirectory")

    Function("isSupported") { () -> Bool in
      true
    }

    // ADR 0006: what this app asks iOS for, read from its own Info.plist rather
    // than written down twice — the Privacy screen shows exactly what the App
    // Store will. Empty when the app declares no permission reasons at all.
    Function("getDeclaredUsageDescriptions") { () -> [String] in
      (Bundle.main.infoDictionary ?? [:]).keys
        .filter { $0.hasSuffix("UsageDescription") }
        .sorted()
    }

    AsyncFunction("getStatus") { (promise: Promise) in
      CXCallDirectoryManager.sharedInstance.getEnabledStatusForExtension(withIdentifier: self.extensionBundleIdentifier) { status, error in
        let pieceOn = status == .enabled
        promise.resolve(StatusRecord(
          // The platform piece *is* the blocking: nothing is blocked until the
          // person turns the extension on in Settings › Phone.
          active: pieceOn,
          platformPieceOn: pieceOn,
          detail: self.statusDetail(pieceOn: pieceOn, error: error)
        ))
      }
    }

    AsyncFunction("sync") { (input: MatchInputRecord, promise: Promise) in
      let engineInput = input.engineInput
      let entries = effectiveBlockCount(engineInput)

      // Past Capacity nothing is written and nothing is trimmed: the person is
      // told which Rules would have to go (see `docs/adr/0004`).
      guard entries <= callDirectoryCapacity else {
        promise.resolve(SyncResultRecord(
          written: false,
          entries: entries,
          capacity: callDirectoryCapacity,
          overflow: true,
          rejected: rejectedRuleIndices(engineInput)
        ))
        return
      }

      let numbers = effectiveBlockList(engineInput)
      let meta = CallDirectoryMeta(
        entries: numbers.count,
        generatedAt: ISO8601DateFormatter().string(from: Date()),
        overflow: false
      )
      do {
        try self.store.write(numbers: numbers, meta: meta)
      } catch {
        promise.reject("ERR_CALL_DIRECTORY_STORE", "The block list could not be saved: \(error.localizedDescription)")
        return
      }

      // The numbers are in the store either way, so nothing here fails: the
      // reload's own outcome is reported instead. Keeping it quiet was how the
      // app came to say "saved" while CallKit had refused to load anything.
      requestReload(promise)
    }

    // Costs the same numbers as `sync` without writing or reloading anything.
    AsyncFunction("preview") { (input: MatchInputRecord) -> SyncResultRecord in
      let engineInput = input.engineInput
      let entries = effectiveBlockCount(engineInput)
      let overflow = entries > callDirectoryCapacity
      return SyncResultRecord(
        // A preview never writes, whatever it reports.
        written: false,
        entries: entries,
        capacity: callDirectoryCapacity,
        overflow: overflow,
        rejected: overflow ? rejectedRuleIndices(engineInput) : []
      )
    }

    AsyncFunction("checkNumber") { (input: CheckNumberRecord) -> MatchResultRecord in
      let result = evaluate(input.engineInput, query: input.query)
      return MatchResultRecord(
        blocked: result.blocked,
        decidedBy: DecisionSourceRecord(result.decidedBy),
        matches: result.matches
      )
    }

    AsyncFunction("selfCheck") { (fixturesJson: String) -> SelfCheckResultRecord in
      SelfCheckResultRecord(failures: fixtureFailures(fixturesJson))
    }

    AsyncFunction("openBlockingSettings") { (promise: Promise) in
      func openAppSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
          promise.reject("ERR_CALL_DIRECTORY_SETTINGS", "This device has no Settings page to open.")
          return
        }
        UIApplication.shared.open(url, options: [:]) { _ in
          promise.resolve()
        }
      }

      guard let phoneSettings = URL(string: "App-Prefs:PHONE") else {
        openAppSettings()
        return
      }
      UIApplication.shared.open(phoneSettings, options: [:]) { opened in
        if opened {
          promise.resolve()
        } else {
          openAppSettings()
        }
      }
    }
    .runOnQueue(.main)
  }

  // MARK: - Reloads

  /**
   One `reloadExtension` at a time, each covering every write that preceded it.

   CallKit is reported to answer `loadingInterrupted` for apps that reload
   frequently (docs/research/ios-call-blocking.md §3), and overlapping requests
   cannot help anyway: the extension reads the store when the system launches
   it, so a reload always loads the latest write. A burst of syncs — onboarding,
   a Restore, one screen changing several settings — therefore becomes one
   leading reload plus, if writes landed while it ran, one trailing reload that
   covers all of them.
   */
  private let reloadQueue = DispatchQueue(label: "com.callblocker.call-directory.reload")
  private var reloadWaiters: [Promise] = []
  private var reloadInFlight = false

  private func requestReload(_ promise: Promise) {
    reloadQueue.async {
      self.reloadWaiters.append(promise)
      self.fireReload()
    }
  }

  /** Must run on `reloadQueue`. */
  private func fireReload() {
    guard !reloadInFlight, !reloadWaiters.isEmpty else {
      return
    }
    let batch = reloadWaiters
    reloadWaiters = []
    reloadInFlight = true

    CXCallDirectoryManager.sharedInstance.reloadExtension(withIdentifier: extensionBundleIdentifier) { error in
      // Recorded where both the app and a developer can see it: the extension's
      // own report says whether it ran, this says whether CallKit accepted the
      // request at all.
      self.store.writeReload(at: ISO8601DateFormatter().string(from: Date()), error: error?.localizedDescription)
      self.reloadQueue.async {
        self.reloadInFlight = false
        // Every waiter reports the list CallKit was actually handed: the last
        // write the batch covered, not whatever that caller wrote itself.
        let entries = self.store.readMeta()?.entries ?? 0
        for promise in batch {
          promise.resolve(SyncResultRecord(
            written: true,
            entries: entries,
            capacity: callDirectoryCapacity,
            overflow: false,
            rejected: [],
            reloadError: error?.localizedDescription
          ))
        }
        // Writes that landed while this reload ran still need one of their own.
        self.fireReload()
      }
    }
  }

  // MARK: - Configuration

  /// The App Group the plugin put in the app's Info.plist and in both entitlements.
  private var appGroup: String {
    return Bundle.main.object(forInfoDictionaryKey: "CallDirectoryAppGroup") as? String ?? CallDirectoryStore.defaultAppGroup
  }

  private var extensionName: String {
    return Bundle.main.object(forInfoDictionaryKey: "CallDirectoryExtensionName") as? String ?? defaultExtensionName
  }

  private var extensionBundleIdentifier: String {
    if let configured = Bundle.main.object(forInfoDictionaryKey: "CallDirectoryExtensionBundleId") as? String {
      return configured
    }
    return "\(Bundle.main.bundleIdentifier ?? "").\(extensionName)"
  }

  private var store: CallDirectoryStore {
    return CallDirectoryStore(appGroup: appGroup)
  }

  // MARK: - Status detail

  private func statusDetail(pieceOn: Bool, error: Error?) -> String {
    // CallKit reports an error while the extension has never been turned on,
    // which is the state of every fresh install: that is "off", not a failure
    // worth showing the person.
    if let error, !Self.isCallDirectoryManagerError(error) {
      return error.localizedDescription
    }
    let howToTurnOn = "Turn Call Blocker on in Settings › Phone › Call Blocking & Identification."
    var parts: [String] = []
    if let meta = store.readMeta() {
      parts.append("\(Self.grouped(meta.entries)) numbers written \(Self.readable(meta.generatedAt)).")
    } else {
      parts.append("No block list has been written yet.")
    }
    parts.append(loadSentence())
    if !pieceOn {
      parts.append(howToTurnOn)
    }
    return parts.joined(separator: " ")
  }

  /**
   What the extension last did. This is the difference between "CallKit never
   ran the extension" and "the extension loaded the numbers and a call was let
   through anyway", which need opposite fixes.
   */
  private func loadSentence() -> String {
    guard let load = store.readLoad() else {
      return "The extension has never been asked to load."
    }
    if let failure = load.failure {
      return "CallKit refused the load at \(Self.readable(load.finishedAt ?? load.startedAt)): \(failure)"
    }
    guard let finished = load.finishedAt else {
      return "The extension started loading \(Self.grouped(load.entries)) numbers at \(Self.readable(load.startedAt)) and never reported finishing."
    }
    return "The extension loaded \(Self.grouped(load.entries)) numbers at \(Self.readable(finished))."
  }

  /** CallKit answers `unknown` with this error while the extension has never been enabled. */
  private static func isCallDirectoryManagerError(_ error: Error) -> Bool {
    return (error as NSError).domain == "com.apple.CallKit.error.calldirectorymanager"
  }

  /**
   Counts read as numbers: 112112 becomes 112,112. Grouping is fixed rather than
   locale-driven because the app's own formatting is fixed, so the same count
   reads the same wherever the app runs.
   */
  private static let countFormatter: NumberFormatter = {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.usesGroupingSeparator = true
    formatter.groupingSeparator = ","
    formatter.groupingSize = 3
    return formatter
  }()

  private static func grouped(_ value: Int) -> String {
    return countFormatter.string(from: NSNumber(value: value)) ?? String(value)
  }

  /** The store keeps an ISO 8601 stamp; the person reads a date. */
  private static func readable(_ stamp: String) -> String {
    guard let date = ISO8601DateFormatter().date(from: stamp) else {
      return stamp
    }
    return date.formatted(date: .abbreviated, time: .shortened)
  }
}

// MARK: - Arguments

// The initial values are what let a Record be built with a constructor, as
// `expo-document-picker`'s records do: without one, a field only takes its
// wrapper type.
struct RuleRecord: Record {
  @Field var kind: String = "block"
  @Field var pattern: String = "single"
  @Field var number: String = ""
  @Field var end: String? = nil
  @Field var nationalLengths: [Int]? = nil
}

struct MatchInputRecord: Record {
  @Field var blocking: Bool = true
  @Field var rules: [RuleRecord] = []

  var engineInput: EngineInput {
    return EngineInput(
      blocking: blocking,
      rules: rules.map {
        EngineRule(
          kind: $0.kind,
          pattern: $0.pattern,
          number: $0.number,
          end: $0.end,
          nationalLengths: $0.nationalLengths
        )
      }
    )
  }
}

struct CheckNumberRecord: Record {
  @Field var query: String = ""
  @Field var blocking: Bool = true
  @Field var rules: [RuleRecord] = []

  var engineInput: EngineInput {
    return EngineInput(
      blocking: blocking,
      rules: rules.map {
        EngineRule(
          kind: $0.kind,
          pattern: $0.pattern,
          number: $0.number,
          end: $0.end,
          nationalLengths: $0.nationalLengths
        )
      }
    )
  }
}

// MARK: - Results

struct StatusRecord: Record {
  @Field var active: Bool = false
  @Field var platformPieceOn: Bool = false
  @Field var detail: String? = nil
}

struct SyncResultRecord: Record {
  @Field var written: Bool = false
  @Field var entries: Int = 0
  @Field var capacity: Int = callDirectoryCapacity
  @Field var overflow: Bool = false
  @Field var rejected: [Int] = []
  @Field var reloadError: String? = nil
}

struct DecisionSourceRecord: Record {
  /** `rule`, `off` or `none`. */
  @Field var type: String = "none"
  /** Rules only: the index of the deciding Rule. */
  @Field var index: Int? = nil

  init() {}

  init(_ decision: EngineDecision) {
    switch decision {
    case .rule(let index):
      self.type = "rule"
      self.index = index
    case .off:
      self.type = "off"
    case .none:
      self.type = "none"
    }
  }
}

struct MatchResultRecord: Record {
  @Field var blocked: Bool = false
  @Field var decidedBy: DecisionSourceRecord = DecisionSourceRecord()
  @Field var matches: [Int] = []
}

struct SelfCheckResultRecord: Record {
  @Field var failures: [String] = []
}
