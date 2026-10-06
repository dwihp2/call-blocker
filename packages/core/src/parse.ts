/**
 * Registration: turning what a person types into a Rule's Number pattern.
 *
 * Every Number pattern this module returns carries a Canonical number, so the
 * app, the native engines and Backup files all agree on what a number is.
 * Numbers typed in local format use the Default region; a number typed with a
 * country code (`+62…`) ignores it.
 */

import {
  AsYouType,
  Metadata,
  formatIncompletePhoneNumber,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';
import type { CountryCode, PhoneNumber } from 'libphonenumber-js';
import type { E164, PatternType, RegionCode } from './types';

export type ParseFailureReason =
  | 'empty'
  | 'unparseable'
  | 'not-a-phone-number'
  | 'bad-interval'
  | 'interval-order'
  | 'interval-mismatch';

export interface ParsedRule {
  pattern: PatternType;
  /** Canonical number: a Single number, the Prefix's digits, or an Interval's start. */
  number: E164;
  /** Interval only: the Canonical number of the end. */
  end?: E164;
  /** Formatted for the person, e.g. `+62 812 3456 7890` or `+62 812 3456*`. */
  display: string;
  /** How many numbers this Number pattern covers, at most. */
  approxMatches: number;
  /**
   * Does Registration ask again before saving this Rule? A Prefix shorter than
   * the country code plus four digits covers so many numbers that the person
   * should confirm it. Always false for a Single number or an Interval.
   */
  needsConfirmation: boolean;
}

export type ParseResult =
  | { ok: true; value: ParsedRule }
  | { ok: false; reason: ParseFailureReason; message: string };

/**
 * A Prefix with fewer digits than the country code plus this many asks for a
 * stronger confirmation before it is saved: it covers a very wide span.
 */
const PREFIX_DIGITS_AFTER_COUNTRY_CODE = 4;

/** E.164 allows fifteen digits all told: country code and national number together. */
const E164_DIGITS = 15;

/** The separator that splits an Interval's two ends. */
const EN_DASH = '\u2013';

/**
 * Characters libphonenumber treats as formatting, plus a leading `+`. A Prefix
 * is never a whole phone number, so the library cannot vet it for us.
 */
const PREFIX_TEXT = /^\+?[\d\s().\-\u00A0]*$/u;

/** The libphonenumber metadata, reused across calls. */
let metadata: Metadata | undefined;

/** The country's name for a message, e.g. `US` becomes `United States`. */
let regionNames: Intl.DisplayNames | undefined;

function regionName(region: RegionCode): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(region) ?? region;
  } catch {
    return region;
  }
}

function toCountryCode(region: RegionCode): CountryCode {
  return region as CountryCode;
}

/** Parses a whole phone number, or nothing when the library cannot read it. */
function tryParseNumber(text: string, region: RegionCode): PhoneNumber | undefined {
  if (!text.trim().length) return undefined;
  try {
    return parsePhoneNumberFromString(text, toCountryCode(region));
  } catch {
    return undefined;
  }
}

/**
 * A number typed without the `+` but beginning with the Default region's
 * country code, e.g. `62812…` in Indonesia, is the same number as `+62812…`.
 * Everything else keeps the Default region's meaning.
 */
function withCountryCode(text: string, region: RegionCode): string {
  if (text.startsWith('+') || !isSupportedCountry(region)) return text;
  const digits = text.replace(/[^\d]/gu, '');
  return digits.startsWith(getCountryCallingCode(region)) ? `+${digits}` : text;
}

/**
 * The national lengths numbers are actually dialled at, for countries where
 * libphonenumber's possible lengths are looser than reality: its list includes
 * short codes and ranges no call ever presents, and every extra length
 * multiplies what a Prefix costs. National digits only; the country code is
 * added where the lengths are used.
 *
 * Indonesia, probed 2026-10-06 against libphonenumber validity: fixed lines run
 * 8–10 national digits (Jakarta `21 1234567` …) and mobile 9–11 (`812 3456 78`
 * is too short to be valid, `851 1737 3483` is 11) — 10–13 digits with the
 * country code. The metadata's 7–17 would make a 10-digit Prefix claim 111,111
 * entries instead of the 1,110 it really covers.
 *
 * A country without an entry keeps its metadata lengths.
 */
