import type { EngineStatus, Rule, RuleKind, SyncResult } from '@call-blocker/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { deleteRule, setBlocking } from '@/data/actions';
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
    'An Allow rule lets matching callers through even when a Block rule would stop them. It does not include Contacts allowance.',
};

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
          {shown.map((rule, index) => (
            <View key={rule.id}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Opens this Rule for editing. Touch and hold to delete it."
                onPress={() => router.push({ pathname: '/register', params: { id: rule.id } })}
                onLongPress={() => setMenuRule(rule)}
                style={styles.ruleRow}>
                <AppText variant="mono">{patternText(rule, settings.defaultRegion)}</AppText>
                <AppText variant="small" tone="secondary">
                  {`${kindLabel(rule.kind)} · added ${formatDate(rule.createdAt)}`}
                </AppText>
                {rule.label ? <AppText variant="small">{rule.label}</AppText> : null}
              </Pressable>
            </View>
          ))}
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
  list: { gap: 0, paddingVertical: 0 },
  ruleRow: {
    gap: Spacing.half,
    minHeight: 56,
    paddingVertical: Spacing.two,
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
