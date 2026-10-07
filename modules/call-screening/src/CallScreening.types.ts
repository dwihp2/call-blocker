import type { E164, EngineStatus, MatchInput, MatchResult, SyncResult } from '@call-blocker/core';

/**
 * What the `CallScreening` native module exposes to JavaScript. The Android
 * module and the web stand-in both answer to this shape.
 */
export interface CallScreeningNativeModule {
  isSupported(): boolean;
  getStatus(): Promise<EngineStatus>;
  requestScreeningRole(): Promise<{ screeningRole: boolean }>;
  openRoleSettings(): Promise<void>;
  sync(input: MatchInput): Promise<SyncResult>;
  checkNumber(input: { query: E164 } & MatchInput): Promise<MatchResult>;
  selfCheck(fixturesJson: string): Promise<{ failures: string[] }>;
  getRequestedPermissions(): Promise<string[]>;
}
