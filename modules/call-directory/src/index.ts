import type { IosEngine } from '@call-blocker/core';
import { Platform } from 'react-native';

import NativeCallDirectory from './CallDirectoryModule';
import inertCallDirectory from './inert';

/**
 * The iOS Blocking engine: it compiles the Rules into the Effective block list,
 * writes it to the App Group the extension reads, and asks CallKit to reload.
 *
 * On Android, the web, and an iOS build without the native module it is the
 * inert engine, so the app runs everywhere without guarding every call.
 */
export const callDirectory: IosEngine =
  Platform.OS === 'ios' && NativeCallDirectory ? NativeCallDirectory : inertCallDirectory;

/** Whether this device has a Call Directory at all. */
export function isSupported(): boolean {
  return Platform.OS === 'ios';
}

export type { CallDirectoryNativeModule } from './CallDirectory.types';
