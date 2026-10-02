import CallKit
import Foundation

/**
 The Call Directory extension.

 CallKit asks it for the numbers to block and it hands back exactly what the app
 already wrote to the App Group store: no matching happens here, because the
 Numbers are the Effective block list the app compiled from the Rules.

 Every load is recorded in the App Group — started, finished, entries, and any
 failure or expiry — because a Call Directory extension fails silently otherwise:
 a request that expires discards every entry it added, and nothing tells the app.
 */
public final class CallDirectoryExtension: CXCallDirectoryProvider {
  private static let chunkSize = 10_000

  private let queue = DispatchQueue(label: "com.callblocker.call-directory.extension", qos: .userInitiated)

  public override func beginRequest(with context: CXCallDirectoryExtensionContext) {
    // The delegate is how CallKit reports a refused load (out-of-order entries,
    // duplicates, too many entries). Without it those failures are invisible.
    context.delegate = self

    let store = CallDirectoryStore(appGroup: Self.appGroup)
    let numbers = store.readNumbers()
    let startedAt = Self.stamp()
    store.writeLoad(CallDirectoryLoad(
      startedAt: startedAt,
      finishedAt: nil,
      entries: numbers.count,
      incremental: context.isIncremental
    ))

    queue.async {
      // A reload is incremental, so last run's numbers go first.
      if context.isIncremental {
        context.removeAllBlockingEntries()
      }
      self.add(numbers, from: 0, to: context, store: store, startedAt: startedAt)
    }
  }

  /** Adds the numbers in ascending order, a chunk per pass, and completes the request. */
  private func add(
    _ numbers: [Int64],
    from index: Int,
    to context: CXCallDirectoryExtensionContext,
    store: CallDirectoryStore,
    startedAt: String
  ) {
    let end = min(index + Self.chunkSize, numbers.count)
    // CallKit takes one number at a time and requires each to be greater than
    // the last, which is why the store hands them over ascending.
    var position = index
    while position < end {
      context.addBlockingEntry(withNextSequentialPhoneNumber: CXCallDirectoryPhoneNumber(numbers[position]))
      position += 1
    }
    guard end < numbers.count else {
      complete(context: context, store: store, startedAt: startedAt, entries: numbers.count)
      return
    }
    queue.async {
      self.add(numbers, from: end, to: context, store: store, startedAt: startedAt)
    }
  }

  /**
   Finishes the request and records whether the system expired it first. An
   expired request means none of the added entries took effect, which is the one
   failure a Call Directory extension cannot otherwise be seen to have.
   */
  private func complete(
    context: CXCallDirectoryExtensionContext,
    store: CallDirectoryStore,
    startedAt: String,
    entries: Int
  ) {
    let incremental = context.isIncremental
    context.completeRequest { expired in
      store.writeLoad(CallDirectoryLoad(
        startedAt: startedAt,
        finishedAt: Self.stamp(),
        entries: entries,
        incremental: incremental,
        failure: expired ? "The system expired the request, so none of the entries were applied." : nil
      ))
    }
  }

  private static func stamp() -> String {
    return ISO8601DateFormatter().string(from: Date())
  }

  /// The App Group the plugin wrote into this extension's Info.plist and entitlements.
  private static var appGroup: String {
    return Bundle.main.object(forInfoDictionaryKey: "CallDirectoryAppGroup") as? String
      ?? CallDirectoryStore.defaultAppGroup
  }
}

extension CallDirectoryExtension: CXCallDirectoryExtensionContextDelegate {
  public func requestFailed(for extensionContext: CXCallDirectoryExtensionContext, withError error: Error) {
    let store = CallDirectoryStore(appGroup: Self.appGroup)
    let started = store.readLoad()
    store.writeLoad(CallDirectoryLoad(
      startedAt: started?.startedAt ?? Self.stamp(),
      finishedAt: Self.stamp(),
      entries: started?.entries ?? 0,
      incremental: extensionContext.isIncremental,
      failure: error.localizedDescription
    ))
  }
}
