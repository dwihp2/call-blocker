import { Platform } from 'react-native';

import { AppText, Card, Screen, Section } from '@/ui/components';

/**
 * The plain-words explanation of how blocking works, reachable from Settings.
 *
 * It states the two halves honestly: what the app does (Rules become the list
 * the phone holds) and what the phone decides on its own (its precedence rules,
 * the switch only a person can flip, and how long a change takes to settle).
 * The mechanics behind each sentence are in `docs/ios-lifecycle.md`.
 */
export default function HowItWorksScreen() {
  const ios = Platform.OS === 'ios';
  const android = Platform.OS === 'android';

  return (
    <Screen>
      <Section title="Rules become a list">
        <Card>
          <AppText>
            You register Rules: a single number, a Prefix, or an Interval, as Block or Allow. The
            app turns them into the list of numbers the phone should block. Allow rules and the
            Contacts allowance take numbers back out of that list, and what is left is the list
            that acts.
          </AppText>
          <AppText>
            The phone blocks one number at a time, so Prefixes and Intervals are expanded into
            every number they cover before the list is saved.
          </AppText>
        </Card>
      </Section>

      <Section title="The phone does the blocking">
        <Card>
          <AppText>
            The app hands the list to the phone's call blocking and keeps it there. The blocking
            itself happens in the phone, not in the app, so your Rules keep working when the app
            is closed.
          </AppText>
          {ios ? (
            <AppText>
              A call is checked against the list as it arrives. A number on the list is sent to
              voicemail without ringing, and it usually does not appear in the call history.
            </AppText>
          ) : null}
          {android ? (
            <AppText>
              A call is checked against the list as it arrives. A number on the list is rejected,
              and it stays in the call history without ringing.
            </AppText>
          ) : null}
        </Card>
      </Section>

      <Section
        title="What only you can switch on"
        description="No app is allowed to switch these on for you.">
        <Card>
          {ios ? (
            <AppText>
              Turn Call Blocker on under Settings › Phone › Call Blocking & Identification. iOS
              turns it off whenever the app is reinstalled, and the app cannot turn it back on.
            </AppText>
          ) : null}
          {android ? (
            <AppText>
              Grant the call screening role, which Android asks you for the first time the app
              saves a Rule.
            </AppText>
          ) : null}
          <AppText>
            A change takes about a minute to reach the phone's list. A call in that moment can
            still get through.
          </AppText>
        </Card>
      </Section>

      {ios ? (
        <Section
          title="If a blocked number still rings"
          description="The phone applies its own rules before it looks at any app's list.">
          <Card>
            <AppText>• A number saved in your contacts is never blocked.</AppText>
            <AppText>
              • A number you called from this iPhone keeps ringing until you delete it from the
              call history in the Phone app.
            </AppText>
            <AppText>
              • Check that Call Blocker is on under Settings › Phone › Call Blocking &
              Identification.
            </AppText>
            <AppText>• After a change, wait about a minute and try again.</AppText>
          </Card>
        </Section>
      ) : null}

      <Section title="Capacity">
        <Card>
          <AppText>
            The iPhone can hold a limited number of numbers in its blocking list. When a change
            would need more than it holds, the app refuses the change and tells you the count.
            Your Rules are never trimmed silently.
          </AppText>
        </Card>
      </Section>

      <Section title="Your data stays on the phone">
        <Card>
          <AppText>
            Your Rules and the block list are stored on this phone alone. There is no account, no
            sync, and no server.
          </AppText>
        </Card>
      </Section>
    </Screen>
  );
}