const DIALED_NATIONAL_LENGTHS: Partial<Record<RegionCode, number[]>> = {
  ID: [8, 9, 10, 11],
};

/**
 * The national lengths a region's numbers are dialled at: the override when one
 * exists, otherwise libphonenumber's possible lengths. Ascending, capped at
 * what E.164 leaves once the country code is out. Undefined when nothing is
 * known about the region.
 */
function dialedNationalLengths(region: RegionCode): number[] | undefined {
  if (!isSupportedCountry(region)) return undefined;
  metadata ??= new Metadata();
  metadata.selectNumberingPlan(region);
  const lengths = DIALED_NATIONAL_LENGTHS[region] ?? metadata.numberingPlan?.possibleLengths();
  if (!lengths || lengths.length === 0) return undefined;
  const cap = E164_DIGITS - getCountryCallingCode(region).length;
  return lengths.filter((national) => national <= cap).sort((left, right) => left - right);
}

/**
 * The longest national number the region allows: its numbering plan's maximum
 * from libphonenumber metadata, capped at what E.164 leaves once the country
 * code is taken out of its 15 digits (Indonesia's plan lists lengths up to 17,
 * which no number could be). Undefined when the region is unknown.
 */
function maxNationalNumberLength(region: RegionCode): number | undefined {
  if (!isSupportedCountry(region)) return undefined;
  metadata ??= new Metadata();
  metadata.selectNumberingPlan(region);
  const lengths = metadata.numberingPlan?.possibleLengths();
  if (!lengths || lengths.length === 0) return undefined;
  return Math.min(Math.max(...lengths), E164_DIGITS - getCountryCallingCode(region).length);
}

/**
 * The lengths a Canonical number in this number's country can have, ascending
 * and country code included, capped at E.164's fifteen digits. The native
 * engines expand a Prefix across these, so an iPhone blocks the numbers the
 * country can actually dial rather than every length E.164 allows. Empty when
 * the country is unknown to the metadata.
 */
export function nationalLengthsFor(number: E164): number[] {
  const country = parsePhoneNumberFromString(number)?.country;
  if (!country) return [];
  const lengths = dialedNationalLengths(country);
  if (!lengths) return [];
  const countryCodeDigits = getCountryCallingCode(country).length;
  return lengths.map((national) => national + countryCodeDigits);
}

/**
 * How many numbers a Prefix covers: every dialled length with room for the
 * typed digits, summed — the same count the native engines expand to, so the
 * Registration preview and the Capacity refusal always agree.
 */
function approximatePrefixMatches(
  country: RegionCode,
  region: RegionCode,
  digitsAfterCountryCode: number,
): number {
  const national = dialedNationalLengths(country) ?? dialedNationalLengths(region);
  if (national) {
    let total = 0;
    for (const length of national) {
      if (length >= digitsAfterCountryCode) total += 10 ** (length - digitsAfterCountryCode);
    }
    return Math.max(1, total);
  }
  const nationalNumberLength =
    maxNationalNumberLength(country) ??
    maxNationalNumberLength(region) ??
    digitsAfterCountryCode;
  return Math.max(1, 10 ** (nationalNumberLength - digitsAfterCountryCode));
}

function succeeded(value: ParsedRule): ParseResult {
  return { ok: true, value };
}

function failed(reason: ParseFailureReason, message: string): ParseResult {
  return { ok: false, reason, message };
}

/**
 * Formats a Canonical number for the person. Handles whole numbers and the
 * partial digits of a Prefix alike, so Registration can show either.
 */
