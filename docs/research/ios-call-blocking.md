# iOS call blocking: the only mechanism, how it fails silently, and what to do instead

Researched 2026-10-02 for a device on **iOS 27.0 (24A437)**, Xcode 27. Sources are Apple documentation, the CallKit headers shipped in Xcode, Apple developer forum threads (including DTS engineer replies), and Apple's own example projects. Each claim carries its source; where the only evidence is a practitioner report it is marked as such.

## The short version

1. **A Call Directory app extension is the only way an app blocks a cellular call on iOS.** There is no second mechanism, no per-call code the app can run, and no allow-list concept.
2. **That extension fails silently in at least six distinct ways**, and the app can only see them by asking CallKit directly (the reload error) or by instrumenting the extension itself (a load report). Every failure mode looks identical from the outside: the extension shows as enabled and no call is ever blocked.
3. **The leading explanation for our test device is a known, unfixed CallKit bug** in which the system's own Call Directory database becomes corrupt; Apple's DTS confirms it is under investigation and that nothing short of a full *Reset All Settings* recovers the device.
4. **Our design is the pattern that provokes it**: expanding a prefix into 111,112 entries and rewriting the whole list on every change.
5. **No alternative removes the entry-count problem** except moving the list server-side with Live Caller ID Lookup (iOS 18+), which requires running a PIR service and Apple endpoint validation.

## 1. The only mechanism, and what it cannot do

