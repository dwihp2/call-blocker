# From Rule to settled blocking entry: the iOS pipeline

How a Rule becomes a call that does not ring, and when that change actually
takes effect. Companion to `docs/research/ios-call-blocking.md` (how the
mechanism fails and the sources for it) and `docs/adr/` (what the product
decides). Every claim below was observed on the test device — iPhone 15, iOS
27.0.1 — and the quoted lines are CallKit's own, from `pymobiledevice3 syslog
collect` archives read with `log show` (recipes in `HANDOFF.md` §9).

## Actors and state

| Piece | Lives where | Owns |
|---|---|---|
| App (Expo app + `CallDirectoryModule.swift`) | the screen | Rules, Capacity, the Effective block list |
| App Group store | `group.com.dwihp2.call-blocker` | `blocked.json` (the list), `meta.json`, `load.json`, `loaded.json`, `reload.json` |
| Call Directory extension | headless process, launched on demand by the daemon | reading the list and registering it — nothing else |
| CallKit daemon (`com.apple.CallKit.CallDirectory`) | system | the shared database, per-extension state, the reload API |
| CallKit database | `/private/var/mobile/Library/CallDirectory/CallDirectory.db` (root-only) | blocking and identification rows, keyed by extension |
| `communicationtrustd`, `callservicesd`, `CommCenter` | system | the per-call lookup and the block decision |

The app never reads or writes the database. No code of ours runs per call, and
none of our code ever sees a phone number that is calling.

## 1. Writing — what a Rule change triggers

1. **Build the Effective block list.** `sync` expands Prefixes and Intervals
   into individual numbers (E.164 digits, no `+`), subtracts Allow rules and
   the Contacts allowance, and refuses a change past **Capacity 25,000**
   instead of trimming it (`docs/adr/0004`).
2. **Write it whole.** The entire list goes into the App Group as
   `blocked.json` — one flat, ascending, de-duplicated array. There is no
   diffing and no journal; the file is the state.
3. **Ask CallKit to reload.** `CXCallDirectoryManager.reloadExtension(
   withIdentifier:)`. This call carries **no numbers** — it is only "re-run my
   extension". Its completion handler's error is the only direct feedback the
   app gets (`reload.json`).
4. **The daemon runs the extension.** It launches the extension process and
   opens a *data request* with a time budget. The extension reads
   `blocked.json` and calls `addBlockingEntry(withNextSequentialPhoneNumber:)`
   once per number, ascending, in **one synchronous pass**, then
   `completeRequest`. Ascending order, uniqueness and completing inside
   `beginRequest` are hard contracts — breaking them yields
   `entriesOutOfOrder` (3), `duplicateEntries` (4) or a silent `expired` where
   every entry is discarded.
5. **The system replaces this extension's rows.** The daemon logs the
   replacement — never a diff:

   ```
   Extension data request added blocking entry data: <private>
   Performed initial deletion for extension with identifier <private>
   Added N phone number blocking entries
   Data request completed successfully for extension with identifier <private>
   ```

   `Performed initial deletion` is the system deleting the extension's previous
   rows before applying the new set. That is why the extension needs no memory
   of what it sent, and why stale rows from an earlier install cannot survive a
   successful load.
6. **The extension reports back.** It writes `load.json` / `loaded.json` /
   `reload.json` into the App Group — the only way the app can tell "ran and
   loaded N" from "never ran" (a Call Directory extension otherwise fails
   completely silently).

## 2. Settling — when the change is actually live

- The extension usually runs a second or two after the reload request (log:
  request `14:28:06`, entries added the same second). Allow **tens of seconds**
  before trusting a test call: on 2026-10-05, a call **24 s** after a load
  still rang, while a call **103 s** after the same load was blocked.
- What can defeat a *settled* entry — all of it lives outside the app:
  - **Contacts** (iOS 18+): a number saved in Contacts is never blocked.
  - **Recents** (iOS 26+): a number that was **called from this iPhone** is not
    blocked until its call-history entry is deleted. On 2026-10-05 the test
    device produced its first confirmed block (`VoicemailReason::BlockedCall`,
    14:29:50) with only Call Blocker enabled; five calls over the next two hours
    rang (`shouldBlock: NO` every time) while the number's Recents held
    records, and blocking resumed, per the person, after the history was
    cleared.
  - **Identification entries**: an identification entry for the same number can
    conflict with a blocking entry (Apple DTS describes it as an edge case they
    are not certain about). Other apps write identification entries into the
    same shared database. Watch for stale labels: on the test device a
    `Call Blocker: Blocked` label sat on Recents calls this app never blocked —
    a leftover identification entry from the 2026-10-02/03 experiment build,
    not current code (no identification-entry load from this app appears in any
    archive; the only large identification loads were neighbours' — 10,000 +
    10,000 + 4,005 entries in one request at 14:45).
  - **The database is shared and is not a clean room**: uninstalling an app
    does not delete its rows (measured: `UNIQUE constraint failed` when
    re-adding a number after a reinstall), and disabling an app leaves its rows
    behind. On 2026-10-05, neighbour extensions loaded **8,901 blocking** and
    **20,005 identification** entries into it inside one minute.
- **Capacity, measured**: lists up to 50,000 entries reload and load; 75,000+
  make CallKit answer error 2 `loadingInterrupted` and never launch the
  extension at all.

## 3. Reading — an incoming call

1. `communicationtrustd` runs `isHandleBlocked(_:)`:

   ```
   isHandleBlocked(_:) handle: <private>
   Looking up call directory blocked entries for handles <private>
   Call directory blocked entries found <private>
   ```

2. `callservicesd` records the verdict: `shouldBlock: YES/NO`.
3. On a block, `CommCenter` sends the call to voicemail:

   ```
   Send call … to voicemail: VoicemailReason::BlockedCall
   ```

   Nothing rings, and a blocked call typically does **not** appear in Recents —
   absence from Recents is not evidence that a call never arrived.

**Do not confuse "did not ring" with "blocked".** A call can also be *silenced*
— `shouldBlock: NO shouldSilence: YES` in the log, produced by Settings ›
Phone › Silence Unknown Callers or by a Focus mode. That also stops the ring,
but nothing was blocked and the entry was never consulted. Only
`VoicemailReason::BlockedCall` proves a blocking entry applied.

## 4. Lifecycle events, in the order they confuse people

| Event | What actually happens |
|---|---|
| Fresh install | the extension is **off** in Settings; nothing loads until a human enables it. Every reinstall turns it off again; no API can flip it. |
| First enable | the daemon loads the extension on the spot (`set extension enabled status to 1 … attempting to load extension data`). |
| Toggle off | rows stay in the database; the lookup stops consulting that extension's rows. Disabling does not clean anything. |
| App update | App Group and the database rows survive; the next sync reloads. |
| Uninstall | App Group is deleted; **the database rows survive**; a reinstall can collide with them — the next successful load repairs it via the initial deletion. |
| Reboot | nothing reloads by itself; the database keeps the last settled state. |
| Rule added / removed | the whole list is rewritten and re-registered (step 1–5 above). There is no per-number add or remove on the wire. |

## 5. The test protocol that actually works

1. Know the toggles: which extensions are enabled in Settings › Phone › Call
   Blocking & Identification — every enabled app's stored list lives in the
   same database.
2. Prepare the number: **not in Contacts**, and **no entries in Recents** —
   especially no outgoing call made from this iPhone. When in doubt, delete
   every Recents entry for it.
3. Make the change (or a fresh load), then wait ~1 minute.
4. Call from another phone.
5. Verify from the device log, not the UI: `shouldBlock:` and
   `VoicemailReason::BlockedCall` are the evidence; Recents shows rings, not
   blocks.
