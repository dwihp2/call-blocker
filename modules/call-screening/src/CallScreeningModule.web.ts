import { NativeModule, registerWebModule } from 'expo';

import type { E164, EngineStatus, MatchInput, MatchResult, SyncResult } from '@call-blocker/core';

import type { CallScreeningNativeModule } from './CallScreening.types';

/**
 * There is no call screening service on the web, so the module answers with
 * inert values and the app runs there without crashing.
 */
class CallScreeningWebModule extends NativeModule<{}> implements CallScreeningNativeModule {
  isSupported(): boolean {
    return false;
  }

  async getStatus(): Promise<EngineStatus> {
    return {
      active: false,
      platformPieceOn: false,
      contacts: 'undetermined',
      notifications: 'undetermined',
      detail: 'Call screening is only available on Android',
    };
  }

  async requestScreeningRole(): Promise<{ screeningRole: boolean }> {
    return { screeningRole: false };
  }

  async openRoleSettings(): Promise<void> {}

  async sync(input: MatchInput): Promise<SyncResult> {
    return {
      written: false,
      entries: input.rules.length,
      capacity: 0,
      overflow: false,
      rejected: [],
    };
  }

  async checkNumber(_input: { query: E164 } & MatchInput): Promise<MatchResult> {
    return { blocked: false, decidedBy: { type: 'none' }, matches: [] };
  }

  async selfCheck(): Promise<{ failures: string[] }> {
    return { failures: [] };
  }
}

const instance = registerWebModule(
  CallScreeningWebModule,
  'CallScreening'
) as unknown as CallScreeningNativeModule;

/** The web stand-in for the Android module; it registers itself on import. */
export default function requireCallScreeningModule(): CallScreeningNativeModule {
  return instance;
}
