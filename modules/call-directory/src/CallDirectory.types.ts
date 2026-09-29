import type { IosEngine } from '@call-blocker/core';

/**
 * The native module is exactly the `IosEngine` contract from
 * `@call-blocker/core`, so this file re-uses that interface instead of
 * declaring a second one that could drift from `ios/CallDirectoryModule.swift`.
 */
export type CallDirectoryNativeModule = IosEngine;
