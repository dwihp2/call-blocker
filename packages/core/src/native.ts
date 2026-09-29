import type { E164, MatchInput, MatchResult } from './types';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface EngineStatus {
  /** Is this device able to block calls right now? */
  active: boolean;
  /** iOS: the Call Directory extension in Settings > Phone. Android: the call screening role. */
  platformPieceOn: boolean;
  contacts: PermissionState;
  notifications: PermissionState;
  /** Human-readable detail for Protection status, e.g. when the list was last written. */
  detail?: string;
}

/**
 * What came of pushing the rule set to the platform. iOS can refuse a change
 * that doesn't fit its Capacity; Android never refuses.
 */
export interface SyncResult {
  /** False when nothing was written and nothing changed. */
  written: boolean;
  entries: number;
  capacity: number;
  overflow: boolean;
  /** Rules that could not fit, as indices into the input's rules. */
  rejected: number[];
}

/** The shape both native engines expose to the app. */
export interface BlockingEngine {
  isSupported(): boolean;
  getStatus(): Promise<EngineStatus>;
  /** Hands the whole rule set to the platform. Nothing is blocked until this runs. */
  sync(input: MatchInput): Promise<SyncResult>;
  /** What would happen to a number, and which Rules it matches. */
  checkNumber(input: { query: E164 } & MatchInput): Promise<MatchResult>;
  /** Runs the fixture table through this platform's engine; one line per failure. */
  selfCheck(fixturesJson: string): Promise<{ failures: string[] }>;
}

export interface IosEngine extends BlockingEngine {
  /** Counts what a rule set would cost without touching the extension. */
  preview(input: MatchInput): Promise<SyncResult>;
  openBlockingSettings(): Promise<void>;
}

export interface AndroidEngine extends BlockingEngine {
  requestScreeningRole(): Promise<{ screeningRole: boolean }>;
  openRoleSettings(): Promise<void>;
}
