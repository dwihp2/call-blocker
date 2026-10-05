import CallKit
import Foundation

/**
 The Call Directory extension.

 It hands CallKit exactly what the app already wrote to the App Group store: no
 matching happens here, because the Numbers are the Effective block list the app
 compiled from the Rules.

 The shape is deliberately Simple Call Blocker's — state the whole list on every
 request — because the SDK makes it the one shape that cannot drift:

 - Every request is a *complete* request. The extension never reads
   `context.isIncremental`, and `CXCallDirectoryExtensionContext.h` says what
   that means: "if this method is not called OR is called and returns NO, then
   the request must provide a 'complete' set of entries, adding the full list of
   entries from scratch (and removing none), regardless of whether data has ever
   been successfully loaded in the past." The system replaces this extension's
   stored entries with the ones added here, so nothing needs to be remembered
   and nothing can go stale. A delta computed against a wrong baseline is how
   this app once added nothing on a fresh install while its records said
   "loaded", and how rows could go missing for an extension whose records said
   they were there.
 - Nothing is ever removed. `removeAllBlockingEntries()` and its delete are the
   statements CallKit's own corruption reports name, and the SDK allows them
   "only ... when `-isIncremental` returns YES" — a branch this extension never
   enters.
 - Entries are added synchronously inside `beginRequest`, ascending, in one
   pass, then the request is completed. CallKit gives a request one time
   budget, and work handed to another queue after this method returns is how a
   load expires without an error; every working implementation found adds and
   completes in one pass (docs/research/ios-call-blocking.md §2, §3c).
 - Every load is recorded in the App Group — started, finished, how many
   entries, and any failure or expiry — because a Call Directory extension
   fails silently otherwise: a request that expires discards every entry it
   added, and nothing tells the app.
 */
public final class CallDirectoryExtension: CXCallDirectoryProvider {
  public override func beginRequest(with context: CXCallDirectoryExtensionContext) {
    // The delegate is how CallKit reports a refused load (out-of-order entries,
    // duplicates, too many entries). Without it those failures are invisible.
    context.delegate = self

    let store = CallDirectoryStore(appGroup: Self.appGroup)
    let wanted = store.readNumbers()
    let startedAt = Self.stamp()
    store.writeLoad(CallDirectoryLoad(
      startedAt: startedAt,
      finishedAt: nil,
      entries: wanted.count
    ))

    // Ascending and de-duplicated is the sequential-entry contract, and
    // `readNumbers` already guarantees it. Adding the whole list *is* the
    // request.
    for number in wanted {
      context.addBlockingEntry(withNextSequentialPhoneNumber: CXCallDirectoryPhoneNumber(number))
    }

    context.completeRequest { expired in
      if !expired {
        store.writeLoaded(wanted)
      }
      store.writeLoad(CallDirectoryLoad(
        startedAt: startedAt,
        finishedAt: Self.stamp(),
        entries: wanted.count,
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
      failure: error.localizedDescription
    ))
  }
}