Apple: "Create a Call Directory app extension to identify and block incoming callers by their phone number." ([Identifying and blocking calls](https://developer.apple.com/documentation/callkit/identifying-and-blocking-calls))

What that means in practice:

| Property | Reality |
|---|---|
| When it runs | Only when the system loads the extension — never per call. Apple: "the system calls this method only when it launches the app extension and not for each individual call, you need to specify call identification information all at once." ([same page](https://developer.apple.com/documentation/callkit/identifying-and-blocking-calls)) |
| What it receives | Nothing about a call. It hands the system a static list and exits. |
| Allow lists / exceptions | Impossible to express; only blocking and identification entries exist. |
| Where the data lives | `CallDirectory.db` inside the system (`/private/var/mobile/Library/CallDirectory/CallDirectory.db`), owned by CallKit, not by the app. |
| Ordering | Entries are added with `addBlockingEntry(withNextSequentialPhoneNumber:)` — the name states the contract, and CallKit reports `entriesOutOfOrder` (code 3) when it is broken. ([CXErrorCodeCallDirectoryManagerError](https://developer.apple.com/documentation/callkit/cxerrorcodecalldirectorymanagererror-swift.struct)) |

## 2. The API rules that matter

**Incremental requests are a strict contract.** Apple: "if you call this method and the value is true, the request must only add or remove entries relative to the last time the system loaded data for the extension. Otherwise, if you don't call this method, or if the value is false, the request must add the full list of entries without removing any" ([isIncremental](https://developer.apple.com/documentation/callkit/cxcalldirectoryextensioncontext/isincremental)). `removeAllBlockingEntries()` is legal only in an incremental request: "Don't call this method if isIncremental is false." ([removeAllBlockingEntries](https://developer.apple.com/documentation/callkit/cxcalldirectoryextensioncontext/removeallblockingentries()))

**A request can expire, and then every entry is discarded.** `completeRequest(completionHandler:)` passes a flag with a devastating meaning: "**expired** — Whether the receiver expired during the request. If true, then any identification or blocking entries added by the extension context **were not added** to the extension." ([completeRequest](https://developer.apple.com/documentation/callkit/cxcalldirectoryextensioncontext/completerequest(completionhandler:)))

This is the single most important sentence in the whole API for us: a load that takes too long is thrown away **without an error**, and the only signal is a boolean in a completion handler that our extension was not reading.

**The error enum** (values from `CallKit.framework/Headers/CXError.h` in the iPhoneOS 27 SDK on this machine; descriptions from Apple's docs):

| Code | Name | Meaning |
|---|---|---|
| 0 | `unknown` | An unknown error occurred. |
| 1 | `noExtensionFound` | The manager can't find a corresponding app extension. |
| 2 | `loadingInterrupted` | The manager was interrupted while loading the extension. |
| 3 | `entriesOutOfOrder` | The entries are out of order. |
| 4 | `duplicateEntries` | There are duplicate entries. |
| 5 | `maximumEntriesExceeded` | There are too many entries. |
| 6 | `extensionDisabled` | The extension isn't enabled by the system. |
| 7 | `currentlyLoading` | The manager is loading the extension. |
| 8 | `unexpectedIncrementalRemoval` | A request occurred before confirming incremental loading. |
| **102** | *(undocumented, not in the enum)* | Apple DTS Engineer: "That is an internal error indicating that the extension is unavailable. It can be that your call directory extension wasn't enabled in Settings.app, or **the system failed to load your extension**." ([thread 756942](https://developer.apple.com/forums/thread/756942)) |

**The status API does not mean what it looks like.** `getEnabledStatusForExtension` returns `.enabled` = "Indicates that the extension is enabled" ([EnabledStatus](https://developer.apple.com/documentation/callkit/cxcalldirectorymanager/enabledstatus)) — it reports the Settings switch, not whether the system ever managed to load the list. An extension can therefore be `.enabled` forever while nothing is blocked, which is exactly the state our app reported as healthy.

## 3. Why "enabled but nothing happens"

1. **Never enabled** → `extensionDisabled` (6).
2. **The system failed to load the extension** → error **102**. Apple DTS describes it as "the extension is unavailable … the system failed to load your extension" and suggests a sysdiagnose to find the reason.
3. **The request expired** → every entry discarded, no error anywhere (see §2).
4. **Too many entries** → `maximumEntriesExceeded` (5).
5. **Out of order or duplicated entries** → codes 3 and 4, again discarding the request.
6. **The device's Call Directory database is corrupt** → the state our device is most likely in.

### The database corruption bug (FB20986470)

Reported by a call-blocking developer in November 2025 and still open:

> "When adding blocking numbers to a Call Directory extension, the system's CallKit database (/private/var/mobile/Library/CallDirectory/CallDirectory.db) becomes corrupted. The reload call (reloadExtensionWithIdentifier) fails with error code 11 … After this happens, **CallKit becomes fully corrupted on the device and no further numbers can be added**, even after: Disabling and re-enabling the extension / Restarting the device / Reinstalling the app / Waiting … **I also tested other call-blocking apps, and they all fail with the same error.** The only thing that recovers the system is a full **'Reset All Settings'**."
> — [thread 806960](https://developer.apple.com/forums/thread/806960) (quoted from the report; the SQLite error 11 is `SQLITE_CORRUPT`)

Apple's response, from Kevin Elliott (DTS Engineer, CoreOS/Hardware), in the same thread:

> "there's a database that's used to collect all call directory entries, and that database has become corrupt and cannot be opened. **How/why it's becoming corrupt is unknown**, as the engineering team has never been able to identify any specific cause. There were significant reports of this happening several years ago, and those were addressed by the addition of several different data recovery mechanisms. That's also why the file wasn't simply deleted and the entire directory system 'reset' … At this point, the issue is under active investigation, but I can't comment on if/when a fix might ship."

Two weeks before this research, the same engineer answered a request for an update: "Unfortunately, I don't have anything more I can share. **They're still working on a fix, but nothing has been released.**" Other developers in the thread add: "I have the same issue with my app", "I have a lot of users that are still having this exact issue, and nothing is helping (reinstalling the app, disabling/re-enabling callkit permissions, deleting the app, resetting the callkit numbers)", and a report that it persists on iOS 26.2.

**Why this fits our evidence:** extension enabled, reload requested many times, extension never once launched (no load report), no crash log, and none of the usual remedies (re-enable, reboot, reinstall) changed anything. The one prediction it makes that we have not yet tested: **the other call-blocking apps on the same phone should also be failing.** The reporter tested exactly that and found they all fail.

## 4. Limits: what is documented versus observed

Apple documents **no** number: the error case exists, the threshold does not. Practitioner reports:

| Observation | Source |
|---|---|
| "1 million numbers will be added in about 100 seconds" (identification entries) | [thread 694514](https://developer.apple.com/forums/thread/694514) |
| "My limit now is around 1,800,000 entries", while another app "is able to add more than 10,000,000 entries" in what appears to be a single extension | [thread 769594](https://developer.apple.com/forums/thread/769594) |
| Truecaller splits its database across **four** Call Directory extensions, Getcontact across **three** (observed on our own test device's Settings screen) | device observation, 2026-10-02 |

Practical reading: the ceiling is per-extension and undocumented, in the millions; 111,112 entries is well inside it, so `maximumEntriesExceeded` is an unlikely explanation for our failure. Both load time (≈100 s per million) and database churn are the real costs of large lists.

## 5. Alternatives

| Approach | Can it block a call? | What it requires | Limits |
|---|---|---|---|
| **Call Directory extension, blocking entries** | Yes | An app extension, an App Group to share the list between app and extension, platform's Settings switch | Undocumented per-extension entry cap; silent failure modes above; the corruption bug |

| **Call Directory extension, identification entries** | No (labels only) | Same | Shares the same list budget; slower with unique labels |
| **Live Caller ID Lookup** (iOS 18+) | **Yes** — the blocking response is one byte, `0` don't block / `1` block, fetched per call from the app's server | A PIR server, a Privacy Pass token issuer, Apple relay servers, **endpoint validation by Apple** ("submit your request"), registration in the CloudKit Console Identity & Trust page | Removes the local entry cap entirely; needs infrastructure and network at call time; cached per number, so a wrong answer can persist for the cache window |
| **Focus / Silence Unknown Callers** | Yes, but user-controlled | Nothing | Not drivable by an app; no per-number logic |
| **Carrier-level blocking** | Yes | Carrier contract | Outside the app's control |

> On the App Group and account tier: a third-party integration guide states "Apple does not allow App Groups on a free Personal Team. There is no way around it." ([callerapi.com](https://docs.callerapi.com/ios-prerequisites-2275084m0)) — **unverified**: Apple's capability table does not expose the membership column in a machine-readable form, and our own device build provisioned both the App Group and the extension on team `6NN3PT736K` without any capability request. Treat the claim as a practitioner report, not a rule.

Sources: [Live Caller ID Lookup overview](https://developer.apple.com/documentation/identitylookup), [Getting up-to-date calling and blocking information for your app](https://developer.apple.com/documentation/identitylookup/getting-up-to-date-calling-and-blocking-information-for-your-app) ("The app extension tells the system how to communicate with your server … This requires endpoint validation from Apple"), [Formatting data for blocking and identity information](https://developer.apple.com/documentation/identitylookup/formatting-data-for-blocking-and-identity-information) (blocking = `0`/`1`; identity = a `CallIdentity` protobuf), [Understanding how Live Caller ID Lookup preserves privacy](https://developer.apple.com/documentation/identitylookup/understanding-how-live-caller-id-lookup-preserves-privacy).

**Verdict: there is no local alternative.** For a two-person project with no server, the Call Directory extension is the mechanism, and the engineering question is how to keep the list small and the load observable. Live Caller ID Lookup is the only design that scales to arbitrary lists, and it is a different project — a hosted service plus an Apple approval.

## 6. What this means for Call Blocker

1. **Test whether the phone itself is broken** before changing more code: ask the user whether any *other* call-blocking app on that device blocks a call today. All of them failing means device-level CallKit corruption, which no app can fix — only *Reset All Settings*, or waiting for Apple.
2. **Stop expanding prefixes into six-figure entry counts.** Every reload inserts the whole list again, which is both slow (~100 s per million) and the churn pattern associated with the corruption reports. Cap the expansion far below 1,000,000 and say so at Registration.
3. **Read `completeRequest`'s `expired` flag** and treat it as a load failure — today a timed-out load is indistinguishable from success.
4. **Surface the reload error verbatim** (`reloadError`), and translate the documented codes (3, 4, 5, 6, 102) into sentences a person can act on. Partly done.
5. **Keep the load report** (started/finished/entries/duration) as the app's only sight of whether the extension ever ran.

## 7. What we still do not know

- **The exact error our device returns from `reloadExtension`.** The app now reports it in Protection status ("Written, but CallKit would not reload it: …"); no one has read that string on the device yet. `102` or a SQLite `Code=11` would each confirm a different hypothesis.
- **Whether the CallKit database on our test device is corrupt** — the other-apps test above settles it.
- **The system's time budget for `beginRequest`.** Documented nowhere; the `expired` flag is the only way to observe it, which our extension now records.
- **Whether our chunked, asynchronous adding (10,000 entries per queue hop) makes expiration more likely** than adding synchronously inside `beginRequest`. Worth measuring on a healthy device.
- **Whether re-adding the entire list on every incremental request is itself a corruption trigger.** The corruption cause is officially unknown; our reload-everything pattern is at least the highest-churn option available.
