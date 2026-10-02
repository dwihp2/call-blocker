import CallKit
import Foundation

/**
 The Call Directory extension.

 CallKit asks it for the numbers to block and it hands back exactly what the app
 already wrote to the App Group store: no matching happens here, because the
 Numbers are the Effective block list the app compiled from the Rules.

 Apple ends the request if the extension does not answer, so the work runs off
 `beginRequest` in chunks and returns to the queue between them instead of
 holding the caller's request open.
 */
public final class CallDirectoryExtension: CXCallDirectoryProvider {
  private static let chunkSize = 10_000

  private let queue = DispatchQueue(label: "com.callblocker.call-directory.extension", qos: .userInitiated)

  public override func beginRequest(with context: CXCallDirectoryExtensionContext) {
    // CallKit answers a refused load here — entries out of order, duplicates, or
    // too many entries — and a refusal blocks nothing at all. Without a delegate
    // that silence looks exactly like a rule that did not match.
    context.delegate = self

    let store = CallDirectoryStore(appGroup: Self.appGroup)
    let numbers = store.readNumbers()
    // Recorded before and after the work so a load that never finishes is
    // visible from the app instead of looking like a call that was allowed.
    store.writeLoad(CallDirectoryLoad(
      startedAt: Self.stamp(),
      finishedAt: nil,
      entries: numbers.count,
      incremental: context.isIncremental
    ))
    queue.async {
      // A reload is incremental, so last run's numbers go first.
      if context.isIncremental {
        context.removeAllBlockingEntries()
      }
      self.add(numbers, from: 0, to: context, store: store)
    }
  }

  /** Adds the numbers in ascending order, a chunk per pass, and completes the request. */
  private func add(
    _ numbers: [Int64],
    from index: Int,
    to context: CXCallDirectoryExtensionContext,
    store: CallDirectoryStore
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
      store.writeLoad(CallDirectoryLoad(
        startedAt: store.readLoad()?.startedAt ?? Self.stamp(),
        finishedAt: Self.stamp(),
        entries: numbers.count,
        incremental: context.isIncremental
      ))
      // An empty store completes cleanly too: that is what Blocking off writes.
      context.completeRequest()
      return
    }
    queue.async {
      self.add(numbers, from: end, to: context, store: store)
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
  public func callDirectoryExtensionContext(
    _ context: CXCallDirectoryExtensionContext,
    didFailWithError error: Error
  ) {
    let store = CallDirectoryStore(appGroup: Self.appGroup)
    let started = store.readLoad()
    store.writeLoad(CallDirectoryLoad(
      startedAt: started?.startedAt ?? Self.stamp(),
      finishedAt: Self.stamp(),
      entries: started?.entries ?? 0,
      incremental: context.isIncremental,
      failure: error.localizedDescription
    ))
  }
}
