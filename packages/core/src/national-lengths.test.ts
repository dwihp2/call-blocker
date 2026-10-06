import { describe, expect, it } from 'vitest';

import { nationalLengthsFor } from './parse';

describe('nationalLengthsFor', () => {
  it('lists the total lengths a country dials, country code included', () => {
    // Indonesia's plan lists national lengths up to 17, but the numbers that
    // can really call are 10–13 digits with the country code: fixed lines run
    // 8–10 national digits and mobile 9–11. The override keeps the raw 7–17
    // metadata lengths from inflating what a Prefix costs.
    expect(nationalLengthsFor('+62812345678')).toEqual([10, 11, 12, 13]);
  });

  it('answers for a country with a single length', () => {
    expect(nationalLengthsFor('+14155552671')).toEqual([11]);
  });

  it('is empty when the country is unknown to the metadata', () => {
    expect(nationalLengthsFor('+999000000000')).toEqual([]);
  });
});
