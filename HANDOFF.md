# Call Blocker — handoff

Written 2026-10-03 for whoever picks this up next. The repo is `/Users/dwihp2/dev/call-blocker`. Read `CONTEXT.md` for the vocabulary, `docs/adr/` for the decisions, and `docs/research/ios-call-blocking.md` for the iOS investigation — this file is the map between them and the current state.

**The one-line status:** the app is built and works as software; iOS call blocking on the test device does not, and the evidence says that is the device, not the code. Details in §5, and one caveat in §5.4 that matters.

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
| iOS app + extension | `expo prebuild --clean` then `xcodebuild … -destination 'id=<device>'` builds, provisions and installs; the extension is embedded and validated |
| App screens | all nine screens verified on the iOS simulator and on the device; Rules list, Registration, Bulk import, Number check, Backup, Settings, Protection, Onboarding |
| Web fallback | the app renders with inert engines (verified in a browser) |

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

Same extension, same numbers, same transaction: iOS honours the identification half and ignores the blocking half, while its own block list works. Apple's forums describe this class of failure (FB20986470: blocking stops working device-wide; reinstalling, rebooting and re-enabling do not help) and a DTS engineer confirms it is under investigation with no fix released; the only reported recovery is *Reset All Settings*.

**Immediate workaround for a device in this state:** nothing app-side helps. Options are *Reset All Settings*, an iOS update, or moving the decision server-side with Live Caller ID Lookup (`docs/research/ios-call-blocking.md` §5) — which is a server project with an Apple endpoint-validation request, not a patch.

### 5.4 A caveat that must not be lost

The `readLoaded()` fallback in `RuleEngine.swift` — "if no baseline is recorded, assume the blocking list is already loaded" — was **my bug**. It made a fresh install compute an empty delta and send *nothing* while reporting success. One of the fresh-install tests that fed §5.3 was run under that bug, so that particular test proves less than it appeared to. §5.3 rests on the identification-vs-blocking test and the `UNIQUE constraint` proof, both taken when the rows were demonstrably present.

The tree has a fix for it (uncommitted at the time of writing, §7): when no baseline exists, the extension states the whole list instead of assuming.

### 5.5 What the investigation fixed in the product

- Capacity 1,000,000 → **25,000**, measured.
- The extension sends **deltas** and never calls `removeAllBlockingEntries()` — that delete is the statement CallKit is reported to fail on, and re-adding rows CallKit already holds is an error, not a no-op.
- Every load is recorded in the App Group (`startedAt`, `finishedAt`, `entries`, `failure`) and every reload records its error, so **Protection status tells the truth**: whether the extension ran, and CallKit's own words when it refused.
- `completeRequest`'s `expired` flag is read; an expired request discards every entry it added and used to look like success.
- The delegate method is `requestFailed(for:withError:)` — the earlier spelling did not conform and never fired.
- The app saves its state safely: the old temp-file-`move` deleted the destination before moving, so a failed move destroyed the saved Rules (it happened once).

## 6. Phone and simulator state

- **iPhone 15, iOS 27.0 (24A437)**, team `6NN3PT736K` — a **free Personal Team**: 7-day provisioning profiles (currently expiring 2026-10-07) and one device. Free is enough for development; a paid membership is needed for other people's devices, TestFlight, the App Store, or Live Caller ID Lookup.
- Bundle ids: `com.dwihp2.call-blocker` (iOS), `com.dwihp2.callblocker` (Android — no hyphen; illegal in a Java package). App Group `group.com.dwihp2.call-blocker`.
- The app on the phone currently holds **one Rule** (`+6285117373483`, "hery"); the old prefix Rule cannot return as it was, since it expands past Capacity.
- A simulator (iPhone 15, iOS 17 runtime) is used for UI work; the app runs there headless and can be driven by writing `Documents/call-blocker/tour.txt` and relaunching (a temporary hook is needed for that; it was removed).
- Device tooling available on this Mac: `xcrun devicectl` (install, launch, screenshot, file copy, crash logs), `idevicesyslog` (needs the phone on USB), and `log collect` (needs root).

## 7. Uncommitted work in the tree (not written by this session)

At handoff time `git status` shows changes from **another session** that should be reviewed and committed rather than reverted:

- `CallDirectoryExtension.swift`: entries are now added **synchronously inside `beginRequest`** and the request completes in one pass — the shape every working implementation uses (`docs/research/ios-call-blocking.md` §3c).
- `CallDirectoryModule.swift`: **reloads are coalesced** — one at a time, with a trailing reload if writes landed while one ran — because CallKit answers `loadingInterrupted` for apps that reload frequently.
- `RuleEngine.swift`: the `readLoaded()` fix described in §5.4.
- `apps/mobile/app.json`: version 0.1.1, build 2. `README.md` and `docs/adr/0004` were also touched.

The repo root is also polluted by an accidental project: `app.json`, `ios/` and `tsconfig.json` at the top level plus `expo`/`react`/`react-native` in the root `package.json`, all from running `expo run:ios` at the repo root instead of in `apps/mobile`. It builds a stub app that iOS kills on launch. Delete those three paths and revert the root `package.json` when convenient.

## 8. Next steps, in order of value

1. **Android on a real device** — nothing on that side has ever run outside unit tests. `npx expo run:android` from `apps/mobile`, grant the call-screening role, register a Rule, call from another phone.
2. **Re-test iOS after a *Reset All Settings*** on the test device (Settings → General → Transfer or Reset iPhone → Reset). If the device recovers, the app should block with one Rule — verify with a real call, then restore the person's Rules.
3. **Re-verify the delta path on a fresh install** now that the `readLoaded` bug is fixed: install, seed one Rule, confirm the load report says the extension added it, then call.
4. Commit the other session's work once reviewed; clean up the stray root project.
5. Product follow-ups worth doing: show the *load* state on the Rules screen (not only in Protection), and restore a narrow prefix Rule for the test device once the cap allows it.

## 9. Gotchas the next session will hit

- **Expo commands run in `apps/mobile`**, never at the repo root.
- **Every reinstall turns the Call Blocking extension off** in Settings → Phone → Call Blocking & Identification. Not the app's fault; iOS offers no API.
- **Xcode 27 / iOS 27 SDK** requires the scene lifecycle; `ios.enableSceneSupport` in `expo-build-properties` is what makes the app launch at all.
- Metro's default port **8081 is used by the user's `gym-app`** project; run this app's dev server with `--port 8082`.
- A device build needs `-allowProvisioningUpdates`; a fresh install needs the developer profile trusted again in Settings → General → VPN & Device Management.
- `devicectl` file access (app containers, App Group) needs the phone unlocked, and libimobiledevice needs it on USB.

## 10. Open questions

- Does the *Reset All Settings* recovery actually restore blocking on the test device? (Reported, not yet seen here.)
- Is the synchronous add enough to make loads reliable at the top of the 25,000 ceiling, or is 50,000 where it really breaks? The measurement was taken with the asynchronous, chunked add.
- If iOS blocking cannot be relied on for a given person's device, does the app say so in the UI, or keep the current "Protection status reports what happened" approach?
