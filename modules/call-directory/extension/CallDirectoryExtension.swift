import CallKit
import Foundation

/**
 The Call Directory extension.

 CallKit asks it for the numbers to block and it hands back exactly what the app
 already wrote to the App Group store: no matching happens here, because the
 Numbers are the Effective block list the app compiled from the Rules.

 Two rules govern everything below, both learned the hard way:

 - An incremental request must state the *difference* against what was loaded
   last time, so the extension keeps that list. `removeAllBlockingEntries()` is
   never used: the deletion it performs is the statement CallKit is reported to
   fail on, and it removes the very entries this extension depends on.
 - Every load is recorded in the App Group — started, finished, entries, and any
   failure or expiry — because a Call Directory extension fails silently
   otherwise: a request that expires discards every entry it added, and nothing
   tells the app.
 */
public final class CallDirectoryExtension: CXCallDirectoryProvider {
  private static let chunkSize = 10_000

  private let queue = DispatchQueue(label: "com.callblocker.call-directory.extension", qos: .userInitiated)

  public override func beginRequest(with context: CXCallDirectoryExtensionContext) {
    // The delegate is how CallKit reports a refused load (out-of-order entries,
    // duplicates, too many entries). Without it those failures are invisible.
    context.delegate = self

    let store = CallDirectoryStore(appGroup: Self.appGroup)
    let wanted = store.readNumbers()
    let previous = store.readLoaded()
    let startedAt = Self.stamp()
    store.writeLoad(CallDirectoryLoad(
      startedAt: startedAt,
      finishedAt: nil,
      entries: wanted.count,
      incremental: context.isIncremental
    ))

    let wantedSet = Set(wanted)
    let previousSet = Set(previous)
    // A full request states the whole list; an incremental one states only what
    // changed, so compute the difference rather than re-stating everything.
    let additions = context.isIncremental ? wanted.filter { !previousSet.contains($0) } : wanted
    let removals = context.isIncremental ? previous.filter { !wantedSet.contains($0) } : []

    queue.async {
      self.apply(
        additions: additions,
        removals: removals,
        wanted: wanted,
        from: 0,
        to: context,
        store: store,
        startedAt: startedAt
      )
    }
  }

  /**
   Adds the new numbers in ascending order, a chunk per pass, then removes the
   ones that went away.
   */
  private func apply(
    additions: [Int64],
    removals: [Int64],
    wanted: [Int64],
    from index: Int,
    to context: CXCallDirectoryExtensionContext,
    store: CallDirectoryStore,
    startedAt: String
  ) {
    let end = min(index + Self.chunkSize, additions.count)
    var position = index
    while position < end {
      context.addBlockingEntry(withNextSequentialPhoneNumber: CXCallDirectoryPhoneNumber(additions[position]))
      position += 1
    }
    guard end < additions.count else {
      for number in removals {
        context.removeBlockingEntry(withPhoneNumber: CXCallDirectoryPhoneNumber(number))
      }
      complete(context: context, store: store, startedAt: startedAt, entries: wanted.count, wanted: wanted)
      return
    }
    queue.async {
      self.apply(
        additions: additions,
        removals: removals,
        wanted: wanted,
        from: end,
        to: context,
        store: store,
        startedAt: startedAt
      )
    }
  }

  /**
   Finishes the request and records whether the system expired it first. An
   expired request means none of the added entries took effect, in which case the
   previously loaded list is still what the system holds and must not be
   overwritten with what we tried to send.
   */
  private func complete(
    context: CXCallDirectoryExtensionContext,
    store: CallDirectoryStore,
    startedAt: String,
    entries: Int,
    wanted: [Int64]
  ) {
    let incremental = context.isIncremental
    context.completeRequest { expired in
      if !expired {
        store.writeLoaded(wanted)
      }
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
