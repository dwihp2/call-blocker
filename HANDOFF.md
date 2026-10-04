# Call Blocker — handoff

Written 2026-10-03; **updated the same evening**, after the delta-baseline fix landed and the device fault was proven with a positive insert; **re-checked 2026-10-04** (§5.7). The repo is `/Users/dwihp2/dev/call-blocker`. Read `CONTEXT.md` for the vocabulary, `docs/adr/` for the decisions, and `docs/research/ios-call-blocking.md` for the iOS investigation — this file is the map between them and the current state.

**The one-line status:** the app is built, its last silent failure mode is fixed and verified on the device; iOS call blocking on this iPhone 15 still does not work — the OS acknowledges storing our blocking entries and then fails to find them when a call arrives (`isHandleBlocked → false`, §5.6). That is the device fault described in §5.3, not the code. Remaining levers for the device: a full reboot, then *Reset All Settings* (§8). The phone now runs iOS 27.0.1 (24A446); the person reports the registered caller still rings (§5.7).

---

## 1. What the app is

Blocks and allows incoming calls on iOS and Android. A person registers **Rules** (single numbers, prefixes, intervals) as **Block** or **Allow**, can allow their whole contact list, and can back the Block list up to a JSON file. Vocabulary and definitions: `CONTEXT.md`.

Stack: Expo SDK 57 (React Native 0.86.3, expo-router, new architecture) with two local native modules — a Swift Call Directory extension for iOS and a Kotlin `CallScreeningService` for Android. TypeScript holds parsing, validation, storage and the Backup file; the two native engines do the matching (`docs/adr/0003`).

## 2. Layout

```
apps/mobile            Expo app (SDK 57); src/app has the screens, src/data the store and engine bridge
packages/core          TypeScript: Rule parsing (libphonenumber-js), Backup file, contract types
modules/call-directory iOS: RuleEngine.swift, CallDirectoryModule.swift, extension/, plugin/
modules/call-screening Android: RuleEngine.kt, CallBlockerScreeningService.kt, RuleStore.kt
fixtures/matching.json 25 cases — the matching contract both native engines are tested against
docs/adr               0001 precedence, 0002 backup scope, 0003 native matching, 0004 capacity refusals
docs/research          the iOS investigation, fully sourced
```

## 3. The design that was agreed (interview, all recorded in the ADRs)

- **Allow beats Block** at any pattern size, with one exception: a single-number Block rule beats the Contacts allowance (`docs/adr/0001`).
- **The Backup file holds Block rules only** — never Allow rules, never settings — because an Allow list is often just contacts copied by hand (`docs/adr/0002`). Restore offers Merge or Replace; neither touches the Allow list.
- **Matching lives in native code on both platforms**, with `fixtures/matching.json` as the contract and a shared fixture table as the tie-breaker (`docs/adr/0003`).
- **iOS refuses changes that exceed Capacity** rather than trimming (`docs/adr/0004`). Capacity is **25,000** entries — measured, see §5.2.
- Deliberately out: blocked-call log, allow-only mode, private/unknown caller blocking, schedules, cloud backup, Indonesian UI.

## 4. What is built and verified

| Piece | Evidence |
|---|---|
| TypeScript core | `npm test` → 51 vitest tests; `npm run typecheck` clean in all four workspaces |
| Matching contract | Swift runner passes 25/25 (`swiftc -O modules/call-directory/ios/RuleEngine.swift modules/call-directory/tests/run-fixtures.swift -o /tmp/cd-fixtures && /tmp/cd-fixtures fixtures/matching.json`) |
| Android engine | `npm run fixtures:jvm` → Gradle JVM test passes 25/25; a mutated fixture makes it fail, so it is load-bearing |
| iOS app + extension | `expo prebuild --clean` then `xcodebuild … -destination 'id=<device>'` builds, provisions and installs; the extension is embedded and validated — and CallKit's own log confirms the extension **inserts** its entries (`Added N phone number blocking entries … Data request completed successfully`, §5.6) |
| App screens | all nine screens verified on the iOS simulator and on the device; Rules list, Registration, Bulk import, Number check, Backup, Settings, Protection, Onboarding |
| Web fallback | the app renders with inert engines (verified in a browser) |
| iOS call blocking on the test device | **Does not work — device fault, proven in §5.6. Not the app.** |

Not verified: **Android on a real device.** The service, role request and snapshot store have only run under JVM unit tests. That is the biggest untested surface left.

