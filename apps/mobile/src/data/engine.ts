/**
 * The single place that talks to the native blocking engines.
 *
 * iOS compiles the Rules into the Call Directory extension, Android hands them
 * to the call screening service, and neither exists on the web — where
 * `engineForPlatform()` returns null and the app stays usable, saying that this
 * device cannot block calls.
 *
 * Everything here hands the engines canonical input only (ADR 0003): Rules are
 * already canonical, and contacts are parsed to E.164 before they leave.
 */

import { FIXTURES_JSON, nationalLengthsFor } from '@call-blocker/core';
import type {
  AndroidEngine,
  BlockingEngine,
  E164,
  EngineStatus,
  IosEngine,
  MatchInput,
  MatchResult,
  Rule,
  SyncResult,
} from '@call-blocker/core';
import { callDirectory } from 'call-directory';
import { callScreening } from 'call-screening';
import { Platform } from 'react-native';

import { formatCount, describeError } from '@/format';

import { getState, replaceRules, setSettings, type LocalAppState, type LocalSettings } from './store';

/** Shown wherever the platform cannot block calls at all. */
export const UNSUPPORTED_DETAIL = 'This device cannot block calls.';

export class EngineUnavailableError extends Error {
  constructor() {
    super(`${UNSUPPORTED_DETAIL} A Number check can only run where the rules are in force.`);
    this.name = 'EngineUnavailableError';
  }
}

function engineForPlatform(): BlockingEngine | null {
  if (Platform.OS === 'ios') return callDirectory;
  if (Platform.OS === 'android') return callScreening;
  return null;
}

function unsupportedStatus(): EngineStatus {
  return {
    active: false,
    platformPieceOn: false,
    detail: UNSUPPORTED_DETAIL,
  };
}

export function isSupported(): boolean {
  const engine = engineForPlatform();
  if (!engine) return false;
  try {
    return engine.isSupported();
  } catch {
    return false;
  }
}

export async function getStatus(): Promise<EngineStatus> {
  const engine = engineForPlatform();
  if (!engine) return unsupportedStatus();
  try {
    return await engine.getStatus();
  } catch (reason) {
    return { ...unsupportedStatus(), detail: `Protection status is unavailable (${describeError(reason)}).` };
  }
}

function matchInput(state: LocalAppState): MatchInput {
  return {
    blocking: state.settings.blocking,
    // Disabled Rules act on nothing, so the engines never see them.
    rules: state.rules
      .filter((rule) => rule.enabled)
      .map((rule) => ({
        kind: rule.kind,
        pattern: rule.pattern,
        number: rule.number,
        ...(rule.end === undefined ? {} : { end: rule.end }),
        // iOS expands a Prefix into numbers, so it needs the lengths this country
        // dials rather than every length E.164 allows.
        ...(rule.pattern === 'prefix' ? { nationalLengths: nationalLengthsFor(rule.number) } : {}),
      })),
  };
}

/**
 * The platform's verdict on a candidate Rule set. Nothing is persisted here;
 * `null` means the platform can neither write nor refuse (web).
 */
async function attempt(rules: Rule[], settings: LocalSettings): Promise<SyncResult | null> {
  const engine = engineForPlatform();
  if (!engine) return null;
  return engine.sync(matchInput({ schemaVersion: 1, settings, rules }));
}

function refusalMessage(result: SyncResult): string {
  const needs = formatCount(result.entries);
  const holds = formatCount(result.capacity);
  return `That would need ${needs} numbers in the iPhone's blocking list, and it holds ${holds}. Nothing was saved.`;
}

export type ApplyResult = { ok: true } | { ok: false; message: string; rejected: number[] };

/**
 * Hands the candidate Rules to the platform engine and, only if it accepts,
 * saves them. iOS refuses a change that would cross Capacity (ADR 0004):
 * then nothing is saved and `rejected` names the Rules that did not fit, as
 * indices into `next`.
 */
export async function applyRules(next: Rule[], settings: LocalSettings): Promise<ApplyResult> {
  let result: SyncResult | null;
  try {
    result = await attempt(next, settings);
  } catch (reason) {
    return {
      ok: false,
      message: `That change could not be applied (${describeError(reason)}). Nothing was saved.`,
      rejected: [],
    };
  }
  if (result?.overflow) {
    return { ok: false, message: refusalMessage(result), rejected: result.rejected };
  }
  replaceRules(next);
  setSettings(settings);
  return { ok: true };
}

export interface PartialApplyResult {
  /** How many of the candidate Rules are now saved. */
  applied: number;
  rejected: Rule[];
  message: string | null;
}

/**
 * Bulk import and Restore apply what fits and report the rest, instead of
 * failing the whole change the way a Registration does (ADR 0004).
 */
