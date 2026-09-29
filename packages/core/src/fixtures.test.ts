/**
 * The fixture table is the contract the Kotlin and Swift matchers are held to,
 * so these tests hold the copy in the repository to its own shape. Nothing here
 * matches numbers: matching runs in native code.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURES_JSON } from './fixture-data';
import { parseFixtureFile } from './fixtures';

/** The contract, relative to `packages/core`, where these tests run. */
const FIXTURES_PATH = '../../fixtures/matching.json';

const onDisk: unknown = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));

describe('fixtures/matching.json', () => {
  it('is a version 1 fixture table with cases in it', () => {
    const file = parseFixtureFile(onDisk);
    expect(file.version).toBe(1);
    expect(file.cases.length).toBeGreaterThan(0);
  });

  it('gives every case its own name', () => {
    const names = parseFixtureFile(onDisk).cases.map((fixtureCase) => fixtureCase.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('queries Canonical numbers', () => {
    for (const fixtureCase of parseFixtureFile(onDisk).cases) {
      expect(fixtureCase.query).toMatch(/^\+\d+$/u);
    }
  });
});

describe('FIXTURES_JSON', () => {
  it('is the whole fixture table, embedded for the app', () => {
    expect(parseFixtureFile(JSON.parse(FIXTURES_JSON))).toEqual(parseFixtureFile(onDisk));
    expect(JSON.parse(FIXTURES_JSON)).toEqual(onDisk);
  });
});
