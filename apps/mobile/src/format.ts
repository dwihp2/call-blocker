import { formatNumber } from '@call-blocker/core';
import type { PatternType, RegionCode, RuleKind } from '@call-blocker/core';

/**
 * Small display helpers shared by screens and by the engine's refusal message.
 * Deliberately free of `Intl` so the same output appears on every device.
 */

export function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** `1234567` → `1,234,567`. */
export function formatCount(value: number): string {
  const grouped = Math.trunc(Math.abs(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return value < 0 ? `-${grouped}` : grouped;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-03-12T09:00:00.000Z` → `12 Mar 2026`. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** `2026-03-12T09:00:00.000Z` → `12 Mar 2026, 09:00`. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${formatDate(iso)}, ${hours}:${minutes}`;
}

export function kindLabel(kind: RuleKind): string {
  return kind === 'block' ? 'Block' : 'Allow';
}

export function patternLabel(pattern: PatternType): string {
  if (pattern === 'single') return 'Single number';
  if (pattern === 'prefix') return 'Prefix';
  return 'Interval';
}

export interface PatternShape {
  pattern: PatternType;
  number: string;
  end?: string;
}

/** The shape of a Number pattern in canonical digits: `+62812…`, `+62812*`, `+628…–+628…`. */
export function patternText(shape: PatternShape, region: RegionCode): string {
  if (shape.pattern === 'single') return formatNumber(shape.number, region);
  if (shape.pattern === 'prefix') return `${formatNumber(shape.number, region)}*`;
  return `${formatNumber(shape.number, region)} – ${formatNumber(shape.end ?? shape.number, region)}`;
}
