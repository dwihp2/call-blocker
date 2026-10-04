import CallKit
import Foundation

/**
 The Call Directory extension.

 CallKit asks it for the numbers to block and it hands back exactly what the app
 already wrote to the App Group store: no matching happens here, because the
 Numbers are the Effective block list the app compiled from the Rules.

 Three rules govern everything below, all learned the hard way:

 - Entries are added synchronously inside `beginRequest`, then the request is
   completed. CallKit gives a request one time budget, and work handed to
   another queue after this method returns is how a load expires without an
   error; every working implementation found adds and completes in one pass
   (docs/research/ios-call-blocking.md §2, §3c).
 - An incremental request must state the *difference* against what was loaded
   last time, so the extension keeps that list.
 - When the extension cannot know what CallKit holds (no load was ever
   recorded) or the last load was refused, it restates from zero:
   `removeAllBlockingEntries()` then the whole list. That delete is the only
   way out of the deadlock a device like the §5.6 one lands in — CallKit's
   database keeps rows the extension never recorded, so adds collide with a
   `UNIQUE constraint failed` while the lookups still say the number is not
   blocked. On healthy devices the delete is a no-op on a fresh install, and
   after a refused load it replaces whatever CallKit half-applied. It is never
   issued on the ordinary delta path.
 - Every load is recorded in the App Group — started, finished, entries, and any
   failure or expiry — because a Call Directory extension fails silently
   otherwise: a request that expires discards every entry it added, and nothing
   tells the app.
 */
public final class CallDirectoryExtension: CXCallDirectoryProvider {
  public override func beginRequest(with context: CXCallDirectoryExtensionContext) {
    // The delegate is how CallKit reports a refused load (out-of-order entries,
    // duplicates, too many entries). Without it those failures are invisible.
    context.delegate = self

    let store = CallDirectoryStore(appGroup: Self.appGroup)
    let wanted = store.readNumbers()
    let previous = store.readLoaded()
    let lastLoad = store.readLoad()
    let startedAt = Self.stamp()
    store.writeLoad(CallDirectoryLoad(
      startedAt: startedAt,
      finishedAt: nil,
      entries: wanted.count,
      incremental: context.isIncremental
    ))

    // When the extension cannot know what CallKit holds — no load was ever
    // recorded — or the last load was refused, a delta can only collide or be
    // incomplete: CallKit's database can keep rows this extension never
    // recorded (a previous install's entries surviving its uninstall, rows
    // left by a refused load). Restating from zero is the only self-healing
    // move: removeAll, then add the whole wanted list. On a healthy fresh
    // install removeAll is a no-op and the adds are the whole list either way;
    // after a refused load it replaces whatever CallKit half-applied.
    let restateFromZero = !store.hasLoadedRecord() || lastLoad?.failure != nil
    if restateFromZero {
      context.removeAllBlockingEntries()
    }

    let wantedSet = Set(wanted)
    let previousSet = Set(previous)
    // A full request states the whole list; an incremental one states only what
    // changed, so compute the difference rather than re-stating everything —
    // except when restating from zero, where the whole list is the difference.
    let additions = restateFromZero || !context.isIncremental ? wanted : wanted.filter { !previousSet.contains($0) }
    let removals = !restateFromZero && context.isIncremental ? previous.filter { !wantedSet.contains($0) } : []

    // The store and the loaded record are both ascending, so additions and
    // removals are too, which is what the sequential-entry contract requires.
    for number in additions {
      context.addBlockingEntry(withNextSequentialPhoneNumber: CXCallDirectoryPhoneNumber(number))
    }
    for number in removals {
      context.removeBlockingEntry(withPhoneNumber: CXCallDirectoryPhoneNumber(number))
    }

    let incremental = context.isIncremental
    context.completeRequest { expired in
      if !expired {
        store.writeLoaded(wanted)
      }
      store.writeLoad(CallDirectoryLoad(
        startedAt: startedAt,
        finishedAt: Self.stamp(),
        entries: wanted.count,
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
