import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { useStore } from '@/data/store';
import { Loading } from '@/ui/components';
import { useAppTheme } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

/** The app's Stack: every screen is reachable from the Rules list or Settings. */
export default function RootLayout() {
  const theme = useAppTheme();
  const router = useRouter();
  const segments = useSegments();
  const { ready, state } = useStore();
  const onboarded = state.settings.onboarded;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const onOnboarding = segments[0] === 'onboarding';
    if (!onboarded && !onOnboarding) router.replace('/onboarding');
  }, [ready, onboarded, segments, router]);

  if (!ready) return <Loading message="Opening your Rules…" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.card },
        headerTitleStyle: { color: theme.text },
        headerTintColor: theme.accent,
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" options={{ title: 'Call Blocker' }} />
      <Stack.Screen name="register" options={{ title: 'Register a Rule' }} />
      <Stack.Screen name="bulk-import" options={{ title: 'Bulk import' }} />
      <Stack.Screen name="check" options={{ title: 'Number check' }} />
      <Stack.Screen name="backup" options={{ title: 'Backup' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="protection" options={{ title: 'Protection status' }} />
      <Stack.Screen name="onboarding" options={{ title: 'Set up blocking', headerShown: false }} />
    </Stack>
  );
}
