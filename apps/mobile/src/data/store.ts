/**
 * The app's persisted state.
 *
 * One JSON document (`call-blocker/state.json` under the app's document
 * directory) is read once at startup. From then on the state lives in this
 * module and React reads it through `useStore` (`useSyncExternalStore`). Every
 * write goes to a temp file that is then moved over the real one, so a crash
 * can never leave a half-written state file behind.
 *
 * Nothing here is gated: `replaceRules` installs whatever it is handed. The
 * platform engine has to accept a change first (ADR 0004), which is why the
 * only callers of the Rule actions are `src/data/engine.ts` and the
 * intent-level operations in `src/data/actions.ts`. Screens never write here.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { describeError } from '@/format';

import type { PatternType, RegionCode, Rule, RuleInput, RuleKind, Settings } from '@call-blocker/core';

export interface LocalSettings extends Settings {
  /**
   * Set when the first-launch walkthrough has been finished or skipped. Local
   * to the app: the engine only ever sees `Settings`.
   */
  onboarded: boolean;
}

export interface LocalAppState {
  schemaVersion: 1;
  settings: LocalSettings;
  rules: Rule[];
}

export interface StoreSnapshot {
  /** False until the first read of the state file has finished. */
  ready: boolean;
  state: LocalAppState;
  /** Set when the state file could not be read or written; the app keeps working in memory. */
  error: string | null;
}

const STATE_DIRECTORY = 'call-blocker';
const STATE_FILE = 'state.json';

const KINDS: RuleKind[] = ['block', 'allow'];
const PATTERNS: PatternType[] = ['single', 'prefix', 'interval'];

/**
 * The Default region starts as the device's: `Intl.DateTimeFormat` reports the
 * resolved locale, whose first two-letter subtag is the region (`en-GB` → `GB`,
 * `zh-Hans-CN` → `CN`). Anything unexpected falls back to `ID`.
 */
function deviceRegion(): RegionCode {
  try {
    const parts = Intl.DateTimeFormat().resolvedOptions().locale.split(/[-_]/);
    for (let index = 1; index < parts.length; index += 1) {
      if (/^[A-Za-z]{2}$/.test(parts[index])) return parts[index].toUpperCase();
    }
  } catch {
    // A host without Intl keeps the fallback below.
  }
  return 'ID';
}

function emptyState(): LocalAppState {
  return {
    schemaVersion: 1,
    settings: {
      defaultRegion: deviceRegion(),
      contactsAllowance: false,
      blocking: true,
      onboarded: false,
    },
    rules: [],
  };
}

let idCounter = 0;

/**
 * Rule ids are the millisecond clock in base 36 plus a counter. No crypto
 * dependency is allowed here, and a restart costs far more than a millisecond,
 * so a new session cannot repeat an id from a previous one.
 */
export function newRuleId(now: number = Date.now()): string {
  idCounter += 1;
  return `rule-${now.toString(36)}-${idCounter.toString(36)}`;
}

/** A Rule built from `input`, with a fresh id and creation time. */
export function createRule(input: RuleInput, now: Date = new Date()): Rule {
  return applyRuleInput({ id: newRuleId(now.getTime()), createdAt: now.toISOString() }, input);
}

/** `input` applied to a Rule, keeping its id and the date it was added. */
export function applyRuleInput(rule: Pick<Rule, 'id' | 'createdAt'>, input: RuleInput): Rule {
  const next: Rule = {
    id: rule.id,
    kind: input.kind,
    pattern: input.pattern,
    number: input.number,
    createdAt: rule.createdAt,
  };
  if (input.end !== undefined) next.end = input.end;
  if (input.label !== undefined && input.label.length > 0) next.label = input.label;
  return next;
}

let snapshot: StoreSnapshot = { ready: false, state: emptyState(), error: null };
const listeners = new Set<() => void>();

function publish(next: StoreSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): StoreSnapshot {
  return snapshot;
}

export function useStore(): StoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getState(): LocalAppState {
  return snapshot.state;
}