export function formatNumber(number: E164, region: RegionCode): string {
  return formatIncompletePhoneNumber(number, toCountryCode(region.trim().toUpperCase()));
}

/** A Single number: the Default region applies unless a country code is typed. */
function parseSingleNumber(text: string, region: RegionCode): ParseResult {
  const number = tryParseNumber(withCountryCode(text, region), region);
  if (!number) {
    return failed('unparseable', `${text} cannot be read as a phone number in ${regionName(region)}.`);
  }
  if (!number.isValid()) {
    return failed('not-a-phone-number', `${text} is not a phone number in ${regionName(region)}.`);
  }
  const canonical = number.number;
  return succeeded({
    pattern: 'single',
    number: canonical,
    display: formatNumber(canonical, region),
    approxMatches: 1,
    needsConfirmation: false,
  });
}

/**
 * A Prefix: a trailing `*` or plain digits, with formatting stripped. Any
 * length from one digit after the country code up is accepted; a short one is
 * marked for confirmation rather than refused. The stored number is the country
 * code and the digits after it, without the `*`.
 */
function parsePrefix(text: string, region: RegionCode): ParseResult {
  const stripped = text.replace(/\*+$/u, '').trim();
  if (stripped.length === 0) {
    return failed('empty', 'Enter a number or Prefix.');
  }
  if (!PREFIX_TEXT.test(stripped)) {
    return failed('unparseable', `${text} cannot be read as a number in ${regionName(region)}.`);
  }
  const typed = withCountryCode(stripped, region);
  const international = typed.startsWith('+');
  if (!international && !isSupportedCountry(region)) {
    return failed('unparseable', `${text} cannot be read as a phone number in ${regionName(region)}.`);
  }
  // AsYouType strips the national prefix the same way Registration does for a
  // Single number, but without demanding a whole valid number of the input.
  const asYouType = new AsYouType(international ? undefined : toCountryCode(region));
  asYouType.input(typed);
  const number = asYouType.getNumber();
  if (!number) {
    return failed('unparseable', `${text} cannot be read as a phone number in ${regionName(region)}.`);
  }
  const digitsAfterCountryCode = number.nationalNumber;
  if (digitsAfterCountryCode.length === 0) {
    return failed('unparseable', `${text} cannot be read as a phone number in ${regionName(region)}.`);
  }
  const canonical = `+${number.countryCallingCode}${digitsAfterCountryCode}`;
  const country = number.country ?? region;
  return succeeded({
    pattern: 'prefix',
    number: canonical,
    display: `${formatNumber(canonical, region)}*`,
    approxMatches: approximatePrefixMatches(country, region, digitsAfterCountryCode.length),
    needsConfirmation: digitsAfterCountryCode.length < PREFIX_DIGITS_AFTER_COUNTRY_CODE,
  });
}

/**
 * Where the separator between an Interval's two ends sits, or -1. An en dash is
 * never number formatting; a hyphen is formatting when it glues digits together,
 * so a whitespace-flanked hyphen wins over the last one.
 */
function intervalSeparatorIndex(text: string): number {
  const enDash = text.lastIndexOf(EN_DASH);
  if (enDash !== -1) return enDash;
  let lastSpaced = -1;
  let last = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '-') continue;
    last = index;
    const spacedOut = /\s/u.test(text[index - 1] ?? '') || /\s/u.test(text[index + 1] ?? '');
    if (spacedOut) lastSpaced = index;
  }
  return lastSpaced !== -1 ? lastSpaced : last;
}

/**
 * An Interval: two ends split by `-` or `–`, both in the same country, of the
 * same length, start at or below end.
 */
