import { parseRuleInput } from '@call-blocker/core';
import type { PatternType, RegionCode, RuleInput, RuleKind } from '@call-blocker/core';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { deleteRule, registerRule, updateRule } from '@/data/actions';
import { registrationWarnings } from '@/data/overlap';
import { applyRuleInput, createRule, useStore } from '@/data/store';
import { formatCount, kindLabel, patternText } from '@/format';
import {
  AppText,
  Banner,
  Button,
  Card,
  Screen,
  Section,
  Segmented,
  TextField,
  ToggleRow,
} from '@/ui/components';
import { RegionPicker } from '@/ui/region-picker';
import { Spacing } from '@/ui/theme';

const PATTERNS: ReadonlyArray<{ value: PatternType; label: string }> = [
  { value: 'single', label: 'Single number' },
  { value: 'prefix', label: 'Prefix' },
  { value: 'interval', label: 'Interval' },
];

const PATTERN_HELP: Record<PatternType, { label: string; hint: string }> = {
  single: { label: 'Number', hint: 'One number, typed in any format: 0812 3456 789 or +628123456789.' },
  prefix: { label: 'Prefix digits', hint: 'Every number that begins with these digits: 0812 or +62812.' },
  interval: {
    label: 'Start and end',
    hint: 'Every number between the two, inclusive: 6281100-6281199. Separate them with a dash.',
  },
};

function seedText(rule: { pattern: PatternType; number: string; end?: string }): string {
  return rule.pattern === 'interval' ? `${rule.number}-${rule.end ?? ''}` : rule.number;
}

