import { requireOptionalNativeModule } from 'expo';
import type { CallDirectoryNativeModule } from './CallDirectory.types';

/**
 * The iOS module, or `null` where it does not exist: `expo-module.config.json`
 * ships it for Apple platforms only, so Android and the web resolve this to
 * null instead of throwing at import time.
 */
export default requireOptionalNativeModule<CallDirectoryNativeModule>('CallDirectory');
