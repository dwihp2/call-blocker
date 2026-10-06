import { FIXTURES_JSON } from '@call-blocker/core';
import type { PermissionState, RegionCode } from '@call-blocker/core';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { setBlocking, updateSettings } from '@/data/actions';
import {
  contactsPermissionState,
  isSupported,
  openPlatformSettings,
  requestContactsPermission,
  UNSUPPORTED_DETAIL,
  verifyEngine,
} from '@/data/engine';
import { useStore } from '@/data/store';
import { describeError } from '@/format';
import {
  AppText,
  Banner,
  Card,
  Divider,
  KeyValueRow,
  NavRow,
  Screen,
  Section,
  ToggleRow,
} from '@/ui/components';
import { RegionPicker } from '@/ui/region-picker';

/** The app version comes from the Expo manifest. */
const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';

/**
 * The version of the matching contract the native matchers run, read from the
 * fixture table embedded in the core package rather than written down twice.
 */
const CONTRACT_VERSION = (() => {
  try {
    const file = JSON.parse(FIXTURES_JSON) as { version?: unknown };
    const version = file.version;
    return typeof version === 'number' || typeof version === 'string' ? String(version) : 'unknown';
  } catch {
    return 'unknown';
  }
})();

const PERMISSION_LABEL: Record<PermissionState, string> = {
  granted: 'Granted',
  denied: 'Denied in the system settings',
  undetermined: 'Not asked yet',
};

type Busy = 'region' | 'contacts' | 'blocking' | null;

export default function SettingsScreen() {
  const router = useRouter();
  const { state, error } = useStore();
  const { settings } = state;
  const supported = isSupported();

  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [contactsNotice, setContactsNotice] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      if (supported) {
        void (async () => {
          const next = await contactsPermissionState();
          if (!live) return;
          setPermission(next);
          if (next === 'granted') setContactsNotice(false);
        })();
      }
      return () => {
        live = false;
      };
    }, [supported]),
  );

  const changeRegion = async (region: RegionCode) => {
    setBusy('region');
    setRefusal(null);
    try {
      const outcome = await updateSettings({ defaultRegion: region });
      if (!outcome.ok) setRefusal(outcome.message);
    } finally {
      setBusy(null);
    }
  };

  const changeContactsAllowance = async (next: boolean) => {
    setBusy('contacts');
    setRefusal(null);
    setContactsNotice(false);
    try {
      if (!next || !supported) {
        const outcome = await updateSettings({ contactsAllowance: next });
        if (!outcome.ok) setRefusal(outcome.message);
        return;
      }
      const asked = await requestContactsPermission();
      setPermission(asked);
      if (asked !== 'granted') {
        setContactsNotice(true);
        return;
      }
      const outcome = await updateSettings({ contactsAllowance: true });
      if (!outcome.ok) setRefusal(outcome.message);
    } finally {
      setBusy(null);
    }
  };

  const changeBlocking = async (next: boolean) => {
    setBusy('blocking');
    setRefusal(null);
    try {
      const outcome = await setBlocking(next);
      if (!outcome.ok) setRefusal(outcome.message);
    } finally {
      setBusy(null);
    }
  };

  /** Runs the matching contract on this device; a failure means the engines drifted apart. */
  const checkEngine = async () => {
    try {
      const { failures } = await verifyEngine();
      Alert.alert(
        failures.length === 0 ? 'The matching engine agrees' : 'The matching engine disagrees',
        failures.length === 0
          ? 'Every case in the matching contract passes on this device.'
          : failures.join('\n'),
      );
    } catch (reason) {
      Alert.alert('The matching engine could not be checked', describeError(reason));
    }
  };

  const openSystemSettings = async () => {
    try {
      const opened = await openPlatformSettings();
      if (!opened) setRefusal('The system settings could not be opened on this device.');
    } catch (reason) {
      setRefusal(describeError(reason));
    }
  };

  return (
    <Screen>
      {error ? <Banner tone="danger" title="Saved state problem" message={error} /> : null}

      {refusal ? (
        <Banner tone="danger" title="The change was not saved" message={refusal} />
      ) : null}

      {!supported ? (
        <Banner
          tone="info"
          title="This device cannot block calls"
          message={`${UNSUPPORTED_DETAIL} Settings are kept, but nothing on this device acts on them.`}
        />
      ) : null}

      <Section
        title="Default region"
        description="The Default region is the country used to interpret numbers typed in local format, like 0812 3456 789.">
        <Card>
          <RegionPicker
            value={settings.defaultRegion}
            onChange={(region) => void changeRegion(region)}
            disabled={busy !== null}
          />
        </Card>
      </Section>

      <Section
        title="Contacts"
        description="The Contacts allowance treats every number in your contacts as allowed. It is independent of the Allow list.">
        <Card>
          <ToggleRow
            label="Contacts allowance"
            description="A Single number Block rule still blocks a contact."
            value={settings.contactsAllowance}
            onValueChange={(next) => void changeContactsAllowance(next)}
            disabled={busy !== null}
          />
          {supported ? (
            <>
              <Divider />
              <KeyValueRow
                label="Contacts permission"
                value={permission === null ? 'Checking…' : PERMISSION_LABEL[permission]}
              />
            </>
          ) : null}
        </Card>
        {contactsNotice ? (
          <Banner
            tone="warning"
            title="Contacts access is off"
            message="Without access to your contacts the Contacts allowance stays off. A Single number Block rule still blocks a contact. You can grant access later in the system settings."
            actionLabel="Open system settings"
            onPress={() => void openSystemSettings()}
          />
        ) : null}
      </Section>

      <Section title="Blocking">
        <Card>
          <ToggleRow
            label="Blocking"
            description="When off, no calls are blocked. Your Rules stay saved."
            value={settings.blocking}
            onValueChange={(next) => void changeBlocking(next)}
            disabled={busy !== null}
          />
        </Card>
      </Section>

      <Section title="How it works">
        <Card>
          <AppText variant="small" tone="secondary">
            Your Rules become the list of numbers the phone blocks, and the phone does the
            blocking — even while the app is closed. The details, and what only you can switch on,
            are one tap away.
          </AppText>
          <NavRow
            label="How blocking works"
            detail="From a Rule to a blocked call, in plain words."
            onPress={() => router.push('/how-it-works')}
          />
        </Card>
      </Section>

      <Section title="Protection and backup">
        <Card>
          <NavRow
            label="Protection status"
            detail="The permissions and platform settings Blocking needs."
            onPress={() => router.push('/protection')}
          />
          <Divider />
          <NavRow
            label="Backup"
            detail="Export the Block list, or restore a Backup file."
            onPress={() => router.push('/backup')}
          />
        </Card>
      </Section>

      <Section title="About">
        <Card>
          <AppText variant="smallBold">Call Blocker</AppText>
          <KeyValueRow label="App version" value={APP_VERSION} />
          <Divider />
          <KeyValueRow label="Matching contract version" value={CONTRACT_VERSION} />
          <Divider />
          <NavRow
            label="Check the matching engine"
            detail="Runs the matching contract on this device and reports what disagrees."
            onPress={() => void checkEngine()}
          />
        </Card>
      </Section>
    </Screen>
  );
}
