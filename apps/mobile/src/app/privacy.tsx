import { Fragment, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { declaredAccess } from '@/data/engine';
import { AppText, Card, Divider, KeyValueRow, Screen, Section } from '@/ui/components';

/**
 * What this app asks the platform for, and what it never does (ADR 0006).
 *
 * The list is not maintained here: it is read back from the platform — Android's
 * requested permissions, iOS's declared usage reasons — so the screen shows what
 * the system itself would show, and a permission that creeps in through a
 * dependency appears here rather than hiding in a build file.
 */

/** Plain words for the declarations worth naming; anything else shows its raw key. */
const LABELS: Record<string, string> = {
  'android.permission.INTERNET': 'Internet',
  'android.permission.ACCESS_NETWORK_STATE': 'Network state',
  'android.permission.VIBRATE': 'Vibrate',
  'android.permission.SYSTEM_ALERT_WINDOW': 'Display over other apps',
  'android.permission.READ_EXTERNAL_STORAGE': 'Files — read',
  'android.permission.WRITE_EXTERNAL_STORAGE': 'Files — write',
};

type Access = string[] | 'reading' | 'unreadable' | 'unsupported';

export default function PrivacyScreen() {
  const [access, setAccess] = useState<Access>('reading');
  const ios = Platform.OS === 'ios';
  const android = Platform.OS === 'android';

  useEffect(() => {
    let live = true;
    declaredAccess()
      .then((list) => {
        if (live) setAccess(list ?? 'unsupported');
      })
      .catch(() => {
        if (live) setAccess('unreadable');
      });
    return () => {
      live = false;
    };
  }, []);

  const declared = Array.isArray(access) ? access : [];
  // Only the framework's permissions are shown. A library can also define a
  // permission for itself — AndroidX's receiver guard is one — which is not
  // something a person grants, so it is counted rather than listed.
  const listed = android ? declared.filter((key) => key.startsWith('android.permission.')) : declared;
  const internal = declared.length - listed.length;
  // Each row names a declaration twice: in plain words, and in the platform's
  // own name for it. When both would be the same word, it is shown once.
  const rows = listed.map((key) => {
    const name = key.replace('android.permission.', '').replace(/^NS(.+)UsageDescription$/, '$1');
    const label = LABELS[key] ?? name;
    return { key, label, value: label === name ? '' : name };
  });
  // A development build loads its JavaScript from the computer, which needs the
  // Internet permission; a release build has none.
  const development = declared.includes('android.permission.INTERNET');

  return (
    <Screen>
      <Section
        title="What this app asks for"
        description="Read from this device, not from a list in the app.">
        <Card>
          {access === 'reading' ? <AppText>Asking the system…</AppText> : null}
          {access === 'unreadable' ? (
            <AppText>The system did not report its list on this device.</AppText>
          ) : null}
          {access === 'unsupported' ? (
            <AppText>This device has no call blocking to ask about.</AppText>
          ) : null}
          {Array.isArray(access)
            ? rows.map((row, index) => (
                <Fragment key={row.key}>
                  {index > 0 ? <Divider /> : null}
                  <KeyValueRow label={row.label} value={row.value} />
                </Fragment>
              ))
            : null}
          {Array.isArray(access) && listed.length === 0 ? (
            <AppText>Nothing. This build asks the system for nothing at all.</AppText>
          ) : null}
          {internal > 0 ? (
            <AppText variant="small" tone="secondary">
              {internal === 1 ? 'One entry is left out' : `${internal} entries are left out`}: a
              permission a library declares for itself, which nobody grants.
            </AppText>
          ) : null}
          {android ? (
            <AppText variant="small" tone="secondary">
              This is the same list Android shows under Settings › Apps › Call Blocker ›
              Permissions.
            </AppText>
          ) : null}
          {ios ? (
            <AppText variant="small" tone="secondary">
              These are the reason strings in the app's own properties file — what iOS shows when
              it asks you for something.
            </AppText>
          ) : null}
          {development ? (
            <AppText variant="small" tone="secondary">
              This is a development build: it carries the Internet permission to load the app
              from the computer. A release build has no Internet permission at all.
            </AppText>
          ) : null}
        </Card>
      </Section>

      <Section title="What it never does">
        <Card>
          <AppText>• No account, no sign-in, no profile.</AppText>
          <AppText>• No analytics and no crash reporting — nothing is sent anywhere.</AppText>
          <AppText>
            • No server: your Rules and the block list are this phone's, and the blocking happens
            in the phone.
          </AppText>
          <AppText>• No access to your contacts — the app never asks for them.</AppText>
          {android && !development ? (
            <AppText>
              • No Internet permission, so this app could not send anything even if it tried.
            </AppText>
          ) : null}
          {ios ? (
            <AppText>
              • Nothing in the shipping app talks to a network; only a development build, which
              loads from the computer you develop on.
            </AppText>
          ) : null}
        </Card>
      </Section>

      <Section title="Where your data lives">
        <Card>
          <AppText>
            Rules, settings and the block list live on this phone, in the app's own storage. The
            phone's blocking list is the phone's, not a copy on a server.
          </AppText>
          <AppText>
            A Backup file is written only when you ask for one, and it is a file you keep.
          </AppText>
        </Card>
      </Section>

      <Section title="How to check for yourself">
        <Card>
          {android ? (
            <AppText>
              Settings › Apps › Call Blocker › Permissions lists the same permissions this screen
              does.
            </AppText>
          ) : null}
          {ios ? (
            <AppText>
              Settings › Privacy & Security lists what each app has asked for. This one asks for
              nothing.
            </AppText>
          ) : null}
          <AppText>
            Number check and the matching-engine check in Settings show what the app would do with
            a number without waiting for a call.
          </AppText>
        </Card>
      </Section>
    </Screen>
  );
}