function parseInterval(text: string, region: RegionCode): ParseResult {
  const separator = intervalSeparatorIndex(text);
  if (separator === -1) {
    return failed('bad-interval', `An Interval needs a start and an end split by - or ${EN_DASH}: ${text}.`);
  }
  const startText = text.slice(0, separator).trim();
  const endText = text.slice(separator + 1).trim();
  const start = tryParseNumber(withCountryCode(startText, region), region);
  const end = tryParseNumber(withCountryCode(endText, region), region);
  if (!start || !start.isValid()) {
    return failed('bad-interval', `${startText} is not a phone number in ${regionName(region)}.`);
  }
  if (!end || !end.isValid()) {
    return failed('bad-interval', `${endText} is not a phone number in ${regionName(region)}.`);
  }
  if (start.country !== end.country) {
    const startCountry = start.country ?? regionName(region);
    const endCountry = end.country ?? regionName(region);
    return failed(
      'interval-mismatch',
      `Both ends of an Interval must be in the same country: ${startCountry} and ${endCountry}.`,
    );
  }
  if (start.nationalNumber.length !== end.nationalNumber.length) {
    return failed(
      'interval-mismatch',
      `Both ends of an Interval must have the same number of digits: ${startText} has ${start.nationalNumber.length}, ${endText} has ${end.nationalNumber.length}.`,
    );
  }
  const startValue = BigInt(start.nationalNumber);
  const endValue = BigInt(end.nationalNumber);
  if (startValue > endValue) {
    return failed('interval-order', `An Interval must start at or below its end: ${startText} is above ${endText}.`);
  }
  return succeeded({
    pattern: 'interval',
    number: start.number,
    end: end.number,
    display: `${formatNumber(start.number, region)}${EN_DASH}${formatNumber(end.number, region)}`,
    // Inclusive: the numbers between the two ends, both of them counted.
    approxMatches: Number(endValue - startValue + 1n),
    needsConfirmation: false,
  });
}

/** Turns one typed Number pattern into a Rule's number fields. */
export function parseRuleInput(input: {
  text: string;
  pattern: PatternType;
  region: RegionCode;
}): ParseResult {
  const region = input.region.trim().toUpperCase();
  const text = input.text.trim();
  if (text.length === 0) {
    return failed('empty', 'Enter a number.');
  }
  switch (input.pattern) {
    case 'single':
      return parseSingleNumber(text, region);
    case 'prefix':
      return parsePrefix(text, region);
    case 'interval':
      return parseInterval(text, region);
    default:
      return failed('unparseable', `${String(input.pattern)} is not a Number pattern.`);
  }
}

/**
 * Reads one Bulk import line. A trailing `*` makes it a Prefix. A line that is
 * a whole phone number is a Single number, hyphens and all, since copied
 * numbers are usually formatted. Only a line that is not a number of its own is
 * read as an Interval, whose ends must then be readable too.
 */
function parseBulkLine(text: string, region: RegionCode): ParseResult {
  if (/\*$/u.test(text)) return parseRuleInput({ text, pattern: 'prefix', region });
  if (!text.includes('-') && !text.includes(EN_DASH)) {
    return parseRuleInput({ text, pattern: 'single', region });
  }
  const whole = parseRuleInput({ text, pattern: 'single', region });
  return whole.ok ? whole : parseRuleInput({ text, pattern: 'interval', region });
}

/**
 * Bulk import: one Rule per line, as `number`, `prefix*` (a trailing `*` makes
 * it a Prefix) or `start-end` (an Interval), with an optional `, label` at the
 * end. Blank lines and lines starting with `#` are ignored. Each line's result
 * stands on its own, so one bad line never spoils the rest.
 */
export function parseBulkText(input: { text: string; region: RegionCode }): {
  lines: Array<{ line: number; raw: string; result: ParseResult }>;
} {
  const lines: Array<{ line: number; raw: string; result: ParseResult }> = [];
  const rawLines = input.text.split(/\r?\n/u);
  rawLines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) return;
    // The Label starts at the first comma, so it may hold commas of its own.
    const comma = trimmed.indexOf(',');
    const text = comma === -1 ? trimmed : trimmed.slice(0, comma).trim();
    lines.push({
      line: index + 1,
      raw,
      result: parseBulkLine(text, input.region),
    });
  });
  return { lines };
}
