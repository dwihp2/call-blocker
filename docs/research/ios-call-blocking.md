# iOS call blocking: the only mechanism, how it fails silently, and what to do instead

Researched 2026-10-02 for a device on **iOS 27.0 (24A437)**, Xcode 27. Sources are Apple documentation, the CallKit headers shipped in Xcode, Apple developer forum threads (including DTS engineer replies), and Apple's own example projects. Each claim carries its source; where the only evidence is a practitioner report it is marked as such.

## The short version

1. **A Call Directory app extension is the only way an app blocks a cellular call on iOS.** There is no second mechanism, no per-call code the app can run, and no allow-list concept.
2. **That extension fails silently in at least six distinct ways**, and the app can only see them by asking CallKit directly (the reload error) or by instrumenting the extension itself (a load report). Every failure mode looks identical from the outside: the extension shows as enabled and no call is ever blocked.
3. **The leading explanation for our test device is a known, unfixed CallKit bug** in which the system's own Call Directory database becomes corrupt; Apple's DTS confirms it is under investigation and that nothing short of a full *Reset All Settings* recovers the device.
4. **Our design is the pattern that provokes it**: expanding a prefix into 111,112 entries and rewriting the whole list on every change.
5. **No alternative removes the entry-count problem** except moving the list server-side with Live Caller ID Lookup (iOS 18+), which requires running a PIR service and Apple endpoint validation.