export async function applyRulesAllowingPartial(
  next: Rule[],
  settings: LocalSettings,
): Promise<PartialApplyResult> {
  let result: SyncResult | null;
  try {
    result = await attempt(next, settings);
  } catch (reason) {
    return {
      applied: 0,
      rejected: [],
      message: `That change could not be applied (${describeError(reason)}). Nothing was saved.`,
    };
  }
  const refused = result?.overflow ? new Set(result.rejected) : null;
  if (!refused || refused.size === 0) {
    replaceRules(next);
    setSettings(settings);
    return { applied: next.length, rejected: [], message: null };
  }
  const accepted: Rule[] = [];
  const rejected: Rule[] = [];
  next.forEach((rule, index) => {
    if (refused.has(index)) rejected.push(rule);
    else accepted.push(rule);
  });
  replaceRules(accepted);
  setSettings(settings);
  return {
    applied: accepted.length,
    rejected,
    message: `${refusalMessage(result as SyncResult)} ${formatCount(rejected.length)} of them were left out.`,
  };
}

export async function checkNumber(query: E164): Promise<{ result: MatchResult; rules: Rule[] }> {
  const engine = engineForPlatform();
  if (!engine) throw new EngineUnavailableError();
  const state = getState();
  // The result's indices point into the Rules the engine was given, so the
  // same filtered list travels back for the screen to name them.
  const rules = state.rules.filter((rule) => rule.enabled);
  const result = await engine.checkNumber({ query, ...matchInput(state) });
  return { result, rules };
}

/** Pushes the Rules the app holds to the platform again, and reports what it cost. */
export async function syncNow(): Promise<SyncResult> {
  const state = getState();
  const result = await attempt(state.rules, state.settings);
  return result ?? { written: false, entries: 0, capacity: 0, overflow: false, rejected: [] };
}

let reconciled = false;

/**
 * Pushes the Rules to the platform once per launch. iOS only consults the block
 * list the extension handed it, and that list can go stale while the app is
 * closed — most often because the extension was switched on in Settings after
 * the last sync. The platform decides whether the request is worth honouring;
 * failures are left to Protection status to report rather than blocking a launch.
 */
export async function reconcileOnLaunch(): Promise<void> {
  if (reconciled) return;
  reconciled = true;
  if (!isSupported()) return;
  try {
    await syncNow();
  } catch {
    // A launch is not the place to surface a sync failure.
  }
}

/**
 * iOS only: how many numbers the Rules the app holds would take in the
 * blocking list, without writing anything. `null` elsewhere.
 */
export async function previewBlockList(): Promise<SyncResult | null> {
  const engine = engineForPlatform();
  if (!engine || !isIosEngine(engine)) return null;
  const state = getState();
  try {
    return await engine.preview(matchInput(state));
  } catch {
    return null;
  }
}

function isIosEngine(engine: BlockingEngine): engine is IosEngine {
  return typeof (engine as IosEngine).openBlockingSettings === 'function';
}

function isAndroidEngine(engine: BlockingEngine): engine is AndroidEngine {
  return typeof (engine as AndroidEngine).requestScreeningRole === 'function';
}

/** Opens the platform screen that turns protection on. False when there is none. */
export async function openPlatformSettings(): Promise<boolean> {
  const engine = engineForPlatform();
  if (!engine) return false;
  if (isIosEngine(engine)) {
    await engine.openBlockingSettings();
    return true;
  }
  if (isAndroidEngine(engine)) {
    await engine.openRoleSettings();
    return true;
  }
  return false;
}

/** Android: asks for the call screening role. Always false elsewhere. */
export async function requestScreeningRole(): Promise<boolean> {
  const engine = engineForPlatform();
  if (!engine || !isAndroidEngine(engine)) return false;
  const { screeningRole } = await engine.requestScreeningRole();
  return screeningRole;
}

/** Runs the checked-in fixture table through this platform's matcher. */
export async function verifyEngine(): Promise<{ failures: string[] }> {
  const engine = engineForPlatform();
  if (!engine) return { failures: [] };
  try {
    return await engine.selfCheck(FIXTURES_JSON);
  } catch (reason) {
    return { failures: [describeError(reason)] };
  }
}

/**
 * What this build asks the platform for, read back from the platform itself
 * rather than written down here: Android's requested permissions, iOS's
 * declared usage reasons. `null` where there is no platform to ask (the web).
 *
 * The Privacy screen shows this list as it is, so the app cannot claim more or
 * less than the system says (ADR 0006).
 */
export async function declaredAccess(): Promise<string[] | null> {
  const engine = engineForPlatform();
  if (!engine) return null;
  if (isIosEngine(engine)) return engine.getDeclaredUsageDescriptions();
  if (isAndroidEngine(engine)) return engine.getRequestedPermissions();
  return null;
}
