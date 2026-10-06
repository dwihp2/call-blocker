/**
 * Intent-level Rule changes — the only way a screen changes anything.
 *
 * Each one builds the candidate Rule set from the state the app holds and hands
 * it to the platform engine through `applyRules` before anything is saved, so
 * iOS Capacity refusal cannot be bypassed (ADR 0004). A Registration fails
 * whole; Bulk import and Restore apply what fits and report the rest.
 */

import type { Rule, RuleInput } from '@call-blocker/core';

import { applyRuleInput, createRule, getState, type LocalSettings } from './store';

import { applyRules, applyRulesAllowingPartial, type ApplyResult, type PartialApplyResult } from './engine';

/** Registration: one deliberate Rule, refused whole if the engine refuses it. */
export async function registerRule(input: RuleInput): Promise<ApplyResult> {
  const state = getState();
  return applyRules([...state.rules, createRule(input)], state.settings);
}

/** Editing a Rule keeps its id and the date it was added. */
export async function updateRule(id: string, input: RuleInput): Promise<ApplyResult> {
  const state = getState();
  const existing = state.rules.find((rule) => rule.id === id);
  if (!existing) return { ok: true };
  const next = state.rules.map((rule) => (rule.id === id ? applyRuleInput(existing, input) : rule));
  return applyRules(next, state.settings);
}

export async function deleteRule(id: string): Promise<ApplyResult> {
  const state = getState();
  return applyRules(
    state.rules.filter((rule) => rule.id !== id),
    state.settings,
  );
}

/**
 * Turning a Rule off keeps it in the list and leaves the next sync's list;
 * turning it on is a change the engine must accept first, like any other
 * (ADR 0004).
 */
export async function setRuleEnabled(id: string, enabled: boolean): Promise<ApplyResult> {
  const state = getState();
  const next = state.rules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule));
  return applyRules(next, state.settings);
}

export interface ImportEntry {
  /** The line in the pasted text the Rule came from, so a refusal can name it. */
  line: number;
  input: RuleInput;
}

export interface ImportOutcome {
  /** How many of the pasted Rules are now saved. */
  applied: number;
  rejected: Array<{ line: number; rule: Rule }>;
  message: string | null;
}

/** Bulk import: adds to what is already registered, keeping what fits. */
export async function importRules(entries: readonly ImportEntry[]): Promise<ImportOutcome> {
  const state = getState();
  const lineById = new Map<string, number>();
  const created = entries.map((entry) => {
    const rule = createRule(entry.input);
    lineById.set(rule.id, entry.line);
    return rule;
  });
  const outcome = await applyRulesAllowingPartial([...state.rules, ...created], state.settings);
  return {
    applied: outcome.applied - state.rules.length,
    rejected: outcome.rejected.map((rule) => ({ line: lineById.get(rule.id) ?? 0, rule })),
    message: outcome.message,
  };
}

/** Restore: `next` is the whole Block list the Restore preview settled on. */
export async function restoreRules(next: Rule[]): Promise<PartialApplyResult> {
  return applyRulesAllowingPartial(next, getState().settings);
}

/** Every settings change is offered to the engine too: contacts and Blocking both move the Effective block list. */
export async function updateSettings(patch: Partial<LocalSettings>): Promise<ApplyResult> {
  const state = getState();
  return applyRules(state.rules, { ...state.settings, ...patch });
}

export async function setBlocking(blocking: boolean): Promise<ApplyResult> {
  return updateSettings({ blocking });
}

/** Marks the first-launch walkthrough as done, so it never shows again. */
export async function finishOnboarding(): Promise<ApplyResult> {
  return updateSettings({ onboarded: true });
}

export type { ApplyResult, PartialApplyResult };
