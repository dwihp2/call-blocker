/**
 * Overlap and Shadowed Rule warnings.
 *
 * This is a *warning* helper and nothing else: it decides no call (ADR 0003
 * keeps every blocking decision in the platform engines) and no Rule is refused
 * because of it.
 *
 * A Number pattern is compared as the set of numbers it can match, over the
 * 15 digit E.164 space:
 *
 *   Single number `S`  →  [S, S]
 *   Interval `A–B`     →  [A, B]
 *   Prefix `P`         →  one interval per length it can take, because a prefix
 *                         matches the numbers that *begin* with its digits:
 *                         for `L` from the prefix's length to 15,
 *                         `[P·10^(L-|P|), P·10^(L-|P|) + 10^(L-|P|) - 1]`.
 *                         (A single interval would be wrong: `628123456789`
 *                         is numerically inside `[62899, 628999999999999]` but
 *                         does not begin with `62899`.)
 *
 * A Rule is Shadowed when the Rules that win over it already cover every number
 * it matches. Allow rules win over Block rules wherever they meet (ADR 0001),
 * and among Rules of one kind the first matching Rule is the one a decision is
 * reported from, so a later Rule of the same kind is covered by the earlier ones.
 */

import type { Rule } from '@call-blocker/core';

/** E.164 numbers top out at 15 digits, which is also the widest a Prefix reaches. */
const MAX_DIGITS = 15;

interface Range {
  lo: number;
  hi: number;
}

type Shape = Pick<Rule, 'pattern' | 'number' | 'end'>;

function toDigits(e164: string): number | null {
  const digits = e164.startsWith('+') ? e164.slice(1) : e164;
  if (digits.length === 0 || digits.length > MAX_DIGITS || !/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

function rangesOf(shape: Shape): Range[] {
  const start = toDigits(shape.number);
  if (start === null) return [];
  if (shape.pattern === 'single') return [{ lo: start, hi: start }];
  if (shape.pattern === 'interval') {
    const end = shape.end === undefined ? null : toDigits(shape.end);
    if (end === null) return [];
    return [{ lo: Math.min(start, end), hi: Math.max(start, end) }];
  }
  const prefixLength = shape.number.startsWith('+') ? shape.number.length - 1 : shape.number.length;
  const ranges: Range[] = [];
  for (let length = prefixLength; length <= MAX_DIGITS; length += 1) {
    const room = length - prefixLength;
    const lo = start * 10 ** room;
    ranges.push({ lo, hi: lo + 10 ** room - 1 });
  }
  return ranges;
}

/** The parts of `ranges` that fall inside `target`, merged and sorted. */
function coveredParts(ranges: readonly Range[], target: Range): Range[] {
  const parts = ranges
    .filter((range) => range.hi >= target.lo && range.lo <= target.hi)
    .map((range) => ({ lo: Math.max(range.lo, target.lo), hi: Math.min(range.hi, target.hi) }))
    .sort((a, b) => a.lo - b.lo);
  const merged: Range[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && part.lo <= last.hi + 1) last.hi = Math.max(last.hi, part.hi);
    else merged.push({ ...part });
  }
  return merged;
}

function covers(target: readonly Range[], covering: readonly Range[]): boolean {
  return target.every((range) => coveredParts(covering, range).some((part) => part.lo <= range.lo && part.hi >= range.hi));
}

function intersects(a: readonly Range[], b: readonly Range[]): boolean {
  return a.some((left) => b.some((right) => left.hi >= right.lo && left.lo <= right.hi));
}

/** The Rules that win over `rules[index]`. */
function winnersOver(rules: readonly Rule[], index: number): Rule[] {
  const rule = rules[index];
  return rules.filter((other, otherIndex) => {
    if (otherIndex === index) return false;
    if (rule.kind === 'block') return other.kind === 'allow' || otherIndex < index;
    return other.kind === 'allow' && otherIndex < index;
  });
}

/** True when `rules[index]` can never be the Rule a decision comes from. */
export function isShadowed(rules: readonly Rule[], index: number): boolean {
  const target = rangesOf(rules[index]);
  if (target.length === 0) return false;
  return covers(target, winnersOver(rules, index).flatMap(rangesOf));
}

/** The ids of every Rule in `rules` that can never be the deciding Rule. */
export function shadowedIds(rules: readonly Rule[]): Set<string> {
  const shadowed = new Set<string>();
  rules.forEach((rule, index) => {
    if (isShadowed(rules, index)) shadowed.add(rule.id);
  });
  return shadowed;
}

export interface RegistrationWarnings {
  /** Existing Rules of the opposite kind that match numbers the candidate matches. */
  overlaps: Rule[];
  /**
   * Rules that this change would leave unable to decide anything: usually the
   * candidate itself (a Rule that wins over it already covers it whole) or an
   * existing Rule that a wider opposite-kind Rule now covers.
   */
  shadowed: Rule[];
}

/** What registering or editing `candidate` would do to the Rules already there. */
export function registrationWarnings(existing: readonly Rule[], candidate: Rule): RegistrationWarnings {
  const unchanged = existing.filter((rule) => rule.id !== candidate.id);
  const next = [...unchanged, candidate];
  const wasShadowed = new Set(unchanged.filter((_, index) => isShadowed(unchanged, index)).map((rule) => rule.id));
  const candidateRanges = rangesOf(candidate);
  return {
    overlaps: unchanged.filter(
      (rule) => rule.kind !== candidate.kind && intersects(rangesOf(rule), candidateRanges),
    ),
    shadowed: next.filter((rule, index) => isShadowed(next, index) && !wasShadowed.has(rule.id)),
  };
}
