import type { EngineStatus } from '@call-blocker/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet } from 'react-native';

import { finishOnboarding } from '@/data/actions';
import {
  getStatus,
  isSupported,
  openPlatformSettings,
  requestScreeningRole,
  UNSUPPORTED_DETAIL,
} from '@/data/engine';
import { useStore } from '@/data/store';
import { describeError } from '@/format';
import { AppText, Banner, Button, Card, Row, Screen, Section, StatusRow } from '@/ui/components';
import { Spacing } from '@/ui/theme';

const PLATFORM_PIECE =
  Platform.OS === 'ios'
    ? 'the Call Directory extension'
    : Platform.OS === 'android'
      ? 'the call screening role'
      : 'the platform blocking feature';

/** One sentence per platform: what Blocking needs here. */
function blockingDescription(): string {
  if (Platform.OS === 'ios') {
    return 'Blocking is the app-wide switch that makes your Rules act. On iPhone it needs the Call Directory extension in Settings > Phone.';
  }
  if (Platform.OS === 'android') {
    return 'Blocking is the app-wide switch that makes your Rules act. On Android it needs the call screening role in the system settings.';
  }
  return `Blocking is the app-wide switch that makes your Rules act. ${UNSUPPORTED_DETAIL} On this device it only decides whether the Rules would be in force.`;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { ready, state } = useStore();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [roleRefused, setRoleRefused] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set once the walkthrough has decided to leave, so it never finishes twice. */
  const finished = useRef(false);
  const supported = isSupported();

  useEffect(() => {
    if (ready && state.settings.onboarded) router.replace('/');
  }, [ready, state.settings.onboarded, router]);

  /**
   * Blocking's state changes outside this app — iOS Settings › Phone, the
   * Android role dialog — so the screen re-reads it whenever it comes back.
   */
  const refresh = useCallback(async () => {
    try {
      setStatus(await getStatus());
    } catch {
      // A status that cannot be read leaves the last one on screen.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (supported) void refresh();
    }, [refresh, supported]),
  );

  // Returning from iOS Settings is not a navigation event, so focus alone would
  // leave the extension showing as off after the person turned it on.
  useEffect(() => {
    if (!supported) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh, supported]);

  const enableBlocking = async () => {
    setFailure(null);
    setRoleRefused(false);
    setBusy(true);
    try {
      if (Platform.OS === 'ios') {
        await openPlatformSettings();
      } else {
        const granted = await requestScreeningRole();
        setRoleRefused(!granted);
      }
      setStatus(await getStatus());
    } catch (reason) {
      setFailure(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  const finish = useCallback(async () => {
    setFailure(null);
    setBusy(true);
    try {
      const outcome = await finishOnboarding();
      if (!outcome.ok) {
        setFailure(outcome.message);
        return;
      }
      router.replace('/');
    } catch (reason) {
      setFailure(describeError(reason));
    } finally {
      setBusy(false);
    }
  }, [router]);

  // Blocking is the one thing this screen sets up, so the moment the platform
  // piece is on there is nothing left to do here: the person lands on their
  // Rules instead of being left on a screen that is already finished.
  useEffect(() => {
    if (!ready || status?.active !== true || finished.current) return;
    finished.current = true;
    void finish();
  }, [ready, status, finish]);

  const blockingState: 'on' | 'off' | 'attention' =
    status === null ? 'off' : status.active ? 'on' : status.platformPieceOn ? 'attention' : 'off';
  const blockingDetail = status
    ? status.detail ??
      (status.platformPieceOn
        ? `Blocking is on through ${PLATFORM_PIECE}.`
        : `${PLATFORM_PIECE} is off. Turn it on so Blocking can act on your Rules.`)
    : undefined;

  return (
    <Screen topInset>
      <AppText variant="title">Set up Blocking</AppText>

      {failure ? <Banner tone="danger" title="That did not work" message={failure} /> : null}

      <Section title="Blocking" description={blockingDescription()}>
        {supported ? (
          <>
            {status ? <Card><StatusRow label="Blocking" state={blockingState} detail={blockingDetail} /></Card> : null}
            {roleRefused ? (
              <Banner
                tone="warning"
                title="The call screening role was not granted"
                message="The call screening role has to be granted in the Android system settings. Open them again to grant it."
                actionLabel="Open system settings"
                onPress={() => void openPlatformSettings()}
              />
            ) : null}
            {status?.active ? (
              <Button label="Continue" onPress={() => void finish()} busy={busy} style={styles.action} />
            ) : (
              <Row gap={Spacing.three}>
                <Button label="Enable" onPress={() => void enableBlocking()} busy={busy} style={styles.action} />
                <Button
                  label="Skip"
                  variant="secondary"
                  onPress={() => void finish()}
                  disabled={busy}
                  style={styles.action}
                />
              </Row>
            )}
          </>
        ) : (
          <>
            <Banner tone="info" title="This device cannot block calls" message={UNSUPPORTED_DETAIL} />
            <Button label="Skip" variant="secondary" onPress={() => void finish()} />
          </>
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1 },
});