## 5. The iOS investigation (the long part)

### 5.1 The build trap — a deployed extension that did not match the repo

The config plugin **copied** the extension's Swift files into the generated `ios/` directory during `expo prebuild`, and every later `xcodebuild` compiled that copy. Edits to `modules/call-directory/extension/` therefore never reached the device unless a prebuild ran again — which is how several days of measurement were taken against instrumented code that was never in the binary. Fixed: the plugin now links `modules/call-directory/extension/CallDirectoryExtension.swift` and `ios/RuleEngine.swift` directly. **Keep it that way.** If the deployed extension ever disagrees with the repo, every measurement about it is worthless.

### 5.2 The list-size ceiling — measured, not guessed

With the extension instrumented and the app recording what CallKit answers, the same build was run against lists of different sizes on an iPhone 15 / iOS 27.0:

| Entries | `reloadExtension` | Extension ran |
|---|---|---|
| 1 … 50,000 | no error | yes |
| **75,000, 100,000, 111,112** | **error 2, `loadingInterrupted`** | **no** |

The app's real Rules expanded one prefix into 111,111 entries, so CallKit never launched the extension at all. Capacity is now 25,000 (`docs/adr/0004`), and Prefix expansion is refused above it at Registration. Full detail and sources: `docs/research/ios-call-blocking.md` §4b.

### 5.3 The device-level finding

With a small list, the extension loads and iOS stores its entries — provably: re-inserting the same numbers fails with `UNIQUE constraint failed: PhoneNumberBlockingEntry`, which only happens when the row is already there. And yet:

| Test | Result |
|---|---|
| Our blocking entry, number loaded, extension enabled | call **rings** |
| Our **identification** entry for the same number, same `beginRequest`, same request | **applies** — visible in Recents as "Call Blocker: Blocked by Call Blocker" |
| The system's own block list (Settings › Phone › Blocked Contacts) | **blocks** — `VoicemailReason::BlockedCall` in the device log |
| Crash logs, SQLite errors | none |

Same extension, same numbers, same transaction: iOS honours the identification half and ignores the blocking half, while its own block list works. Apple's forums describe this class of failure (FB20986470: blocking stops working device-wide; reinstalling, rebooting and re-enabling do not help) and a DTS engineer confirms it is under investigation with no fix released; the only reported recovery is *Reset All Settings*. §5.6 upgrades this from "rows are present" to "rows were *positively acknowledged as inserted* by CallKit, and the lookup still says no".

### 5.4 The `readLoaded()` caveat — resolved the same day

The `readLoaded()` fallback in `RuleEngine.swift` — "if no baseline is recorded, assume the blocking list is already loaded" — was **our bug**. It made a fresh install compute an empty delta and send *nothing* while reporting success. One of the fresh-install tests that fed §5.3 was run under that bug, so that particular test proved less than it appeared to.

**Resolved 2026-10-03 evening:** the fix is implemented (no load record ⇒ CallKit holds nothing ⇒ state the whole list), built as **0.1.1 (2)**, installed on the test device, and verified from CallKit's own log: the first post-install request arrived `incremental` and CallKit logged `Added 1` / `Added 1110 phone number blocking entries` with `Data request completed successfully` (§5.6). The bug is closed; the device result in §5.6 is now independent of it.

### 5.5 What the investigation fixed in the product

- Capacity 1,000,000 → **25,000**, measured.
- The extension sends **deltas** and never calls `removeAllBlockingEntries()` — that delete is the statement CallKit is reported to fail on, and re-adding rows CallKit already holds is an error, not a no-op. When **no baseline is recorded**, it now states the whole list instead of assuming (§5.4).
- Entries are added **synchronously** inside `beginRequest`, completing in one pass — the shape every working implementation uses.
- **Reloads are coalesced**: one at a time, with a trailing reload if writes landed while one ran.
- Every load is recorded in the App Group (`startedAt`, `finishedAt`, `entries`, `failure`) and every reload records its error, so **Protection status tells the truth**: whether the extension ran, and CallKit's own words when it refused.
- `completeRequest`'s `expired` flag is read; an expired request discards every entry it added and used to look like success.
- The delegate method is `requestFailed(for:withError:)` — the earlier spelling did not conform and never fired.
- The app saves its state safely: the old temp-file-`move` deleted the destination before moving, so a failed move destroyed the saved Rules (it happened once).

### 5.6 The positive-insert proof, and everything tried on 2026-10-03 evening

