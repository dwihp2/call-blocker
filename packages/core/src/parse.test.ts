import { describe, expect, it } from 'vitest';
import { formatNumber, parseBulkText, parseRuleInput } from './parse';
import type { ParseResult } from './parse';

/** The value of a successful Parse result, or a failed assertion. */
function valueOf(result: ParseResult) {
  if (!result.ok) throw new Error(`expected a Rule, got ${result.reason}: ${result.message}`);
  return result.value;
}

describe('parseRuleInput', () => {
  describe('Single number', () => {
    it('reads a local number with the Default region', () => {
      expect(parseRuleInput({ text: '08123456789', pattern: 'single', region: 'ID' })).toEqual({
        ok: true,
        value: {
          pattern: 'single',
          number: '+628123456789',
          display: '+62 812 3456 789',
          approxMatches: 1,
          needsConfirmation: false,
        },
      });
      expect(valueOf(parseRuleInput({ text: '3105551234', pattern: 'single', region: 'US' }))).toMatchObject({
        number: '+13105551234',
      });
      expect(valueOf(parseRuleInput({ text: '07911123456', pattern: 'single', region: 'GB' }))).toMatchObject({
        number: '+447911123456',
      });
    });

    it('strips spaces, dashes and parentheses', () => {
      expect(valueOf(parseRuleInput({ text: '(0812) 3456-789', pattern: 'single', region: 'ID' }))).toMatchObject({
        number: '+628123456789',
      });
      expect(valueOf(parseRuleInput({ text: '+62 812-3456-7890', pattern: 'single', region: 'ID' }))).toMatchObject({
        number: '+6281234567890',
      });
    });

    it('reads a country code typed without the +', () => {
      expect(valueOf(parseRuleInput({ text: '6281234567890', pattern: 'single', region: 'ID' }))).toMatchObject({
        number: '+6281234567890',
        display: '+62 812 3456 7890',
      });
    });

    it('lets a typed country code bypass the Default region', () => {
      expect(valueOf(parseRuleInput({ text: '+62 812 3456 7890', pattern: 'single', region: 'US' }))).toMatchObject({
        number: '+6281234567890',
      });
      expect(valueOf(parseRuleInput({ text: '+1 310 555 1234', pattern: 'single', region: 'ID' }))).toMatchObject({
        number: '+13105551234',
      });
    });

    it('says which region a number is not a phone number in', () => {
      expect(parseRuleInput({ text: '0812', pattern: 'single', region: 'US' })).toEqual({
        ok: false,
        reason: 'not-a-phone-number',
        message: '0812 is not a phone number in United States.',
      });
    });

    it('fails unparseable when libphonenumber can make nothing of the text', () => {
      expect(parseRuleInput({ text: 'hello', pattern: 'single', region: 'US' })).toMatchObject({
        ok: false,
        reason: 'unparseable',
      });
      expect(parseRuleInput({ text: '+9991234567', pattern: 'single', region: 'ID' })).toMatchObject({
        ok: false,
        reason: 'unparseable',
      });
    });

    it('fails empty on an empty field', () => {
      expect(parseRuleInput({ text: '   ', pattern: 'single', region: 'ID' })).toEqual({
        ok: false,
        reason: 'empty',
        message: 'Enter a number.',
      });
    });

    it('normalizes the Default region', () => {
      expect(valueOf(parseRuleInput({ text: '08123456789', pattern: 'single', region: 'id' }))).toMatchObject({
        number: '+628123456789',
      });
    });
  });

  describe('Prefix', () => {
    it('takes a trailing * or plain digits and stores + and digits', () => {
      expect(valueOf(parseRuleInput({ text: '08123*', pattern: 'prefix', region: 'ID' }))).toMatchObject({
        pattern: 'prefix',
        number: '+628123',
        display: '+62 812 3*',
      });
      expect(valueOf(parseRuleInput({ text: '08123', pattern: 'prefix', region: 'ID' }))).toMatchObject({
        number: '+628123',
      });
      expect(valueOf(parseRuleInput({ text: '+62 812 34*', pattern: 'prefix', region: 'ID' }))).toMatchObject({
        number: '+6281234',
        display: '+62 812 34*',
      });
      expect(valueOf(parseRuleInput({ text: '08123456*', pattern: 'prefix', region: 'ID' }))).toMatchObject({
        number: '+628123456',
        display: '+62 812 3456*',
      });
    });

    it('reads a country code typed without the +', () => {
      expect(valueOf(parseRuleInput({ text: '6281234*', pattern: 'prefix', region: 'ID' }))).toMatchObject({
        number: '+6281234',
      });
    });

    it('accepts a Prefix of any length, asking for confirmation when short', () => {
      // The country code plus four digits needs no second look.
      expect(valueOf(parseRuleInput({ text: '+628123*', pattern: 'prefix', region: 'ID' }))).toEqual({
        pattern: 'prefix',
        number: '+628123',
        display: '+62 812 3*',
        approxMatches: 10 ** 4 + 10 ** 5 + 10 ** 6 + 10 ** 7,
        needsConfirmation: false,
      });
      // 0812 is the usual short form of Indonesia's mobile Prefix, and it is
      // taken, with a stronger confirmation.
      expect(valueOf(parseRuleInput({ text: '+62812*', pattern: 'prefix', region: 'ID' }))).toEqual({
        pattern: 'prefix',
        number: '+62812',
        display: '+62 812*',
        approxMatches: 10 ** 5 + 10 ** 6 + 10 ** 7 + 10 ** 8,
        needsConfirmation: true,
      });
      expect(valueOf(parseRuleInput({ text: '6281*', pattern: 'prefix', region: 'ID' }))).toEqual({
        pattern: 'prefix',
        number: '+6281',
        display: '+62 81*',
        approxMatches: 10 ** 6 + 10 ** 7 + 10 ** 8 + 10 ** 9,
        needsConfirmation: true,
      });
    });

    it('rejects text that is not a number', () => {
      expect(parseRuleInput({ text: 'abc0812*', pattern: 'prefix', region: 'ID' })).toMatchObject({
        ok: false,
        reason: 'unparseable',
      });
    });

    it('estimates the matches from the lengths the country dials', () => {
      // The United States allows ten national digits, so a six-digit Prefix
      // after the country code leaves four free.
      expect(valueOf(parseRuleInput({ text: '310555*', pattern: 'prefix', region: 'US' }))).toMatchObject({
        approxMatches: 10 ** 4,
      });
      // Indonesia dials 10–13 digits with the country code, so a four-digit
      // Prefix leaves 4, 5, 6 and 7 free digits across them.
      const five = valueOf(parseRuleInput({ text: '08123*', pattern: 'prefix', region: 'ID' }));
      const six = valueOf(parseRuleInput({ text: '081234*', pattern: 'prefix', region: 'ID' }));
      expect(five.approxMatches).toBe(10 ** 4 + 10 ** 5 + 10 ** 6 + 10 ** 7);
      // One more digit of Prefix covers a tenth as many numbers.
      expect(six.approxMatches).toBe(five.approxMatches / 10);
    });
  });

  describe('Interval', () => {
    it('reads two ends split by - or –', () => {
      const expected = {
        pattern: 'interval',
        number: '+62812345678',
        end: '+62812345680',
        display: '+62 812 345 678–+62 812 345 680',
        approxMatches: 3,
        needsConfirmation: false,
      };
      expect(parseRuleInput({ text: '0812345678-0812345680', pattern: 'interval', region: 'ID' })).toEqual({
        ok: true,
        value: expected,
      });
      expect(parseRuleInput({ text: '0812345678 – 0812345680', pattern: 'interval', region: 'ID' })).toEqual({
        ok: true,
        value: expected,
      });
    });

    it('reads ends with a typed country code', () => {
      expect(valueOf(parseRuleInput({ text: '62812345678–62812345680', pattern: 'interval', region: 'ID' }))).toMatchObject({
        number: '+62812345678',
        end: '+62812345680',
      });
    });

    it('refuses ends of different lengths', () => {
      expect(parseRuleInput({ text: '62812345678-6281234569', pattern: 'interval', region: 'ID' })).toMatchObject({
        ok: false,
        reason: 'interval-mismatch',
      });
    });

    it('refuses ends in different countries', () => {
      expect(
        parseRuleInput({ text: '+13105551234-+14165551234', pattern: 'interval', region: 'US' }),
      ).toMatchObject({ ok: false, reason: 'interval-mismatch' });
    });

    it('refuses a start above its end', () => {
      expect(parseRuleInput({ text: '+62812345680-+62812345678', pattern: 'interval', region: 'ID' })).toMatchObject({
        ok: false,
        reason: 'interval-order',
      });
    });

    it('refuses anything else', () => {
      expect(parseRuleInput({ text: '0812345678', pattern: 'interval', region: 'ID' })).toMatchObject({
        ok: false,
        reason: 'bad-interval',
      });
      expect(parseRuleInput({ text: '0812345678-0812', pattern: 'interval', region: 'ID' })).toMatchObject({
        ok: false,
        reason: 'bad-interval',
      });
    });
  });
});

