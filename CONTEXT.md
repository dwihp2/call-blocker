# Call Blocker

A mobile app (iOS and Android) that lets a person decide which incoming callers are blocked and which are always let through, by registering Rules over numbers and number patterns.

## Language

### Rules

**Rule**:
One instruction to block or allow incoming calls from numbers matching a Number pattern. Created by Registration.
_Avoid_: Entry, filter, item

**Block rule**:
A Rule that stops matching callers from reaching the person.
_Avoid_: Blacklist entry

**Allow rule**:
A Rule that lets matching callers through even when a Block rule would stop them.
_Avoid_: Whitelist entry, exception

**Block list**:
All Block rules the person has registered.
_Avoid_: Blacklist

**Allow list**:
All Allow rules the person has registered. Does not include Contacts allowance.
_Avoid_: Whitelist

**Registration**:
The act of creating a Rule from a number, prefix, or interval the person types in.
_Avoid_: Adding a number

**Label**:
A short note the person attaches to a Rule to remember why it exists.
_Avoid_: Name, description

**Overlap**:
When a newly registered Rule matches numbers already covered by an existing Rule of the opposite kind. An Allow rule prevails over a Block rule.

**Bulk import**:
Registering many Rules at once from pasted or uploaded lines, with one Block or Allow choice for the whole import.

**Shadowed rule**:
A Rule that can never fire, because another Rule always wins over every number they share.
_Avoid_: Dead rule, masked rule

**Number check**:
A lookup that reports what would happen to a number the person types: blocked or not, and which Rule decides it.
_Avoid_: Test a number, dry run

### Number patterns

**Number pattern**:
What a Rule matches on: a Single number, a Prefix, or an Interval.
_Avoid_: Range (ambiguous, it covers two different patterns)

**Single number**:
A Number pattern matching exactly one phone number.

**Prefix**:
A Number pattern matching every number that begins with a given digit sequence.

**Interval**:
A Number pattern matching every number between an explicit start number and end number, inclusive.

**Canonical number**:
A phone number normalized to international (E.164) form, so the same number typed differently is recognized as the same.

**Default region**:
The country used to interpret numbers typed in local format. Starts as the device's region, and can be changed in Settings or for a single Registration.
_Avoid_: Country code

### Contacts

**Contacts allowance**:
A person-controlled toggle that treats every number in the device's contacts as allowed. Independent of the Allow list. A Single number Block rule still blocks a contact.
_Avoid_: Contacts whitelist

### Protection

**Blocking**:
The app-wide switch. When off, no calls are blocked, but the Rules stay saved.
_Avoid_: Master switch, pause

**Protection status**:
The checklist of permissions and platform settings the app needs in order to block calls, each shown as on, off, or needs attention.

**Onboarding**:
The first-launch walkthrough that asks for the permissions Blocking needs.

**Effective block list**:
The numbers actually blocked at a given moment, after Allow rules and Contacts allowance are applied.

**Capacity**:
How many numbers the iPhone can hold in its blocking list at once. A change that would push the Effective block list past Capacity is refused on iOS, never silently trimmed.

### Portability

**Backup file**:
A JSON file holding a person's Block rules so they can be restored later, on the same or the other operating system. Allow rules are not included.

**Restore**:
Loading a Backup file into the app, either merging its Block rules into the existing Block list or replacing it.
