/**
 * The contract every part of the system shares: the app, the Backup file, the
 * iOS compiler and the Android matcher. Native code gets its behaviour from
 * `fixtures/matching.json`, which encodes these types as cases.
 */

export type RuleKind = 'block' | 'allow';

export type PatternType = 'single' | 'prefix' | 'interval';

/** E.164, digits and a leading `+`. */
export type E164 = string;

/** Two-letter ISO region, e.g. `ID`. */
export type RegionCode = string;

export interface Rule {
  id: string;
  kind: RuleKind;
  pattern: PatternType;
  /** A Single number, the digits a Prefix matches, or an Interval's start. */
  number: E164;
  /** Interval only: the inclusive end. */
  end?: E164;
  label?: string;
  createdAt: string;
}

/** A Rule without the fields the app owns. */
export interface RuleInput {
  kind: RuleKind;
  pattern: PatternType;
  number: E164;
  end?: E164;
  label?: string;
}

export interface BackupFile {
  schemaVersion: 1;
  exportedAt: string;
  rules: Array<{ pattern: PatternType; number: E164; end?: E164; label?: string }>;
}

export interface Settings {
  defaultRegion: RegionCode;
  contactsAllowance: boolean;
  /** The Blocking switch. */
  blocking: boolean;
}

/** What the app persists locally. */
export interface AppState {
  schemaVersion: 1;
  settings: Settings;
  rules: Rule[];
}

/**
 * What settled a decision. `index` points into the Rules array the engine was
 * given, so the app can name the Rule it already holds.
 */
export type DecisionSource =
  | { type: 'rule'; index: number }
  | { type: 'contacts' }
  | { type: 'off' }
  | { type: 'none' };

export interface Decision {
  blocked: boolean;
  decidedBy: DecisionSource;
}

export interface DecisionSourceExpectation {
  type: 'rule' | 'contacts' | 'off' | 'none';
  /** Rules only: the index of the deciding Rule. */
  index?: number;
}

/**
 * Everything the engines need to answer a query, in one payload. The Rules are
 * in the app's canonical order, and that order is part of the contract: the
 * first matching Rule of a kind decides which one is reported.
 */
export interface MatchInput {
  blocking: boolean;
  contactsAllowance: boolean;
  /** Canonical numbers from the device's contacts. */
  contacts?: E164[];
  /**
   * The lengths a Canonical number in each Rule's country can have, country
   * code included, supplied by the app from number metadata. The engines
   * expand a Prefix across these, so iOS blocks the numbers the country can
   * dial instead of every length E.164 allows. Ignored for Single numbers and
   * Intervals.
   */
  rules: Array<{
    kind: RuleKind;
    pattern: PatternType;
    number: E164;
    end?: E164;
    nationalLengths?: number[];
  }>;
}

export interface MatchResult extends Decision {
  /** Every Rule the number matches, in input order, including ones that lost. */
  matches: number[];
}

export interface FixtureCase {
  name: string;
  /** Defaults to true. */
  blocking?: boolean;
  contactsAllowance?: boolean;
  contacts?: E164[];
  rules: MatchInput['rules'];
  query: E164;
  expect: { blocked: boolean; decidedBy: DecisionSourceExpectation };
}

export interface FixtureFile {
  version: 1;
  description?: string;
  cases: FixtureCase[];
}
