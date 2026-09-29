import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { E164, EngineStatus, MatchInput, MatchResult, SyncResult } from '@call-blocker/core';

import type { CallScreeningNativeModule } from './CallScreening.types';

let instance: CallScreeningNativeModule | null = null;

/**
 * The Android call screening module.
 *
 * It is resolved on first use, so importing this file on a platform that has no
 * call screening service never throws. Off Android every answer is inert: the
 * app asks `isSupported()` before it expects Blocking to do anything.
 */
export default function requireCallScreeningModule(): CallScreeningNativeModule {
  if (Platform.OS !== 'android') {
    return inertCallScreeningModule;
  }
  if (instance === null) {
    instance = requireNativeModule<CallScreeningNativeModule>('CallScreening');
  }
  return instance;
}

const inertCallScreeningModule: CallScreeningNativeModule = {
  isSupported: () => false,
  getStatus: async (): Promise<EngineStatus> => ({
    active: false,
    platformPieceOn: false,
    contacts: 'undetermined',
    notifications: 'undetermined',
    detail: 'Call screening is only available on Android',
  }),
  requestScreeningRole: async () => ({ screeningRole: false }),
  openRoleSettings: async () => {},
  sync: async (input: MatchInput): Promise<SyncResult> => ({
    written: false,
    entries: input.rules.length,
    capacity: 0,
    overflow: false,
    rejected: [],
  }),
  checkNumber: async (_input: { query: E164 } & MatchInput): Promise<MatchResult> => ({
    blocked: false,
    decidedBy: { type: 'none' },
    matches: [],
  }),
  selfCheck: async (): Promise<{ failures: string[] }> => ({ failures: [] }),
};