describe('formatNumber', () => {
  it('formats a Canonical number for the person', () => {
    expect(formatNumber('+6281234567890', 'ID')).toBe('+62 812 3456 7890');
    expect(formatNumber('+13105551234', 'US')).toBe('+1 310 555 1234');
  });
});

describe('parseBulkText', () => {
  const text = [
    '# a comment',
    '',
    '08123456789',
    '08123*',
    '0812345678-0812345680',
    'nonsense',
    ' 08123456789, spam, calls',
    '   ',
  ].join('\n');

  it('imports one Rule per line and ignores comments and blank lines', () => {
    const { lines } = parseBulkText({ text, region: 'ID' });
    expect(lines.map((entry) => entry.line)).toEqual([3, 4, 5, 6, 7]);
    expect(lines.map((entry) => entry.raw)).toEqual([
      '08123456789',
      '08123*',
      '0812345678-0812345680',
      'nonsense',
      ' 08123456789, spam, calls',
    ]);
  });

  it('reads each line on its own', () => {
    const { lines } = parseBulkText({ text, region: 'ID' });
    expect(lines[0]?.result).toEqual({
      ok: true,
      value: {
        pattern: 'single',
        number: '+628123456789',
        display: '+62 812 3456 789',
        approxMatches: 1,
        needsConfirmation: false,
      },
    });
    expect(lines[1]?.result).toMatchObject({ ok: true, value: { pattern: 'prefix', number: '+628123' } });
    expect(lines[2]?.result).toMatchObject({
      ok: true,
      value: { pattern: 'interval', number: '+62812345678', end: '+62812345680' },
    });
    expect(lines[3]?.result).toMatchObject({ ok: false, reason: 'unparseable' });
  });

  it('keeps the whole Label, commas and all, out of the number', () => {
    const { lines } = parseBulkText({ text, region: 'ID' });
    expect(lines[4]?.raw).toBe(' 08123456789, spam, calls');
    expect(lines[4]?.result).toEqual({
      ok: true,
      value: {
        pattern: 'single',
        number: '+628123456789',
        display: '+62 812 3456 789',
        approxMatches: 1,
        needsConfirmation: false,
      },
    });
  });

  it('returns nothing for text with no lines in it', () => {
    expect(parseBulkText({ text: '\n\n# nothing here\n', region: 'ID' })).toEqual({ lines: [] });
  });

  it('reads a formatted whole number as a Single number, not an Interval', () => {
    const { lines } = parseBulkText({ text: '0812-3456-7890', region: 'ID' });
    expect(lines[0]?.result).toEqual({
      ok: true,
      value: {
        pattern: 'single',
        number: '+6281234567890',
        display: '+62 812 3456 7890',
        approxMatches: 1,
        needsConfirmation: false,
      },
    });
  });

  it('keeps bad-interval for a line whose ends cannot be read', () => {
    const { lines } = parseBulkText({ text: '0812345678-0812\nnonsense-nonsense', region: 'ID' });
    expect(lines[0]?.result).toMatchObject({ ok: false, reason: 'bad-interval' });
    expect(lines[1]?.result).toMatchObject({ ok: false, reason: 'bad-interval' });
  });
});
