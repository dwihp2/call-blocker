# Call Blocker

Blocks and allows incoming calls on iOS and Android. Rules are Single numbers, Prefixes or Intervals; an Allow list overrides Block rules, and the device's contacts can be allowed as a group.

The vocabulary is in [CONTEXT.md](./CONTEXT.md). The decisions behind the design are in [docs/adr](./docs/adr).

## Layout

```
apps/mobile          Expo SDK 57 app (expo-router, new architecture)
packages/core        parsing, Backup file, contract types (TypeScript)
modules/call-directory   iOS: Swift engine, Call Directory extension, config plugin
modules/call-screening   Android: Kotlin engine, CallScreeningService
fixtures/matching.json   the matching contract, run by both native engines
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
- iOS holds a flat list of blocked numbers, so Prefixes and Intervals are expanded. The app caps that at 1,000,000 entries (`Capacity`) and refuses changes that would exceed it rather than trimming them.
- Android 10 or newer: the call screening role is what gives the app the right to see incoming numbers.
- Blocked calls on Android are rejected and stay in the system call log; no notification is posted.