Test device: iPhone 15, iOS 27.0 (24A437), developer profile trusted, extension enabled, fresh install of **0.1.1 (2)**. One interval Rule: `+62 851 1737 3480 – …3489` (10 numbers; the caller's number `+62 851 1737 3483` is inside it — confirmed by screenshot + OCR of the ringing screen, shown as *"Maybe: Hery"*, a Siri suggestion, **not** a saved contact, so Contacts precedence is excluded).

**CallKit acknowledged the inserts** (`log show` over a `pymobiledevice3 syslog collect` archive):

```
20:55:31  com.apple.CallKit.CallDirectory: Added 1 phone number blocking entries
20:56:24  com.apple.CallKit.CallDirectory: Added 1110 phone number blocking entries
20:57:04  com.apple.CallKit.CallDirectory: Removed 1101 phone number blocking entries
          … each followed by: Data request completed successfully
```

**And every call still rang** — `shouldBlock: NO` from `callservicesd`, preceded by `communicationtrustd: isHandleBlocked(_:) → Got result false`:

| Call | Verdict |
|---|---|
| 20:41:45 (before the fix’s install; rows demonstrably present) | `shouldBlock: NO` |
| 20:44:31 | `shouldBlock: NO` |
| 20:54:28 | `shouldBlock: NO` |
| 20:57:40 (36 s after 10 entries confirmed) | `shouldBlock: NO` |
| 21:09:54, 21:10:24 (after daemon restarts) | `shouldBlock: NO` |

**Targeted resets tried — none changed the outcome:**
- `devicectl device process terminate --pid` on `com.apple.CallKit.CallDirectory`, `communicationtrustd`, `callservicesd`, `CallDirectoryMaintenance` — all respawned cleanly; next call still `shouldBlock: NO`. (No data touched; entries persist.)
- Uninstall + reinstall (multiple), a fresh `expo prebuild --clean`, re-enabling the extension, re-trusting the profile.
- What is **not** available from tooling: file access to `/private/var/mobile/Library/CallDirectory/CallDirectory.db` — Developer Mode's file services reach only app containers, app-group containers, temporary storage and crash logs. There is no supported way to repair or delete that database short of *Reset All Settings*.

**Reading note for `log show` output:** at call time, `com.apple.calls.livelookup` lines say `extensions=0` — that is the **Live Caller ID Lookup** path (unused here), not the static list. The static verdict is the `shouldBlock:` line from `callservicesd`.

**Conclusion:** the app does its job — CallKit says it inserted the entries — and iOS 27 on this device fails to find them at call time. Device fault of the FB20986470 class; no app change can fix it.

### 5.7 Re-check on 2026-10-04 — same fault on iOS 27.0.1; app side re-verified on the device

The phone was updated to **iOS 27.0.1 (24A446)** after the evening session (an OS update, so it included a full reboot — the first lever in §8.2). The person reports the same registered caller `+62 851 1737 3483` **still rings**.

The app side was re-verified from the device itself, not from the repo: the App Group store still holds the interval's 10 numbers, and the extension's own records are clean — `load.json` finished (`incremental`, no failure), `reload.json` with an empty error, `loaded.json` holding the same 10 numbers. Nothing changed on the app side, and the fault is unchanged after the update.

A fresh `pymobiledevice3 syslog collect` for today's `shouldBlock` verdict could not be completed: the archive download ran over the local-network tunnel and dropped twice (~9 minutes in, "Connection was terminated abruptly"; the partial archive was empty). With the phone on USB the same recipe from §9 will produce the verdict; the App Group records above do not depend on it.

## 6. Phone and simulator state

- **iPhone 15, iOS 27.0.1 (24A446)** (updated from 27.0/24A437 after the 2026-10-03 session), team `6NN3PT736K` — a **free Personal Team**: 7-day provisioning profiles (currently expiring 2026-10-07) and one device. Free is enough for development; a paid membership is needed for other people's devices, TestFlight, the App Store, or Live Caller ID Lookup.
- Bundle ids: `com.dwihp2.call-blocker` (iOS), `com.dwihp2.callblocker` (Android — no hyphen; illegal in a Java package). App Group `group.com.dwihp2.call-blocker`.
- The app on the phone is **0.1.2 (3)** — rebuilt 2026-10-04 with a bumped version (app.json 0.1.2, build 3) after the person uninstalled the app, the §8.2b recovery step. Fresh install: the developer profile was re-trusted (launch succeeds) and the first launch's sync **ran the extension** — load record `2026-10-04T06:06:34Z`, 0 entries, no failure — so the extension's enable state survived the reinstall (or was re-enabled). **No Rules are registered yet** (the uninstall wiped the app container and the App Group store), which is why nothing is blocked; re-register the interval Rule `+62 851 1737 3480 – …3489` and turn Blocking on.
- A simulator (iPhone 15, iOS 17 runtime) is used for UI work; the app runs there headless and can be driven by writing `Documents/call-blocker/tour.txt` and relaunching (a temporary hook is needed for that; it was removed).
- Device tooling that works today: `xcrun devicectl` (install, launch, screenshot, file copy from app/app-group containers, crash logs, **process terminate**), `pymobiledevice3` (installed via `uv tool install`, at `~/.local/bin/pymobiledevice3` — `syslog live`, `syslog collect`), and `idevicecrashreport`. `idevicesyslog` does **not** attach on iOS 27 — do not use it. Everything here works over USB **without root**.

## 7. Tree state

The uncommitted work from the evening session landed in commit `49e61b4` (2026-10-03 21:19): `RuleEngine.swift` (the `readLoaded()` fix, §5.4), `CallDirectoryExtension.swift` (synchronous adds inside `beginRequest`), `CallDirectoryModule.swift` (coalesced reloads), `apps/mobile/app.json` (0.1.1 (2)), and the doc updates. Nothing from that session remains uncommitted.

What remains is the accidental root project from running `expo run:ios` at the repo root instead of in `apps/mobile`: top-level `app.json`, `ios/` and `tsconfig.json` (untracked), a stray 29-byte `-` file holding a device UDID (untracked), and `expo`/`react`/`react-native` added to the root `package.json` + `package-lock.json` (modified). It builds a stub app that iOS kills on launch. Delete the four stray paths and revert the root `package.json`/`package-lock.json` when convenient.

## 8. Next steps, in order of value

1. **Android on a real device** — nothing on that side has ever run outside unit tests. `npx expo run:android` from `apps/mobile`, grant the call-screening role, register a Rule, call from another phone.
2. **Recover the iOS test device, cheapest first:**
   a. **Full reboot**, then one test call.
   b. Uninstall the app → **reboot** → reinstall → enable the extension → one test call.
   c. **Reset All Settings** (Settings → General → Transfer or Reset iPhone → Reset → Reset All Settings). Per Apple (`support.apple.com/en-us/126643`) this clears Wi-Fi networks/passwords, Bluetooth pairings, Apple Watch pairings, Apple Pay cards, Face ID/Touch ID setup, VPN, notification/privacy/accessibility/display settings, keyboard dictionary, home-screen layout — and **no** photos, messages, contacts, apps or app data. Afterwards: re-trust the developer profile, re-enable the extension, test again. It is the only *reported* recovery for this fault.
3. ~~Re-verify the delta path on a fresh install~~ — done (§5.6): CallKit logged the adds on a fresh install under the fixed `readLoaded`.
4. ~~Commit the work in §7~~ — done in `49e61b4`; clean up the stray root project.
5. Product follow-ups worth doing: show the *load* state on the Rules screen (not only in Protection); consider a Protection note for the "loaded cleanly but the system still rings" state; restore a narrow prefix Rule for the test device once the cap allows it.

## 9. Gotchas the next session will hit

- **Expo commands run in `apps/mobile`**, never at the repo root.
- **Every reinstall turns the Call Blocking extension off** in Settings → Phone → Call Blocking & Identification. Not the app's fault; iOS offers no API.
- **Xcode 27 / iOS 27 SDK** requires the scene lifecycle; `ios.enableSceneSupport` in `expo-build-properties` is what makes the app launch at all.
- Metro's default port **8081 is used by the user's `gym-app`** project; run this app's dev server with `--port 8082`.
- A device build needs `-allowProvisioningUpdates`; a **fresh install sets the version stamp only after `expo prebuild`** — changing `app.json` alone does not move `CFBundleShortVersionString`.
- A fresh install needs the developer profile trusted again in Settings → General → VPN & Device Management.
- `devicectl` file access (app containers, App Group) needs the phone unlocked, and libimobiledevice needs it on USB.
- **Log tooling that actually works (2026-10-03):**
  - `idevicesyslog` cannot attach to iOS 27. Use `~/.local/bin/pymobiledevice3 syslog live` for a live stream (NOTICE-level only) and `pymobiledevice3 syslog collect <dir>` for the full archive. **Rename the collected directory to `*.logarchive`** or `log show` refuses it; read it with `log show --archive <path> --start/--end --info --debug --style compact --predicate '…'`.
  - The decisive lines exist only in the collected archive at `--debug` level: `communicationtrustd … isHandleBlocked(_:)`, `callservicesd … shouldBlock: NO`, and `com.apple.CallKit.CallDirectory … Added N phone number blocking entries`. Handles are `<private>` — everything else can be read.
  - **Screenshots + OCR** give eyes on the phone and read what logs redact (e.g. the incoming number). `devicectl device capture screenshot --device <udid> --destination /tmp/shot.png`, then run this with `swift /tmp/ocr.swift /tmp/shot.png`:

    ```swift
    import Foundation
    import Vision
    import AppKit
    let path = CommandLine.arguments[1]
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
    let request = VNRecognizeTextRequest { request, _ in
      for observation in (request.results as? [VNRecognizedTextObservation] ?? []) {
        if let candidate = observation.topCandidates(1).first { print(candidate.string) }
      }
    }
    request.recognitionLevel = .accurate
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    ```
  - `devicectl device process terminate --device <udid> --pid <pid>` restarts any running process, including system daemons — the only targeted "reset" available without wiping settings. It did not fix this device.

## 10. Open questions

- Does *Reset All Settings* actually restore blocking on the test device? (Reported by forum users; not yet seen here.) A plain reboot did not — the 27.0.1 update rebooted the phone and the caller still rings (§5.7, per the person's report).
- If iOS blocking cannot be relied on for a given person's device, what should the app say? Today Protection status can truthfully report "loaded N numbers" while the system still rings — a "this phone is not blocking calls" state is not modelled yet.
- Is the synchronous add enough to make loads reliable at the top of the 25,000 ceiling, or is 50,000 where it really breaks? The measurement was taken with the asynchronous, chunked add.

## 11. Task list — what remains (as of 2026-10-04)

**Device / verification**
- [ ] **Recover the iOS test device** (§8.2): the full-reboot lever is spent — the 27.0.1 update rebooted the phone and the caller still rings (reported; log unverified, §5.7). **Uninstall → reinstall is done**: the person uninstalled, we rebuilt as **0.1.2 (3)** and installed it (2026-10-04); the profile is re-trusted and the extension ran on first launch (0 entries, §6). Remaining on the phone: **re-register the interval Rule** `+62 851 1737 3480 – …3489`, turn Blocking on, confirm the extension is on in Settings › Phone, then one test call. If still `NO`, *Reset All Settings* → re-trust → re-enable → test. Verify from an archive (`pymobiledevice3 syslog collect`, §9, phone on USB) — success is `VoicemailReason::BlockedCall` and no ring.
- [ ] **Prove blocking end-to-end once** on any healthy iPhone (the app has never been seen actually blocking a call — the code is verified only up to CallKit acknowledging the inserts, §5.6).
- [ ] Re-measure the entry ceiling with the **synchronous** add (§10) once a healthy device is available — 25,000 vs 50,000.

**Repo**
- [x] **Commit the uncommitted work** — done in `49e61b4` (2026-10-03 21:19).
- [ ] **Clean the stray root project**: delete top-level `app.json`, `ios/`, `tsconfig.json` and the stray `-` file (a UDID); revert the root `package.json`/`package-lock.json` deps (`expo`, `react`, `react-native`). It only builds a stub that iOS kills on launch.
- [ ] Free Personal Team profile expires **2026-10-07** — a device build after that needs `-allowProvisioningUpdates` and re-trusting.

**Product**
- [ ] Protection status can truthfully say "loaded N numbers" while the phone still rings. Model a distinct **"loaded, but this iPhone is not blocking"** state (or at least a hint), so the app never implies calls are being blocked when the device is in the §5.6 state.
- [ ] Show the **load state on the Rules screen** (today only Protection shows it).
- [ ] Restore a narrow prefix Rule for the test device once the cap allows it.

**Android**
- [ ] **Never run on real hardware.** `npx expo run:android` from `apps/mobile`, grant the call-screening role, register a Rule, call from another phone.

**Housekeeping / environment**
- [ ] No background jobs left running (the log capture service was stopped 2026-10-03).
- [ ] `/tmp` artifacts (`system_logs*.logarchive`, `ocr.swift`, screenshots) are ephemeral — handoff §9 carries the recipes; OCR script is embedded above.
