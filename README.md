# Call Blocker

Blocks and allows incoming calls on iOS and Android. Rules are Single numbers, Prefixes or Intervals; an Allow list overrides Block rules, and the device's contacts can be allowed as a group. A Rule can be turned off without deleting it.

The vocabulary is in [CONTEXT.md](./CONTEXT.md). The decisions behind the design are in [docs/adr](./docs/adr).

## Layout

```
apps/mobile          Expo SDK 57 app (expo-router, new architecture)
packages/core        parsing, Backup file, contract types (TypeScript)
modules/call-directory   iOS: Swift engine, Call Directory extension, config plugin
modules/call-screening   Android: Kotlin engine, CallScreeningService
fixtures/matching.json   the matching contract, run by both native engines
docs/adr                 the decisions
docs/research            the iOS investigation
docs/ios-lifecycle.md    the iOS pipeline: how a Rule becomes a settled blocking entry
```

## Requirements

- Node 22.13 or newer.
- iOS: Xcode 26+, CocoaPods, an Apple Developer account for device builds (the extension needs an App Group).
- Android: Android SDK with API 29+ (Android 10), JDK 17+.
- A development build is required. Expo Go can host neither a Call Directory extension nor a call screening service.

## Install and run

```sh
npm install
cd apps/mobile
npx expo prebuild --clean        # regenerates ios/ and android/ including the extension target
npx expo run:ios                 # or: npx expo run:android
```

Every Expo command runs in `apps/mobile`, never at the repo root: the root is a
workspace manifest, and running `expo run:ios` there builds a stub app with no
JavaScript entry and no scene lifecycle, which UIKit kills at launch on iOS 27
(`EXC_BREAKPOINT`, `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`).
For a build that runs without Metro, use `npx expo run:ios --configuration Release`,
or open `apps/mobile/ios/CallBlocker.xcworkspace` in Xcode.

`npx expo prebuild --clean` is the supported path: both native pieces are produced by config plugins and the module manifests, so the generated `ios/` and `android/` directories are disposable.

After the first build, start Metro with `npm run app` and reload the dev client.

## Tests

```sh
npm test                                   # @call-blocker/core (vitest)
npm run fixtures:jvm                       # Android engine against fixtures/matching.json
swiftc -O modules/call-directory/ios/RuleEngine.swift \
  modules/call-directory/tests/run-fixtures.swift -o /tmp/cd-fixtures \
  && /tmp/cd-fixtures fixtures/matching.json
```

The two native engines are separate implementations of one contract, so `fixtures/matching.json` is the tie-breaker: any semantics change lands there first, then in both engines. On device, Settings > Protection status > Verify matching engine runs the same table.

## Platform notes

- iOS blocking only works while the extension is enabled in Settings > Phone > Call Blocking & Identification, which the app cannot switch on itself; Protection status deep-links there.
- iOS holds a flat list of blocked numbers, so Prefixes and Intervals are expanded. `Capacity` is **25,000** entries — measured, not chosen: on an iPhone 15 running iOS 27.0, lists of 50,000 reload and load, while 75,000 and up make CallKit answer `loadingInterrupted` and never launch the extension. Changes that would exceed it are refused, never trimmed (`docs/adr/0004`).
- A Prefix expands across the lengths the country actually dials, from a per-country table in `packages/core` (`DIALED_NATIONAL_LENGTHS`), falling back to libphonenumber's possible lengths. Indonesia dials 10–13 digits with the country code, so a 10-digit prefix costs **1,111** entries where the raw metadata claimed 111,111 — and each further digit divides the cost by ten. Blocking one exact 100-number slice is still an Interval rule's job.
- The extension **states the whole list on every request** (Simple Call Blocker's shape, adopted 2026-10-05): it never reads `context.isIncremental`, which makes every request a *complete* request — in the SDK's words, "the system replaces the extension's entries with the ones added here" — and it never calls `removeAllBlockingEntries()`. CallKit's log shows the replacement as `Performed initial deletion for extension`, then `Added N phone number blocking entries`. A delta would have to be computed against a remembered baseline, and a stale baseline is how a fresh install once added nothing while its records said "loaded"; a complete request needs no baseline, and it repairs a device whose rows went missing.
- Android 10 or newer: the call screening role is what gives the app the right to see incoming numbers.
- Blocked calls on Android are rejected and stay in the system call log; no notification is posted.

## When blocking does not work on iOS

Work down this list; each step is something the app can tell you or something you can see.

1. **Protection status** shows whether the extension ever loaded: "The extension loaded N numbers at …" means the app did its part. "never been asked to load", "never reported finishing", or a failure line names what went wrong, and `docs/research/ios-call-blocking.md` explains each.
2. **The extension must be on** in Settings > Phone > Call Blocking & Identification. Every reinstall turns it off, and iOS offers no API to switch it on.
3. **Sync failures are shown, not swallowed**: Protection reports "Written, but CallKit would not reload it: …" with CallKit's own words.
4. **The list must be small** (see Capacity above). A Rule that expands past it is refused at Registration with the count that would be needed.
5. **A number saved in Contacts, or with any record in Recents — most of all an outgoing call made from this iPhone — out-ranks the app's blocking entry**: iOS 18+/26 platform precedence, DTS-confirmed (forums 763423, 763803 and 800415). On the test device (2026-10-05) calls rang while the number's Recents held records, and blocking resumed after the history was cleared. Remove the contact, delete every Recents entry for the number, and never call a number from the device under test. `docs/research/ios-call-blocking.md` §3d, `docs/ios-lifecycle.md` §2.
6. **Only if steps 1–5 all check out and calls still ring**, treat the shared blocking database as the last suspect — Apple's forums describe a device-wide failure class (FB20986470, `docs/research/ios-call-blocking.md` §4c) whose only reported recovery is *Reset All Settings*. Check step 5 first and properly (every Recents entry deleted, no contact): those forum reports read differently once precedence is out of the way.

### Changing the extension's Swift is a build trap

The config plugin used to copy the extension's sources into the generated project, so `xcodebuild` compiled a copy that only `expo prebuild` refreshed — a deployed extension that silently differed from the repository. The plugin now links `modules/call-directory/extension/CallDirectoryExtension.swift` and `ios/RuleEngine.swift` directly. Keep it that way: if the extension ever stops matching the repo, every measurement about it becomes worthless.