**One correction belongs in this summary:** the evidence that our test device's extension "never ran" is withdrawn — the build on that device compiled a stale copy of the extension that carried no instrumentation at all (§3b). The corruption bug and the other failure modes below are candidates, not conclusions.

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
6. **Frequent reloads are interrupted** → `loadingInterrupted` (2). A developer whose app "frequently keep[s] updating the list of blocked numbers in the Call Directory Extension" reported this error appearing "frequently … from iOS 15 onwards", with no answer from Apple in 2021 and another developer confirming the same in 2024. ([thread 693747](https://developer.apple.com/forums/thread/693747))
7. **The device's Call Directory database is corrupt** → see below.

### The database corruption bug (FB20986470)

Reported by a call-blocking developer in November 2025 and still open:

> "When adding blocking numbers to a Call Directory extension, the system's CallKit database (/private/var/mobile/Library/CallDirectory/CallDirectory.db) becomes corrupted. The reload call (reloadExtensionWithIdentifier) fails with error code 11 … After this happens, **CallKit becomes fully corrupted on the device and no further numbers can be added**, even after: Disabling and re-enabling the extension / Restarting the device / Reinstalling the app / Waiting … **I also tested other call-blocking apps, and they all fail with the same error.** The only thing that recovers the system is a full **'Reset All Settings'**."
> — [thread 806960](https://developer.apple.com/forums/thread/806960) (quoted from the report; the SQLite error 11 is `SQLITE_CORRUPT`)

Apple's response, from Kevin Elliott (DTS Engineer, CoreOS/Hardware), in the same thread:

> "there's a database that's used to collect all call directory entries, and that database has become corrupt and cannot be opened. **How/why it's becoming corrupt is unknown**, as the engineering team has never been able to identify any specific cause. There were significant reports of this happening several years ago, and those were addressed by the addition of several different data recovery mechanisms. That's also why the file wasn't simply deleted and the entire directory system 'reset' … At this point, the issue is under active investigation, but I can't comment on if/when a fix might ship."

Two weeks before this research, the same engineer answered a request for an update: "Unfortunately, I don't have anything more I can share. **They're still working on a fix, but nothing has been released.**"

A second report of the same corruption shows *which statement fails*, and it is a deletion:

> `errorCode: 11`, `errorDomain: com.apple.callkit.database.sqlite`, "sqlite3_step for query **'DELETE FROM PhoneNumberBlockingEntry WHERE extension_id =?'** returned 11 (11)", "database disk image is malformed"
> — [thread 806129](https://developer.apple.com/forums/thread/806129) (Apple DTS replied asking for the bug number; the reporter confirmed it is the same issue)

That matters for us specifically: `removeAllBlockingEntries()` issues exactly that delete for every entry the extension has stored, and our extension calls it on **every** incremental reload before re-adding the whole 111,112-entry list. Other developers in the thread add: "I have the same issue with my app", "I have a lot of users that are still having this exact issue, and nothing is helping (reinstalling the app, disabling/re-enabling callkit permissions, deleting the app, resetting the callkit numbers)", and a report that it persists on iOS 26.2.

**Why this fits our evidence:** extension enabled, reload requested many times, extension never once launched (no load report), no crash log, and none of the usual remedies (re-enable, reboot, reinstall) changed anything. The one prediction it makes that we have not yet tested: **the other call-blocking apps on the same phone should also be failing.** The reporter tested exactly that and found they all fail.

## 3b. Correction, same day: our "never loaded" evidence was an artefact

While finishing this research I checked the extension source that the *device build* actually compiled, and it is not the source in `modules/call-directory/extension/`:

- The config plugin **copies** the extension's Swift files into the generated `apps/mobile/ios/CallDirectoryExtension/` directory during `expo prebuild`. Subsequent `xcodebuild` runs compile that copy, not the module's file.
- The generated copy is dated 2026-09-30 12:12 and contains **no** `writeLoad` call and **no** `CXCallDirectoryExtensionContextDelegate` conformance — both were added to the module after that prebuild.
- Therefore the load report could not have been written by the deployed extension, and **"the load report never appeared" does not mean the extension never ran**. That conclusion, stated earlier in this project, is withdrawn.

What survives: iOS reports the extension as enabled; the block list is not in force; every failure mode in §3 remains a candidate, including the database corruption of §3. The two tests in §6 are still the right next step — but they must be run against a build whose extension is actually instrumented, which requires `expo prebuild` (or a plugin that references the module's sources instead of copying them).

Two further consequences worth recording:

1. **The module's extension source does not compile as it stands.** `swiftc -typecheck` on `modules/call-directory/extension/CallDirectoryExtension.swift` fails: the delegate method is spelled `callDirectoryExtensionContext(_:didFailWithError:)`, while the SDK requires `requestFailed(for:withError:)` (`CXCallDirectoryExtensionContext.h:18`; the compiler's own diagnostic names the requirement). The device builds passed only because the stale copy was compiled. Whoever fixes the copy step must fix that name in the same change.
2. The app-side status text "The extension has never been asked to load" reads the *absence* of a report as evidence, which this artefact proves is unsafe. It should say "no load has been recorded" instead.

## 3c. What reference implementations actually do

Three public implementations read while writing this (all set `context.delegate` first, which the API notes call for):

| Implementation | Structure of `beginRequest` |
|---|---|
| [CallKitty](https://github.com/beepscore/CallKitty/blob/master/CallKittyDirectoryExtension/CallDirectoryHandler.swift) | Sets the delegate, then branches on `context.isIncremental`: on a full request it adds every blocking and identification entry; on an incremental one it adds and removes **deltas** with `removeBlockingEntry(withPhoneNumber:)` / `removeIdentificationEntry(withPhoneNumber:)`. It dispatches the work to a background queue but calls `completeRequest()` immediately at the end of `beginRequest` — with a `TODO: may need to check if ok to use background queue here`. |
| [TouchInstinct CallDirectoryDemo](https://github.com/TouchInstinct/CallDirectoryDemo-ios/blob/master/TouchInApp/TouchInCallExtension/CallDirectoryHandler.swift) | Adds blocking numbers **synchronously**, then streams identification entries from an App Group file line by line inside `autoreleasepool`, then `completeRequest()` — all on the request's thread. On failure it calls `context.cancelRequest(withError:)` with its own error. |
| [flutter_callkit](https://github.com/voximplant/flutter_callkit/blob/master/doc/call_directory/README.md) | Reads an app-group `UserDefaults` array and adds blocking and identification entries in a plain loop, synchronously. |

The common shape: **add entries synchronously inside `beginRequest`, then complete**, with deltas rather than a full rewrite when the request is incremental. Our extension instead dispatches to a background queue, hops between chunks, and completes later — the one structural difference from every working example found, and the reason a long load can silently expire (§2). Two of the three also call `context.cancelRequest(withError:)` on failure, which surfaces a problem to the system instead of leaving a half-written request.

## 4. Limits: what is documented versus observed

Apple documents **no** number: the error case exists, the threshold does not. Practitioner reports:

| Observation | Source |
|---|---|
| "1 million numbers will be added in about 100 seconds" (identification entries) | [thread 694514](https://developer.apple.com/forums/thread/694514) |
| "My limit now is around 1,800,000 entries", while another app "is able to add more than 10,000,000 entries" in what appears to be a single extension | [thread 769594](https://developer.apple.com/forums/thread/769594) |
| Truecaller splits its database across **four** Call Directory extensions, Getcontact across **three** (observed on our own test device's Settings screen) | device observation, 2026-10-02 |

Practical reading: the ceiling is per-extension and undocumented, in the millions; 111,112 entries is well inside it, so `maximumEntriesExceeded` is an unlikely explanation for our failure. Both load time (≈100 s per million) and database churn are the real costs of large lists.

## 4b. Measured on the device, 2026-10-02

After fixing the build trap (§3b) the extension reports what it does, and the app records what CallKit answers. On the iPhone 15 / iOS 27.0 test device, same app, same build, same code — **only the size of the block list changed**:

| Entries written | `reloadExtension` | Extension ran |
|---|---|---|
| 1 | no error | yes, loaded 1 |
| 1,111 | no error | yes |
| 11,111 | no error | yes |
| **50,000** | no error | yes |
| **75,000** | **error 2, `loadingInterrupted`** | **no** |
| 100,000 | error 2, `loadingInterrupted` | no |
| 111,112 (the real Rules) | error 2, `loadingInterrupted` | no |

So the failure is not the mechanism, the entitlements, the App Group, the build, or the device: **`reloadExtension` is interrupted before the extension is ever launched once the list is large enough**, and the threshold on this device sits between 50,000 and 75,000 entries. That is the same error — 2, `loadingInterrupted` — that [thread 693747](https://developer.apple.com/forums/thread/693747) reports for an app that "frequently keep[s] updating the list of blocked numbers", unanswered since 2021.

The consequence for the design is blunt: on iOS the list must stay small. Our prefix rule (`+6282356090` → 111,111 entries) can never work, and neither can any expansion in the tens of thousands. The Capacity cap of 1,000,000 that the app enforces is wrong by an order of magnitude.

## 4c. The blocking path itself is dead on the test device

With every other variable eliminated — fresh app install, fresh extension registration, no legacy rows, a single-number Rule, a clean load (no reload error, no expiry, no delegate failure) — the test device (iPhone 15, iOS 27.0) behaves like this:

| Evidence | Result |
|---|---|
| `removeAllBlockingEntries()` removed, deltas only | load completes cleanly |
| Blocking rows in CallKit's store | present — inserting them again fails with `UNIQUE constraint failed: PhoneNumberBlockingEntry`, which only happens when the row exists |
| Identification entry for the *same number*, same request | **applies** — the number shows "Call Blocker: Blocked by Call Blocker" in Recents |
| **Blocking entry for that number** | **ignored** — the call rings, and the log shows `fetchLiveBlockingInfoForHandle … block=NO` |
| The system block list (Settings › Phone › Blocked Contacts) | **blocks** the same call: `VoicemailReason::BlockedCall` |
| Logs | no SQLite corruption, no delegate failure, no expired request |

So on this device iOS stores and applies our identification entries and ignores our blocking entries, while its own block list works. Nothing in the app can influence that: the same `beginRequest`, the same context, the same numbers, the same transaction.

This is the failure mode the Apple forums describe for the CallKit database bug (FB20986470, §3), whose only reported recovery is *Reset All Settings*. It is also the reason the app must **detect** the state rather than assume success — which it now does, through the extension's load report and the reload error surfacing in Protection status. For a device in this state, the only routes to working call blocking are an iOS update, a full settings reset, or moving the decision server-side with Live Caller ID Lookup (§5).

## 5. Alternatives

| Approach | Can it block a call? | What it requires | Limits |
|---|---|---|---|
| **Call Directory extension, blocking entries** | Yes | An app extension, an App Group to share the list between app and extension, platform's Settings switch | Undocumented per-extension entry cap; silent failure modes above; the corruption bug |

| **Call Directory extension, identification entries** | No (labels only) | Same | Shares the extension's entry list, so it competes with blocking entries for whatever the cap is (inference from the API shape: both kinds live in the same `CallDirectory.db`); a forum report puts 1,000,000 identification entries at ~100 s to load ([thread 694514](https://developer.apple.com/forums/thread/694514)) |
| **Live Caller ID Lookup** (iOS 18+) | **Yes** — the blocking response is one byte, `0` don't block / `1` block, fetched per call from the app's server | A PIR server, a Privacy Pass token issuer, Apple relay servers, **endpoint validation by Apple** ("submit your request"), registration in the CloudKit Console Identity & Trust page | Removes the local entry cap entirely (§5b confirms nothing newer replaces it); needs infrastructure and network at call time; cached per number. Apple's own server backend is an **example, not a product**: "While functional, this is just an example service and should not be run in production", and building it takes Swift 6.1+ on macOS or Linux ([pir-service-example](https://github.com/apple/pir-service-example)) |
| **Focus / Silence Unknown Callers** | Yes, but user-controlled | Nothing | Not drivable by an app; no per-number logic |
| **Carrier-level blocking** | Yes | Carrier contract | Outside the app's control |

> On the App Group and account tier: a third-party integration guide states "Apple does not allow App Groups on a free Personal Team. There is no way around it." ([callerapi.com](https://docs.callerapi.com/ios-prerequisites-2275084m0)) — **unverified**: Apple's capability table does not expose the membership column in a machine-readable form, and our own device build provisioned both the App Group and the extension on team `6NN3PT736K` without any capability request. Treat the claim as a practitioner report, not a rule.

Sources: [Live Caller ID Lookup overview](https://developer.apple.com/documentation/identitylookup), [Getting up-to-date calling and blocking information for your app](https://developer.apple.com/documentation/identitylookup/getting-up-to-date-calling-and-blocking-information-for-your-app) ("The app extension tells the system how to communicate with your server … This requires endpoint validation from Apple"), [Formatting data for blocking and identity information](https://developer.apple.com/documentation/identitylookup/formatting-data-for-blocking-and-identity-information) (blocking = `0`/`1`; identity = a `CallIdentity` protobuf), [Understanding how Live Caller ID Lookup preserves privacy](https://developer.apple.com/documentation/identitylookup/understanding-how-live-caller-id-lookup-preserves-privacy).

**Verdict: there is no local alternative.** For a two-person project with no server, the Call Directory extension is the mechanism, and the engineering question is how to keep the list small and the load observable. Live Caller ID Lookup is the only design that scales to arbitrary lists, and it is a different project — a hosted service plus an Apple approval.

## 5b. iOS 26 and 27 changed nothing here

Checked because the test device runs iOS 27:

- Apple's official changelog for the framework lists exactly one recent change, a call-translation action added June 2025: "Configure a call to include an option to use the system's translation capabilities with a CXSetTranslatingCallAction." **No Call Directory changes.** ([CallKit updates](https://developer.apple.com/documentation/updates/callkit))
- The forum announcement of iOS 26 CallKit changes covers new diagnostic dialogs for VoIP push problems, and nothing about the Call Directory. ([CallKit tag](https://developer.apple.com/forums/tags/callkit))

So on iOS 27 the mechanism, the error codes, the undocumented entry cap, and the corruption bug are all as described above.

What iOS 26 *did* add is a system feature that competes with a blocking app rather than serving it — **Call Screening**, documented in the iPhone User Guide for iOS 27:

> "Call Screening automatically answers calls from unknown numbers without interrupting you. After the caller shares their name and reason for their call, your iPhone rings and shares their response so you can decide if you want to pick up. You can also choose to silence calls from unknown callers and send them directly to voicemail." ([Screen and block calls on iPhone](https://support.apple.com/guide/iphone/screen-and-block-calls-iphe4b3f7823/ios))

The same page documents *Unknown Callers* ("Calls from unknown numbers are removed from your Recents list and sent to the Unknown Callers list"), *Spam* filtering, and per-contact blocking. None of it is drivable by an app — there is no API for any of these settings — but together they cover much of what a person installs a blocker for, which is worth weighing before investing further in this app.

## 6. What this means for Call Blocker

1. **Test whether the phone itself is broken** before changing more code: ask the user whether any *other* call-blocking app on that device blocks a call today. All of them failing means device-level CallKit corruption, which no app can fix — only *Reset All Settings*, or waiting for Apple.
2. **Never call `removeAllBlockingEntries()` as a shortcut.** The failure that is on record is a `DELETE FROM PhoneNumberBlockingEntry`; removing and re-inserting the whole list on every reload is the maximum exposure to it. Send the delta — remove only the numbers that went away, add only the ones that arrived, as CallKitty does (§3c) — or keep the list small enough that a reload has almost nothing to change.
3. **Stop expanding prefixes into six-figure entry counts — the measured ceiling is between 50,000 and 75,000 (§4b).** Every reload inserts the whole list again, and above that size CallKit answers `loadingInterrupted` and never launches the extension. Cap the expansion where it is known to work (a figure in the low tens of thousands, with the count shown at Registration), not at 1,000,000.
4. **Read `completeRequest`'s `expired` flag** and treat it as a load failure — today a timed-out load is indistinguishable from success. Then restructure `beginRequest` to match the working implementations in §3c: add synchronously, complete at the end, and send deltas when the request is incremental.
5. **Surface the reload error verbatim** (`reloadError`), and translate the documented codes (3, 4, 5, 6, 102) into sentences a person can act on. Partly done.
6. **Fix the build trap before trusting any instrumentation** (§3b): the plugin must reference the module's extension sources rather than copying them at prebuild, and it must fix the delegate method name, or the extension source does not even compile.

## 6b. Hypotheses, and the smallest test for each

Ordered by what to do first, cheapest first. Until a *correctly prebuilt* build is on the device (§3b), every observation about the extension is untrustworthy — so everything below assumes that build.

| Hypothesis | Smallest test | If confirmed |
|---|---|---|
| **Build artefact**: the extension on the device is not the code in the repo | Deploy after `expo prebuild`; note whether a load report appears at all | The mechanism works; earlier "never loaded" conclusions were void and get re-measured |
| **The list is too big / the load expires** (`expired = true`) | Cut the Rules to a handful of single numbers, reload, call the number | Cap iOS expansion low; restructure `beginRequest` to add synchronously and complete at the end |
| **Frequent reloads are interrupted** (`loadingInterrupted`, 2) | Count the reloads a session performs; batch writes so one reload covers a whole edit | Rewrite the sync policy: one reload per session, not one per change |
| **The extension is not actually registered** (`noExtensionFound`, 1; `extensionDisabled`, 6; undocumented 102) | Read the error text from `sync`; toggle the extension off/on | Reinstall + re-enable, or rebuild the registration |
| **Device-level database corruption** (`com.apple.callkit.database.sqlite Code=11`) | Test whether *another* call-blocking app still blocks a call today | Nothing an app can do: *Reset All Settings*, or wait for Apple's fix |
| **CallKit accepts the list and still allows the call** | Number check inside the app, then a real call from that exact number | Compare the Canonical number against what the carrier delivers |

Every test above is one action for the person holding the phone, and each result eliminates whole branches of this document rather than narrowing a single one.

## 7. What we still do not know

- ~~The exact error our device returns from `reloadExtension`.~~ **Answered (§4b): error 2, `loadingInterrupted`, above roughly 50,000 entries; no error at or below it.** The previous open question was: The app reports it in Protection status ("Written, but CallKit would not reload it: …") — but only once a *correct* prebuild has been deployed: the version on the device carries neither that reporting nor the extension-side load report (see §3b). `102` or a SQLite `Code=11` would each confirm a different hypothesis.
- ~~Whether the CallKit database on our test device is corrupt~~ — settled in §4c: blocking entries are stored and not honoured, identification entries from the same request are honoured, and the system block list works. It is the blocking path, not the database as a whole.
- **The system's time budget for `beginRequest`.** Documented nowhere; the `expired` flag is the only way to observe it, which our extension now records.
- **Whether our chunked, asynchronous adding (10,000 entries per queue hop) makes expiration more likely** than adding synchronously inside `beginRequest`. Worth measuring on a healthy device.
- **Whether re-adding the entire list on every incremental request is itself a corruption trigger.** The officially unknown cause has a known *symptom* — a failing `DELETE FROM PhoneNumberBlockingEntry` — and our reload-everything pattern maximises the number of those statements. Whether the delete is the trigger or the first casualty is not established.
