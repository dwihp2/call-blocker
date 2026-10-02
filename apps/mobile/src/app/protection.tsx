import type { EngineStatus, SyncResult } from '@call-blocker/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Platform } from 'react-native';

import {
  getStatus,
  isSupported,
  openPlatformSettings,
  requestContactsPermission,
  requestScreeningRole,
  syncNow,
  UNSUPPORTED_DETAIL,
} from '@/data/engine';
import { useStore } from '@/data/store';
import { describeError, formatCount } from '@/format';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  Screen,
  Section,
  StatusRow,
} from '@/ui/components';

type Busy = 'piece' | 'contacts' | 'sync';

interface Notice {
  tone: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  message: string;
}

function syncNotice(result: SyncResult): Notice {
  if (result.overflow) {
    return {
      tone: 'danger',
      title: 'The Rules do not fit Capacity',
      message: `That needs ${formatCount(result.entries)} numbers and the iPhone's Capacity is ${formatCount(
        result.capacity,
      )}. ${formatCount(result.rejected.length)} of the app's Rules were refused.`,
    };
  }
  if (!result.written) {
    return {
      tone: 'info',
      title: 'Nothing was written',
      message: 'The platform wrote no numbers, so the blocking list already matches the Rules.',
    };
  }
  if (result.reloadError) {
    return {
      tone: 'warning',
      title: 'Written, but CallKit would not reload it',
      message: `The numbers are saved and nothing is being blocked yet. CallKit said: ${result.reloadError}`,
    };
  }
  return {
    tone: 'success',
    title: 'Sync complete',
    message: `Wrote ${formatCount(result.entries)} numbers to the blocking list.`,
  };
}

/** The Blocking piece is a different thing on each platform. */
function pieceDetail(): string {
  if (Platform.OS === 'ios') {
    return 'Turn Call Blocker on in Settings › Phone › Call Blocking & Identification. iOS has no other way to switch it on, and the app cannot do it for you.';
  }
  return 'The call screening role, granted in the system settings.';
}

/** iOS opens the Call Directory settings; Android asks for the role first. */
function pieceActionLabel(androidRoleRefused: boolean): string {
  if (Platform.OS === 'ios') return 'Open Phone settings';
  if (androidRoleRefused) return 'Open system settings';
  return 'Turn on call screening';
}

export default function ProtectionScreen() {
  const { state, error } = useStore();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<Notice | null>(null);
  const [androidRoleRefused, setAndroidRoleRefused] = useState(false);
  const supported = isSupported();

  const refresh = useCallback(async () => {
    try {
      setStatus(await getStatus());
      setLoadError(null);
    } catch (reason) {
      setLoadError(describeError(reason));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!supported) return;
      void refresh();
    }, [refresh, supported]),
  );

  const pieceAction = async () => {
    if (busy) return;
    setBusy('piece');
    setActionError(null);
    try {
      if (Platform.OS === 'ios') {
        const opened = await openPlatformSettings();
        if (!opened) {
          setActionError(
            'iOS does not let an app open Phone settings. Open Settings › Phone › Call Blocking & Identification and turn Call Blocker on.',
          );
        }
      } else if (androidRoleRefused) {
        const opened = await openPlatformSettings();
        if (!opened) setActionError('The call screening role settings could not be opened on this device.');
      } else {
        const granted = await requestScreeningRole();
        if (!granted) setAndroidRoleRefused(true);
      }
      await refresh();
    } catch (reason) {
      setActionError(describeError(reason));
    } finally {
      setBusy(null);
    }
  };

  const contactsAction = async () => {
    if (busy) return;
    setBusy('contacts');
    setActionError(null);
    try {
      await requestContactsPermission();
      await refresh();
    } catch (reason) {
      setActionError(describeError(reason));
    } finally {
      setBusy(null);
    }
  };

  const notificationsAction = async () => {
    if (busy) return;
    setActionError(null);
    try {
      await Linking.openSettings();
    } catch (reason) {
      setActionError(describeError(reason));
    }
  };

  const runSync = async () => {
    if (busy) return;
    setBusy('sync');
    setActionError(null);
    try {
      setSyncResult(syncNotice(await syncNow()));
      await refresh();
    } catch (reason) {
      setSyncResult({ tone: 'danger', title: 'Sync did not run', message: describeError(reason) });
    } finally {
      setBusy(null);
    }
  };

  const allowance = state.settings.contactsAllowance ? 'on' : 'off';
  const contactsDetail = `Only needed for the Contacts allowance, which is ${allowance}.`;

  return (
    <Screen>
      {error ? <Banner tone="danger" title="Saved state problem" message={error} /> : null}
      {loadError ? (
        <Banner tone="danger" title="Protection status is unavailable" message={loadError} />
      ) : null}
      {actionError ? (
        <Banner tone="danger" title="The action did not finish" message={actionError} />
      ) : null}

      {!supported ? (
        <Banner
          tone="info"
          title="This device cannot block calls"
          message={`${UNSUPPORTED_DETAIL} Nothing on this device can act on the Rules.`}
        />
      ) : null}

      {supported && status ? (
        <>
          <Card>
            <AppText variant="heading" tone={status.active ? 'success' : 'warning'}>
              {status.active ? 'Calls are being blocked.' : 'Calls are not being blocked yet.'}
            </AppText>
            {status.detail ? (
              <AppText variant="small" tone="secondary">
                {status.detail}
              </AppText>
            ) : null}
          </Card>

          <Section title="What Blocking needs" description="Every item below has to be on before calls can be blocked.">
            <Card>
              <StatusRow
                label="Blocking piece"
                detail={pieceDetail()}
                state={status.platformPieceOn ? 'on' : 'attention'}
                actionLabel={!status.platformPieceOn && busy === null ? pieceActionLabel(androidRoleRefused) : undefined}
                onAction={() => void pieceAction()}
              />
              <Divider />
              <StatusRow
                label="Contacts"
                detail={contactsDetail}
                state={status.contacts === 'granted' ? 'on' : status.contacts === 'denied' ? 'attention' : 'off'}
                actionLabel={status.contacts !== 'granted' && busy === null ? 'Allow contacts access' : undefined}
                onAction={() => void contactsAction()}
              />
              <Divider />
              <StatusRow
                label="Notifications"
                detail={
                  status.notifications === 'granted'
                    ? undefined
                    : 'The app cannot warn you about blocked calls while this is off.'
                }
                state={status.notifications === 'granted' ? 'on' : 'attention'}
                actionLabel={status.notifications !== 'granted' && busy === null ? 'Open app settings' : undefined}
                onAction={() => void notificationsAction()}
              />
            </Card>
          </Section>
        </>
      ) : null}

      <Button
        label="Sync now"
        onPress={() => void runSync()}
        disabled={!supported || busy !== null}
        busy={busy === 'sync'}
      />

      {syncResult ? <Banner tone={syncResult.tone} title={syncResult.title} message={syncResult.message} /> : null}
    </Screen>
  );
}
