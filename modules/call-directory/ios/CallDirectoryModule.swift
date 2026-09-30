import CallKit
import Contacts
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

    AsyncFunction("getStatus") { (promise: Promise) in
      CXCallDirectoryManager.sharedInstance.getEnabledStatusForExtension(withIdentifier: self.extensionBundleIdentifier) { status, error in
        let pieceOn = status == .enabled
        promise.resolve(StatusRecord(
          // The platform piece *is* the blocking: nothing is blocked until the
          // person turns the extension on in Settings › Phone.
          active: pieceOn,
          platformPieceOn: pieceOn,
          contacts: Self.contactPermission(),
          notifications: "granted",
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

      CXCallDirectoryManager.sharedInstance.reloadExtension(withIdentifier: self.extensionBundleIdentifier) { error in
        if let error, Self.isDisabledProblem(error) {
          // The numbers are in the store; the extension simply is not switched
          // on yet, which is the state of every fresh install and what
          // Protection status explains. Rejecting here would make Registration
          // fail on a device that has not been set up yet.
          promise.resolve(SyncResultRecord(
            written: true,
            entries: numbers.count,
            capacity: callDirectoryCapacity,
            overflow: false,
            rejected: []
          ))
          return
        }
        guard let error else {
          promise.resolve(SyncResultRecord(
            written: true,
            entries: numbers.count,
            capacity: callDirectoryCapacity,
            overflow: false,
            rejected: []
          ))
          return
        }
        promise.reject("ERR_CALL_DIRECTORY_RELOAD", "The Call Directory extension refused the reload: \(error.localizedDescription)")
      }
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

  private static func contactPermission() -> String {
    switch CNContactStore.authorizationStatus(for: .contacts) {
    case .authorized:
      return "granted"
    case .denied, .restricted:
      return "denied"
    case .notDetermined:
      return "undetermined"
    default:
      // iOS 18's limited access still lets the app read the numbers it can see.
      return "granted"
    }
  }

  private func statusDetail(pieceOn: Bool, error: Error?) -> String {
    let howToTurnOn = "Turn Call Blocker on in Settings › Phone › Call Blocking & Identification."
    if let meta = store.readMeta() {
      let written = "\(Self.grouped(meta.entries)) numbers blocked, last written \(Self.readable(meta.generatedAt))."
      return pieceOn ? written : "\(written) \(howToTurnOn)"
    }
    // CallKit reports an error while the extension has never been turned on,
    // which is the state of every fresh install: that is "off", not a failure
    // worth showing the person.
    if let error, !Self.isCallDirectoryManagerError(error) {
      return error.localizedDescription
    }
    return "No block list has been written yet. \(howToTurnOn)"
  }

  /** CallKit answers `unknown` with this error while the extension has never been enabled. */
  private static func isCallDirectoryManagerError(_ error: Error) -> Bool {
    return (error as NSError).domain == "com.apple.CallKit.error.calldirectorymanager"
  }

  /**
   Whether the reload failed only because the extension is not switched on. Every
   fresh install starts here, and the numbers are written either way, so this is
   not a failure the person has to act on beyond turning the extension on.
   */
  private static func isDisabledProblem(_ error: Error) -> Bool {
    return isCallDirectoryManagerError(error)
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
  @Field var contactsAllowance: Bool = false
  @Field var contacts: [String]? = nil
  @Field var rules: [RuleRecord] = []

  var engineInput: EngineInput {
    return EngineInput(
      blocking: blocking,
      contactsAllowance: contactsAllowance,
      contacts: contacts ?? [],
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
  @Field var contactsAllowance: Bool = false
  @Field var contacts: [String]? = nil
  @Field var rules: [RuleRecord] = []

  var engineInput: EngineInput {
    return EngineInput(
      blocking: blocking,
      contactsAllowance: contactsAllowance,
      contacts: contacts ?? [],
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
  @Field var contacts: String = "undetermined"
  @Field var notifications: String = "granted"
  @Field var detail: String? = nil
}

struct SyncResultRecord: Record {
  @Field var written: Bool = false
  @Field var entries: Int = 0
  @Field var capacity: Int = callDirectoryCapacity
  @Field var overflow: Bool = false
  @Field var rejected: [Int] = []
}

struct DecisionSourceRecord: Record {
  /** `rule`, `contacts`, `off` or `none`. */
  @Field var type: String = "none"
  /** Rules only: the index of the deciding Rule. */
  @Field var index: Int? = nil

  init() {}

  init(_ decision: EngineDecision) {
    switch decision {
    case .rule(let index):
      self.type = "rule"
      self.index = index
    case .contacts:
      self.type = "contacts"
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
