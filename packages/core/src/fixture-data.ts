/**
 * The matching contract, embedded in the app bundle: the same fixture table the
 * Kotlin and Swift tests run, for the on-device Number check and self check.
 */

import fixtures from '../../../fixtures/matching.json';

export const FIXTURES_JSON = JSON.stringify(fixtures);