export default function RegisterScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state } = useStore();
  const editing = id ? state.rules.find((rule) => rule.id === id) ?? null : null;

  const [kind, setKind] = useState<RuleKind>(editing?.kind ?? 'block');
  const [pattern, setPattern] = useState<PatternType>(editing?.pattern ?? 'single');
  const [text, setText] = useState(editing ? seedText(editing) : '');
  const [region, setRegion] = useState<RegionCode>(state.settings.defaultRegion);
  const [label, setLabel] = useState(editing?.label ?? '');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** The canonical number the person has confirmed for a broad Prefix. */
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const parsed = useMemo(
    () => (text.trim().length === 0 ? null : parseRuleInput({ text, pattern, region })),
    [text, pattern, region],
  );

  const candidate = useMemo(() => {
    if (!parsed?.ok) return null;
    const input: RuleInput = {
      kind,
      pattern: parsed.value.pattern,
      number: parsed.value.number,
    };
    if (parsed.value.end !== undefined) input.end = parsed.value.end;
    if (label.trim().length > 0) input.label = label.trim();
    return editing ? applyRuleInput(editing, input) : createRule(input);
  }, [parsed, kind, label, editing]);

  const warnings = useMemo(
    () => (candidate ? registrationWarnings(state.rules, candidate) : null),
    [candidate, state.rules],
  );

  const save = async () => {
    if (!parsed?.ok) return;
    const input: RuleInput = { kind, pattern: parsed.value.pattern, number: parsed.value.number };
    if (parsed.value.end !== undefined) input.end = parsed.value.end;
    if (label.trim().length > 0) input.label = label.trim();
    setBusy(true);
    setRefusal(null);
    const outcome = editing ? await updateRule(editing.id, input) : await registerRule(input);
    setBusy(false);
    if (outcome.ok) {
      router.back();
      return;
    }
    setRefusal(outcome.message);
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await deleteRule(editing.id);
    setBusy(false);
    if (outcome.ok) {
      router.back();
      return;
    }
    setRefusal(outcome.message);
  };

  const help = PATTERN_HELP[pattern];
  /** The parse result when a Prefix is broad enough to need an explicit confirmation. */
  const broadValue = parsed?.ok === true && parsed.value.needsConfirmation ? parsed.value : null;
  const broadConfirmed = broadValue !== null && confirmed === broadValue.number;
  const candidateShadowed = candidate !== null && warnings?.shadowed.some((rule) => rule.id === candidate.id) === true;
  const otherShadowed = warnings ? warnings.shadowed.filter((rule) => rule.id !== candidate?.id) : [];

  return (
    <Screen>
      <Stack.Screen options={{ title: editing ? 'Edit Rule' : 'Register a Rule' }} />
      <Section title="Rule">
        <Segmented<RuleKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'block', label: 'Block' },
            { value: 'allow', label: 'Allow' },
          ]}
        />
        <AppText variant="small" tone="secondary">
          {kind === 'block'
            ? 'A Block rule stops matching callers from reaching you.'
            : 'An Allow rule lets matching callers through even when a Block rule would stop them.'}
        </AppText>
      </Section>

      <Section title="Number pattern">
        <Segmented<PatternType> value={pattern} onChange={setPattern} options={PATTERNS} />
        <TextField
          label={help.label}
          hint={help.hint}
          value={text}
          onChangeText={setText}
          autoFocus={editing === null}
          autoCorrect={false}
          keyboardType={pattern === 'interval' && Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'phone-pad'}
          placeholder={pattern === 'interval' ? '6281100-6281199' : '+628123456789'}
        />
        <RegionPicker value={region} onChange={setRegion} />
      </Section>

      <Section title="Canonical result">
        {!parsed ? (
          <Card>
            <AppText tone="secondary">Type a number, a prefix, or an interval to see how it is read.</AppText>
          </Card>
        ) : parsed.ok ? (
          <Card>
            <AppText variant="mono">{parsed.value.display}</AppText>
            <AppText variant="small" tone="secondary">
              {parsed.value.pattern === 'single'
                ? 'Matches this one number.'
                : `Matches about ${formatCount(parsed.value.approxMatches)} numbers.`}
            </AppText>
          </Card>
        ) : (
          <Banner tone="danger" title="That input cannot be read" message={parsed.message} />
        )}
      </Section>

      <Section title="Label (optional)">
        <TextField
          hint="A short note to remember why this Rule exists."
          value={label}
          onChangeText={setLabel}
          maxLength={80}
          placeholder="Debt collector"
        />
      </Section>

      {warnings && warnings.overlaps.length > 0 ? (
        <Banner
          tone="warning"
          title={warnings.overlaps.length === 1 ? 'Overlap with an existing Rule' : 'Overlaps with existing Rules'}
          message={`${warnings.overlaps.map((rule) => `${patternText(rule, region)} (${kindLabel(rule.kind)})`).join(', ')} ${
            warnings.overlaps.length === 1 ? 'matches numbers this Rule matches' : 'match numbers this Rule matches'
          }. An Allow rule prevails over a Block rule wherever they meet.`}
        />
      ) : null}

      {candidateShadowed ? (
        <Banner
          tone="warning"
          title="Shadowed Rule"
          message="This Rule can never fire: the Rules that win over it already cover every number it matches."
        />
      ) : null}

      {otherShadowed.length > 0 ? (
        <Banner
          tone="warning"
          title={otherShadowed.length === 1 ? 'This Rule shadows another' : 'This Rule shadows others'}
          message={`${otherShadowed
            .map((rule) => `${patternText(rule, region)} (${kindLabel(rule.kind)})`)
            .join(', ')} can never fire: every number ${
            otherShadowed.length === 1 ? 'it matches is' : 'they match is'
          } covered by Rules that win over ${otherShadowed.length === 1 ? 'it' : 'them'}.`}
        />
      ) : null}

      {refusal ? <Banner tone="danger" title="The Rule was refused" message={refusal} /> : null}

      {broadValue ? (
        <>
          <Banner
            tone="warning"
            title="This Prefix is broad"
            message={`A Prefix with fewer than four digits after the country code covers a very large number of numbers, about ${formatCount(
              broadValue.approxMatches,
            )}. Register it only if you mean to cover all of them.`}
          />
          <ToggleRow
            label="Yes, this Prefix is what I want"
            description="This Rule will match a very large number of numbers."
            value={broadConfirmed}
            onValueChange={(next) => setConfirmed(next ? broadValue.number : null)}
          />
        </>
      ) : null}

      <Button
        label={editing ? 'Save changes' : 'Save Rule'}
        onPress={() => void save()}
        disabled={!parsed?.ok || (broadValue !== null && !broadConfirmed)}
        busy={busy}
      />

      {editing ? (
        <Button label="Delete Rule" variant="danger" onPress={() => void remove()} busy={busy} />
      ) : null}

      <AppText variant="small" tone="secondary">
        {editing
          ? 'Saving replaces this Rule in place; the date it was added stays.'
          : 'A Registration is refused whole if it would push the iPhone past its Capacity, and nothing is saved.'}
      </AppText>
    </Screen>
  );
}

