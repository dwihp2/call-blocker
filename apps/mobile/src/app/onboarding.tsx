import type { EngineStatus, PermissionState } from '@call-blocker/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { finishOnboarding, updateSettings } from '@/data/actions';
import {
  getStatus,
  isSupported,
  openPlatformSettings,
  requestContactsPermission,
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
  const [step, setStep] = useState<1 | 2>(1);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [contacts, setContacts] = useState<PermissionState | null>(null);
  const [roleRefused, setRoleRefused] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = isSupported();

  useEffect(() => {
    if (ready && state.settings.onboarded) router.replace('/');
  }, [ready, state.settings.onboarded, router]);

  useFocusEffect(
    useCallback(() => {
      if (!supported) return undefined;
      let live = true;
      void (async () => {
        const next = await getStatus();
        if (live) setStatus(next);
      })();
      return () => {
        live = false;
      };
    }, [supported]),
  );

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

  const enableContacts = async () => {
    setFailure(null);
    setBusy(true);
    try {
      const permission = await requestContactsPermission();
      setContacts(permission);
      if (permission === 'granted') {
        const outcome = await updateSettings({ contactsAllowance: true });
        if (!outcome.ok) setFailure(outcome.message);
      }
    } catch (reason) {
      setFailure(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
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
  };

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
      <AppText variant="small" tone="secondary">{`Step ${step} of 2`}</AppText>

      {failure ? <Banner tone="danger" title="That did not work" message={failure} /> : null}

      {step === 1 ? (
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
              <Row gap={Spacing.three}>
                <Button
                  label="Enable"
                  onPress={() => void enableBlocking()}
                  busy={busy}
                  style={styles.action}
                />
                <Button
                  label="Skip"
                  variant="secondary"
                  onPress={() => setStep(2)}
                  disabled={busy}
                  style={styles.action}
                />
              </Row>
            </>
          ) : (
            <>
              <Banner tone="info" title="This device cannot block calls" message={UNSUPPORTED_DETAIL} />
              <Button label="Skip" variant="secondary" onPress={() => setStep(2)} />
            </>
          )}
        </Section>
      ) : (
        <Section
          title="Contacts"
          description="Contact access is needed only for the Contacts allowance, the optional setting that treats every number in your contacts as allowed. A Single number Block rule still blocks a contact, and you can turn it on later in Settings.">
          {contacts === 'granted' ? (
            <Banner tone="success" title="Contact access is on" message="The Contacts allowance is now on." />
          ) : contacts ? (
            <Banner
              tone="warning"
              title="Contact access was not granted"
              message="The Contacts allowance stays off. You can turn it on later in Settings."
            />
          ) : null}
          <Row gap={Spacing.three}>
            <Button
              label="Enable"
              onPress={() => void enableContacts()}
              busy={busy}
              disabled={contacts === 'granted'}
              style={styles.action}
            />
            <Button label="Skip" variant="secondary" onPress={() => void finish()} disabled={busy} style={styles.action} />
          </Row>
          <Button label="Finish" onPress={() => void finish()} busy={busy} />
        </Section>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1 },
});
