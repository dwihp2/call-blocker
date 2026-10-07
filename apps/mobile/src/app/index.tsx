import type { EngineStatus, Rule, RuleKind, SyncResult } from '@call-blocker/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Dimensions, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { deleteRule, setBlocking, setRuleEnabled } from '@/data/actions';
import { getStatus, isSupported, previewBlockList, UNSUPPORTED_DETAIL } from '@/data/engine';
import { useStore } from '@/data/store';
import { formatCount, formatDate, kindLabel, patternText } from '@/format';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  MenuSheet,
  Meter,
  Screen,
  Segmented,
  ToggleRow,
} from '@/ui/components';
import { Spacing, useAppTheme } from '@/ui/theme';

const EMPTY_MESSAGE: Record<RuleKind, string> = {
  block:
    'A Rule tells the app which callers to stop: a single number, a prefix like +62812*, or an interval of numbers.',
  allow:
    'An Allow rule lets matching callers through even when a Block rule would stop them.',
};

/**
 * The Rule list scrolls inside its Card instead of stretching the page: half
 * the window, so the Blocking switch and the list header stay in view however
 * many Rules there are.
 */
const LIST_MAX_HEIGHT = Dimensions.get('window').height * 0.5;

export default function RulesScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { state, error } = useStore();
  const [filter, setFilter] = useState<RuleKind>('block');
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [cost, setCost] = useState<SyncResult | null>(null);
  const [menuRule, setMenuRule] = useState<Rule | null>(null);
  const supported = isSupported();
  const { rules, settings } = state;

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const [nextStatus, nextCost] = await Promise.all([getStatus(), previewBlockList()]);
        if (!live) return;
        setStatus(nextStatus);
        setCost(nextCost);
      })();
      return () => {
        live = false;
      };
    }, [rules]),
  );

  const shown = rules.filter((rule) => rule.kind === filter);
  const counts = {
    block: rules.filter((rule) => rule.kind === 'block').length,
    allow: rules.filter((rule) => rule.kind === 'allow').length,
  };

  const toggleBlocking = async (blocking: boolean) => {
    const outcome = await setBlocking(blocking);
    if (!outcome.ok) Alert.alert('Blocking was not changed', outcome.message);
    setStatus(await getStatus());
  };

  const remove = async (rule: Rule) => {
    const outcome = await deleteRule(rule.id);
    if (!outcome.ok) Alert.alert('The Rule was not deleted', outcome.message);
  };

  const toggleRule = async (rule: Rule, enabled: boolean) => {
    const outcome = await setRuleEnabled(rule.id, enabled);
    if (!outcome.ok) {
      Alert.alert(enabled ? 'The Rule was not turned on' : 'The Rule was not turned off', outcome.message);
    }
  };

  return (
    <Screen>
      {error ? <Banner tone="danger" title="Saved state problem" message={error} /> : null}

      {supported ? (
        status && !status.active ? (
          <Banner
            tone="warning"
            title="Protection is not active"
            message={
              Platform.OS === 'ios'
                ? 'No calls are being blocked. Turn Call Blocker on in Settings › Phone › Call Blocking & Identification.'
                : 'No calls are being blocked. Turn the call screening role on in Settings › Apps.'
            }
            actionLabel="Open Protection status"
            onPress={() => router.push('/protection')}
          />
        ) : null
      ) : (
        <Banner
          tone="info"
          title="This device cannot block calls"
          message={`${UNSUPPORTED_DETAIL} Rules you register here are kept, but nothing on this device acts on them.`}
        />
      )}

      <Card>
        <ToggleRow
          label="Blocking"
          description="When off, no calls are blocked. Your Rules stay saved."
          value={settings.blocking}
          onValueChange={(next) => void toggleBlocking(next)}
        />
        {cost ? (
          <>
            <Divider />
            <Meter
              value={cost.entries}
              max={cost.capacity}
              caption={`${formatCount(cost.entries)} of ${formatCount(cost.capacity)} numbers in the iPhone's blocking list`}
            />
          </>
        ) : null}
      </Card>

      <Segmented<RuleKind>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'block', label: 'Block list', detail: `${counts.block}` },
          { value: 'allow', label: 'Allow list', detail: `${counts.allow}` },
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState
          title={filter === 'block' ? 'No Block rules yet' : 'No Allow rules yet'}
          message={EMPTY_MESSAGE[filter]}>
          <Button label="Register a Rule" onPress={() => router.push('/register')} />
        </EmptyState>
      ) : (
        <Card style={styles.list}>
          <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent} nestedScrollEnabled>
            {shown.map((rule, index) => (
              <View key={rule.id}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.ruleRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityHint="Opens this Rule for editing. Touch and hold to delete it."
                    onPress={() => router.push({ pathname: '/register', params: { id: rule.id } })}
                    onLongPress={() => setMenuRule(rule)}
                    style={[styles.ruleDetails, rule.enabled ? null : styles.ruleOff]}>
                    <AppText variant="mono">{patternText(rule, settings.defaultRegion)}</AppText>
                    <AppText variant="small" tone="secondary">
                      {`${kindLabel(rule.kind)} · added ${formatDate(rule.createdAt)}`}
                    </AppText>
                    {rule.label ? <AppText variant="small">{rule.label}</AppText> : null}
                  </Pressable>
                  <Switch
                    style={styles.ruleSwitch}
                    value={rule.enabled}
                    onValueChange={(next) => void toggleRule(rule, next)}
                    accessibilityLabel={rule.enabled ? 'Turn this Rule off' : 'Turn this Rule on'}
                  />
                </View>
              </View>
            ))}
          </ScrollView>
        </Card>
      )}

      <View style={styles.actions}>
        <Button
          label="Bulk import"
          variant="secondary"
          onPress={() => router.push('/bulk-import')}
          style={styles.action}
        />
        <Button label="Number check" variant="secondary" onPress={() => router.push('/check')} style={styles.action} />
      </View>

      <AppText variant="small" tone="secondary" style={{ color: theme.secondaryText }}>
        Rules are saved on this device. The Allow list always wins over the Block list.
      </AppText>

      <MenuSheet
        visible={menuRule !== null}
        title={menuRule ? patternText(menuRule, settings.defaultRegion) : undefined}
        onClose={() => setMenuRule(null)}
        options={[
          {
            label: 'Edit',
            onPress: () => {
              if (menuRule) router.push({ pathname: '/register', params: { id: menuRule.id } });
            },
          },
          {
            label: 'Delete',
            destructive: true,
            onPress: () => {
              if (menuRule) void remove(menuRule);
            },
          },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0, paddingVertical: 0, overflow: 'hidden' },
  listScroll: { maxHeight: LIST_MAX_HEIGHT },
  listContent: {
    // Air above the first row and below the last, so a switch never sits on the
    // Card's edge or on the divider above it.
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    // A lane for the scroll indicator, so it does not draw over the switches.
    paddingRight: Spacing.three,
  },
  // Smaller than the Settings switches: a touch smaller reads better repeated
  // down a list. The layout box stays standard, so the touch target does too.
  ruleSwitch: { transform: [{ scale: 0.8 }] },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  ruleDetails: {
    flex: 1,
    gap: Spacing.half,
    minHeight: 56,
    paddingVertical: Spacing.two,
    justifyContent: 'center',
  },
  ruleOff: { opacity: 0.55 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
