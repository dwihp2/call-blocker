/// <reference types="expo/types" />

// Expo's ambient declarations (CSS module imports, asset imports, `process.env.EXPO_*`) live in
// `expo/types`. The generated `expo-env.d.ts` normally references them from the app root; this file
// does the same from inside `src`, so `npx tsc --noEmit` resolves them without a dev-server run.
