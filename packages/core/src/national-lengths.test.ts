import { describe, expect, it } from 'vitest';

import { nationalLengthsFor } from './parse';

describe('nationalLengthsFor', () => {
  it('lists the total lengths a country dials, country code included and capped by E.164', () => {
    // Indonesia's plan lists national lengths up to 17; E.164 leaves 13 once the
    // two-digit country code is out, so 14 and above can never be dialled.
    expect(nationalLengthsFor('+62812345678')).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });

  it('answers for a country with a single length', () => {
    expect(nationalLengthsFor('+14155552671')).toEqual([11]);
  });

  it('is empty when the country is unknown to the metadata', () => {
    expect(nationalLengthsFor('+999000000000')).toEqual([]);
  });
});
