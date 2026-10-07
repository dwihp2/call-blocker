import type { IosEngine } from '@call-blocker/core';

const MESSAGE = 'Call Directory is only available on iOS.';

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(MESSAGE));
}

/**
 * What the engine answers on Android, the web, and any iOS build without the
 * native module: `isSupported` is false and every other call rejects with a
 * clear reason, so the app can run everywhere without guarding every call.
 */
const inertCallDirectory: IosEngine = {
  isSupported: () => false,
  getStatus: () => unsupported(),
  sync: () => unsupported(),
  preview: () => unsupported(),
  checkNumber: () => unsupported(),
  selfCheck: () => unsupported(),
  openBlockingSettings: () => unsupported(),
  getDeclaredUsageDescriptions: () => unsupported(),
};

export default inertCallDirectory;