function setState(state: LocalAppState): void {
  publish({ ...snapshot, state });
  void persist(state);
}

/** Replaces the whole Block and Allow list. Called once the engine accepted them. */
export function replaceRules(rules: Rule[]): void {
  setState({ ...snapshot.state, rules });
}

export function setSettings(patch: Partial<LocalSettings>): void {
  setState({ ...snapshot.state, settings: { ...snapshot.state.settings, ...patch } });
}

function stateFile(): File {
  return new File(new Directory(Paths.document, STATE_DIRECTORY), STATE_FILE);
}

function serialize(state: LocalAppState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function readSettings(value: unknown): LocalSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const region =
    typeof raw.defaultRegion === 'string' && /^[A-Za-z]{2}$/.test(raw.defaultRegion)
      ? raw.defaultRegion.toUpperCase()
      : deviceRegion();
  return {
    defaultRegion: region,
    contactsAllowance: raw.contactsAllowance === true,
    blocking: raw.blocking !== false,
    onboarded: raw.onboarded === true,
  };
}

function readRules(value: unknown): { rules: Rule[]; dropped: number } {
  if (!Array.isArray(value)) return { rules: [], dropped: 0 };
  const rules: Rule[] = [];
  let dropped = 0;
  for (const entry of value) {
    const rule = readRule(entry);
    if (rule) rules.push(rule);
    else dropped += 1;
  }
  return { rules, dropped };
}

function readRule(value: unknown): Rule | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const { id, kind, pattern, number, end, label, createdAt } = raw;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof number !== 'string' || number.length === 0) return null;
  if (typeof createdAt !== 'string') return null;
  if (typeof kind !== 'string' || !KINDS.includes(kind as RuleKind)) return null;
  if (typeof pattern !== 'string' || !PATTERNS.includes(pattern as PatternType)) return null;
  if (pattern === 'interval' && typeof end !== 'string') return null;
  const rule: Rule = {
    id,
    kind: kind as RuleKind,
    pattern: pattern as PatternType,
    number,
    createdAt,
  };
  if (typeof end === 'string') rule.end = end;
  if (typeof label === 'string' && label.length > 0) rule.label = label;
  return rule;
}

function parseState(text: string): { state: LocalAppState; warning: string | null } {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) {
    return { state: emptyState(), warning: 'The saved file could not be read, so the app started empty.' };
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    return {
      state: emptyState(),
      warning: `The saved file is version ${String(record.schemaVersion)} of the format, which this version of the app cannot read, so it started empty.`,
    };
  }
  const { rules, dropped } = readRules(record.rules);
  return {
    state: { schemaVersion: 1, settings: readSettings(record.settings), rules },
    warning: dropped === 0 ? null : `${dropped} saved ${dropped === 1 ? 'Rule was' : 'Rules were'} unreadable and left out.`,
  };
}

async function load(): Promise<void> {
  let state = emptyState();
  let error: string | null = null;
  try {
    // expo-file-system has no web implementation, so the app runs in memory there.
    const file = Platform.OS === 'web' ? null : stateFile();
    if (file?.exists) {
      const parsed = parseState(await file.text());
      state = parsed.state;
      error = parsed.warning;
    }
  } catch (reason) {
    error = `The saved state could not be read (${describeError(reason)}), so the app started empty.`;
  }
  publish({ ready: true, state, error });
}

async function persist(state: LocalAppState): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const directory = new Directory(Paths.document, STATE_DIRECTORY);
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const temporary = new File(directory, `${STATE_FILE}.tmp`);
    temporary.write(serialize(state));
    // A move is atomic on both platforms: either the old file or the new one is there.
    await temporary.move(new File(directory, STATE_FILE), { overwrite: true });
    if (snapshot.error !== null) publish({ ...snapshot, error: null });
  } catch (reason) {
    publish({ ...snapshot, error: `The state could not be saved (${describeError(reason)}).` });
  }
}

let inFlight: Promise<void> | null = null;

/** Reads the state file again, unless a read is already running. */
export function reload(): Promise<void> {
  inFlight ??= load().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

void reload();
