import { Platform } from 'react-native';

import type {
  AndroidEngine,
  E164,
  EngineStatus,
  MatchInput,
  MatchResult,
  SyncResult,
} from '@call-blocker/core';

import requireCallScreeningModule from './CallScreeningModule';

/**
 * Call screening is an Android platform piece: the app has to hold the call
 * screening role before Android will let it see incoming calls.
 */
export function isSupported(): boolean {
  return Platform.OS === 'android';
}

/**
 * The Android Blocking engine. Every method goes through the module lazily, so
 * importing this package on a platform without call screening never throws.
 */
export const callScreening: AndroidEngine = {
  isSupported,
  getStatus: (): Promise<EngineStatus> => requireCallScreeningModule().getStatus(),
  requestScreeningRole: (): Promise<{ screeningRole: boolean }> =>
    requireCallScreeningModule().requestScreeningRole(),
  openRoleSettings: (): Promise<void> => requireCallScreeningModule().openRoleSettings(),
  sync: (input: MatchInput): Promise<SyncResult> => requireCallScreeningModule().sync(input),
  checkNumber: (input: { query: E164 } & MatchInput): Promise<MatchResult> =>
    requireCallScreeningModule().checkNumber(input),
  selfCheck: (fixturesJson: string): Promise<{ failures: string[] }> =>
    requireCallScreeningModule().selfCheck(fixturesJson),
};

export default callScreening;
