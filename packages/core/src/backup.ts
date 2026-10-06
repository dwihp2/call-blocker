/**
 * Backup files: a person's Block rules in JSON, so they can be restored on the
 * same phone or another one. Allow rules are not included — see
 * `docs/adr/0002-backup-file-holds-block-rules-only.md`.
 */

import type { BackupFile, E164, PatternType, Rule, RuleKind } from './types';

/** A Backup file holds Block rules only. */
const BACKUP_RULE_KIND: RuleKind = 'block';

/** The Number patterns a Backup file's rules may name. */
const PATTERN_TYPES: Record<PatternType, true> = { single: true, prefix: true, interval: true };

function isPatternType(value: unknown): value is PatternType {
  return typeof value === 'string' && Object.hasOwn(PATTERN_TYPES, value);
}

/** A Canonical number: E.164, digits and a leading `+`. */
const E164_PATTERN = /^\+\d+$/u;

/** The name a Backup file is saved under, from the day it was written. */
export function backupFileName(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `call-blocker-backup-${year}-${month}-${day}.json`;
}

/**
 * A Backup file's copy of a rule: its Number pattern, its `end` for an
 * Interval, its Label, and `enabled` only when the Rule is off. Field order is
 * fixed here, which is what makes serializing stable.
 */
function backupRule(rule: {
  pattern: PatternType;
  number: E164;
  end?: E164;
  label?: string;
  enabled?: boolean;
}): BackupFile['rules'][number] {
  const copy: BackupFile['rules'][number] = { pattern: rule.pattern, number: rule.number };
  if (rule.pattern === 'interval' && rule.end !== undefined) copy.end = rule.end;
  if (rule.label !== undefined) copy.label = rule.label;
  if (rule.enabled === false) copy.enabled = false;
  return copy;
}

/** Collects the Block rules into a Backup file, Labels kept. */
export function buildBackupFile(rules: Rule[], exportedAt: string): BackupFile {
  return {
    schemaVersion: 1,
    exportedAt,
    rules: rules.filter((rule) => rule.kind === BACKUP_RULE_KIND).map(backupRule),
  };
}

/**
 * Writes a Backup file out with a fixed key order and a trailing newline, so the
 * same rules always produce the same bytes.
 */
export function serializeBackup(file: BackupFile): string {
  const canonical = {
    schemaVersion: 1,
    exportedAt: file.exportedAt,
    rules: file.rules.map(backupRule),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A value as it reads in a one-line message. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Validates one rule of a Backup file. Rules are counted from 1 in messages. */
function readBackupRule(
  value: unknown,
  index: number,
): { rule: BackupFile['rules'][number] } | { message: string } {
  const where = `Rule ${index + 1}`;
  if (!isObject(value)) {
    return { message: `${where} is not a rule.` };
  }
  const pattern = value.pattern;
  if (!isPatternType(pattern)) {
    return { message: `${where} has an unknown pattern: ${describeValue(pattern)}.` };
  }
  const number = value.number;
  if (typeof number !== 'string' || !E164_PATTERN.test(number)) {
    return { message: `${where} has no phone number in + and digits: ${describeValue(number)}.` };
  }
  if (pattern === 'interval') {
    const end = value.end;
    if (typeof end !== 'string' || !E164_PATTERN.test(end)) {
      return { message: `${where} is an Interval with no end in + and digits: ${describeValue(end)}.` };
    }
    return {
      rule: {
        pattern,
        number,
        end,
        ...(typeof value.label === 'string' ? { label: value.label } : {}),
        ...(value.enabled === false ? { enabled: false } : {}),
      },
    };
  }
  return {
    rule: {
      pattern,
      number,
      ...(typeof value.label === 'string' ? { label: value.label } : {}),
      ...(value.enabled === false ? { enabled: false } : {}),
    },
  };
}

/**
 * Reads a Backup file. Anything that is not a Backup file comes back as a
 * one-line message naming the offending Rule, so Restore can show it and carry on.
 */
export function parseBackup(text: string): { ok: true; file: BackupFile } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: 'This is not a call-blocker backup file: it is not valid JSON.' };
  }
  if (!isObject(value)) {
    return { ok: false, message: 'This is not a call-blocker backup file.' };
  }
  if (value.schemaVersion !== 1) {
    return {
      ok: false,
      message: `This backup file has version ${describeValue(value.schemaVersion)}, and only version 1 can be restored.`,
    };
  }
  if (typeof value.exportedAt !== 'string') {
    return { ok: false, message: 'This backup file has no export date.' };
  }
  if (!Array.isArray(value.rules)) {
    return { ok: false, message: 'This backup file has no rules list.' };
  }
  const rules: BackupFile['rules'] = [];
  for (let index = 0; index < value.rules.length; index += 1) {
    const read = readBackupRule(value.rules[index], index);
    if ('message' in read) return { ok: false, message: read.message };
    rules.push(read.rule);
  }
  return { ok: true, file: { schemaVersion: 1, exportedAt: value.exportedAt, rules } };
}

/** Do two Rules cover the same numbers? Same Number pattern and same Canonical values. */
export function isDuplicate(
  a: { pattern: PatternType; number: E164; end?: E164 },
  b: { pattern: PatternType; number: E164; end?: E164 },
): boolean {
  if (a.pattern !== b.pattern || a.number !== b.number) return false;
  return a.pattern === 'interval' ? a.end === b.end : true;
}

/** A Rule made from a Backup file's rule, with the fields the app owns. */
function ruleFromBackup(from: BackupFile['rules'][number], now: string, newId: () => string): Rule {
  const rule: Rule = {
    id: newId(),
    kind: BACKUP_RULE_KIND,
    pattern: from.pattern,
    number: from.number,
    enabled: from.enabled ?? true,
    createdAt: now,
  };
  if (from.pattern === 'interval' && from.end !== undefined) rule.end = from.end;
  if (from.label !== undefined) rule.label = from.label;
  return rule;
}

/**
 * Restore by Merge: appends the file's Block rules the app does not already
 * hold, in file order, and keeps the Rule the app holds on a duplicate.
 */
export function mergeBackup(
  existing: Rule[],
  file: BackupFile,
  now: string,
  newId: () => string,
): { rules: Rule[]; imported: number; duplicates: number } {
  const rules = [...existing];
  let imported = 0;
  let duplicates = 0;
  for (const from of file.rules) {
    if (rules.some((rule) => isDuplicate(rule, from))) {
      duplicates += 1;
      continue;
    }
    rules.push(ruleFromBackup(from, now, newId));
    imported += 1;
  }
  return { rules, imported, duplicates };
}

/** Restore by Replace: the Block list becomes exactly what the file holds. */
export function replaceBackup(
  file: BackupFile,
  now: string,
  newId: () => string,
): { rules: Rule[]; imported: number } {
  const rules = file.rules.map((from) => ruleFromBackup(from, now, newId));
  return { rules, imported: rules.length };
}
