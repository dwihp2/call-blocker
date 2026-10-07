import { parseRuleInput } from '@call-blocker/core';
import type { DecisionSource, E164, MatchResult, RegionCode, Rule } from '@call-blocker/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { checkNumber, EngineUnavailableError, isSupported, UNSUPPORTED_DETAIL } from '@/data/engine';
import { shadowedIds } from '@/data/overlap';
import { useStore } from '@/data/store';
import { describeError, formatDate, kindLabel, patternText } from '@/format';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  Row,
  Screen,
  Section,
  TextField,
} from '@/ui/components';
import { RegionPicker } from '@/ui/region-picker';
import { Spacing } from '@/ui/theme';

/** The Rule a decision came from, plus every Rule the number also matches. */
interface CheckOutcome {
  query: E164;
  result: MatchResult;
  rules: Rule[];
}

/** Names the Rule a decision came from, or the settings reason when none did. */
function reasonText(source: DecisionSource, rules: Rule[], region: RegionCode): string {
  if (source.type === 'off') return 'Blocking is off, so no calls are blocked.';
  if (source.type === 'none') return 'No Rule matches this number.';
  const rule = rules[source.index];
  if (!rule) return 'No Rule matches this number.';
  const label = rule.label ? ` (${rule.label})` : '';
  return `The ${kindLabel(rule.kind)} rule ${patternText(rule, region)}${label} decides this number.`;
}

export default function CheckScreen() {
  const { state } = useStore();
  const supported = isSupported();

  const [text, setText] = useState('');
  const [region, setRegion] = useState<RegionCode>(state.settings.defaultRegion);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<E164 | null>(null);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  const run = async () => {
    const parsed = parseRuleInput({ text, pattern: 'single', region });
    if (!parsed.ok) {
      setFailure(parsed.message);
      setOutcome(null);
      return;
    }
    setFailure(null);
    setEngineError(null);
    setOutcome(null);
    setChecking(parsed.value.number);
    setBusy(true);
    try {
      const next = await checkNumber(parsed.value.number);
      setOutcome({ query: parsed.value.number, result: next.result, rules: next.rules });
    } catch (reason) {
      if (reason instanceof EngineUnavailableError) {
        setEngineError(reason.message);
      } else {
        setEngineError(describeError(reason));
      }
    } finally {
      setBusy(false);
      setChecking(null);
    }
  };

  const decidingRule =
    outcome && outcome.result.decidedBy.type === 'rule' ? outcome.rules[outcome.result.decidedBy.index] : undefined;
  const decidingIndex = outcome && outcome.result.decidedBy.type === 'rule' ? outcome.result.decidedBy.index : null;
  const shadowed = shadowedIds(outcome ? outcome.rules : []);
  const otherMatches = outcome
    ? outcome.result.matches
        .filter((index) => index !== decidingIndex)
        .map((index) => outcome.rules[index])
        .filter((rule): rule is Rule => rule !== undefined)
    : [];

  return (
    <Screen>
      {!supported ? (
        <Banner
          tone="info"
          title="This device cannot block calls"
          message={`${UNSUPPORTED_DETAIL} A Number check can only run where the rules are in force.`}
        />
      ) : null}

      <Section title="Number to check" description="The number you type can be in any format.">
        <TextField
          label="Number"
          hint="Type the number in any format: 0812 3456 789 or +628123456789."
          value={text}
          onChangeText={setText}
          autoCorrect={false}
          keyboardType="phone-pad"
          placeholder="+628123456789"
        />
        <RegionPicker value={region} onChange={setRegion} />
        <AppText variant="small" tone="secondary">
          The Region above is the one used to read the number you typed.
        </AppText>
      </Section>

      <Button label="Check number" onPress={() => void run()} busy={busy} disabled={!supported} />

      {busy && checking ? (
        <Row gap={Spacing.two}>
          <AppText variant="mono">{checking}</AppText>
          <AppText variant="small" tone="secondary">
            Checking this number…
          </AppText>
        </Row>
      ) : null}

      {failure ? (
        <Banner tone="danger" title="That number cannot be read" message={failure} />
      ) : null}

      {engineError ? (
        <Banner tone="danger" title="The Number check could not run" message={engineError} />
      ) : null}

      {outcome ? (
        <>
          <Section title="Decision">
            <Card>
              <AppText variant="mono">{patternText({ pattern: 'single', number: outcome.query }, region)}</AppText>
              <AppText variant="heading" tone={outcome.result.blocked ? 'danger' : 'success'}>
                {outcome.result.blocked ? 'This number is blocked.' : 'This number is not blocked.'}
              </AppText>
              <AppText>{reasonText(outcome.result.decidedBy, outcome.rules, region)}</AppText>
            </Card>
          </Section>

          {decidingRule ? (
            <Section title="Deciding Rule">
              <Card>
                <AppText variant="mono">{patternText(decidingRule, region)}</AppText>
                <AppText variant="small" tone="secondary">
                  {`${kindLabel(decidingRule.kind)} · added ${formatDate(decidingRule.createdAt)}`}
                </AppText>
                {decidingRule.label ? <AppText variant="small">{decidingRule.label}</AppText> : null}
              </Card>
            </Section>
          ) : null}

          <Section
            title="Other matching Rules"
            description="Rules marked as never firing are covered by Rules that win over them, so they can never be the Rule a decision comes from.">
            {otherMatches.length === 0 ? (
              <Card>
                <AppText tone="secondary">No other Rule matches this number.</AppText>
              </Card>
            ) : (
              <Card>
                {otherMatches.map((rule, index) => (
                  <View key={rule.id}>
                    {index > 0 ? <Divider /> : null}
                    <View style={styles.match}>
                      <AppText variant="mono">{patternText(rule, region)}</AppText>
                      <AppText variant="small" tone="secondary">
                        {`${kindLabel(rule.kind)} · added ${formatDate(rule.createdAt)}`}
                      </AppText>
                      {rule.label ? <AppText variant="small">{rule.label}</AppText> : null}
                      {shadowed.has(rule.id) ? (
                        <AppText variant="small" tone="warning">
                          Never fires
                        </AppText>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Card>
            )}
          </Section>
        </>
      ) : null}

      <Section title="How a decision is made">
        <Card>
          <AppText variant="small">
            An Allow rule wins over a Block rule wherever they meet, whatever their size.
          </AppText>
          <AppText variant="small">
            This app never reads your contacts, so nothing saved there changes a decision.
          </AppText>
          <AppText variant="small">
            When Blocking is off, nothing is blocked, but the Rules stay saved.
          </AppText>
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  match: { gap: Spacing.one },
});
