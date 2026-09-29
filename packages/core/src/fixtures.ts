import type { FixtureCase, FixtureFile } from './types';

/** Where the contract lives, relative to the repository root. */
export const FIXTURES_RELATIVE_PATH = 'fixtures/matching.json';

function fail(message: string): never {
  throw new Error(`Invalid fixture file: ${message}`);
}

function assertCase(value: unknown, index: number): FixtureCase {
  const where = `case ${index}`;
  if (typeof value !== 'object' || value === null) fail(`${where} is not an object`);
  const c = value as Record<string, unknown>;
  if (typeof c.name !== 'string' || c.name.length === 0) fail(`${where} has no name`);
  if (!Array.isArray(c.rules)) fail(`${where} has no rules array`);
  if (typeof c.query !== 'string' || !c.query.startsWith('+')) fail(`${where} has no E.164 query`);
  if (typeof c.expect !== 'object' || c.expect === null) fail(`${where} has no expect`);
  const expect = c.expect as Record<string, unknown>;
  if (typeof expect.blocked !== 'boolean') fail(`${where} expect has no blocked flag`);
  const decidedBy = expect.decidedBy as Record<string, unknown> | undefined;
  if (!decidedBy || typeof decidedBy.type !== 'string') fail(`${where} expect has no decidedBy type`);
  return c as unknown as FixtureCase;
}

/** Validates the shape of the fixture table. The table itself is the contract. */
export function parseFixtureFile(value: unknown): FixtureFile {
  if (typeof value !== 'object' || value === null) fail('not an object');
  const file = value as Record<string, unknown>;
  if (file.version !== 1) fail(`unsupported version ${String(file.version)}`);
  if (!Array.isArray(file.cases)) fail('cases is not an array');
  const cases = file.cases.map(assertCase);
  const names = new Set<string>();
  for (const c of cases) {
    if (names.has(c.name)) fail(`duplicate case name "${c.name}"`);
    names.add(c.name);
  }
  return { version: 1, description: file.description as string | undefined, cases };
}
