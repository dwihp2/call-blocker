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
    let store = CallDirectoryStore(appGroup: Self.appGroup)
    queue.async {
      // A reload is incremental, so last run's numbers go first.
      if context.isIncremental {
        context.removeAllBlockingEntries()
      }
      self.add(store.readNumbers(), from: 0, to: context)
    }
  }

  /** Adds the numbers in ascending order, a chunk per pass, and completes the request. */
  private func add(_ numbers: [Int64], from index: Int, to context: CXCallDirectoryExtensionContext) {
    let end = min(index + Self.chunkSize, numbers.count)
    // CallKit takes one number at a time and requires each to be greater than
    // the last, which is why the store hands them over ascending.
    var position = index
    while position < end {
      context.addBlockingEntry(withNextSequentialPhoneNumber: CXCallDirectoryPhoneNumber(numbers[position]))
      position += 1
    }
    guard end < numbers.count else {
      // An empty store completes cleanly too: that is what Blocking off writes.
      context.completeRequest()
      return
    }
    queue.async {
      self.add(numbers, from: end, to: context)
    }
  }

  /// The App Group the plugin wrote into this extension's Info.plist and entitlements.
  private static var appGroup: String {
    return Bundle.main.object(forInfoDictionaryKey: "CallDirectoryAppGroup") as? String ?? CallDirectoryStore.defaultAppGroup
  }
}
