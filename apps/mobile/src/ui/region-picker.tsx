import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RegionCode } from '@call-blocker/core';

import { REGIONS, regionName } from '@/data/regions';

import { AppText, Button, Row } from './components';
import { Spacing, useAppTheme } from './theme';

/**
 * The country a typed number is read in. The Default region seeds it; a
 * Registration or a Bulk import can use a different one for that one run.
 */
export function RegionPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: RegionCode;
  onChange: (next: RegionCode) => void;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const known = REGIONS.some((region) => region.code === value);
  return (
    <View style={styles.container}>
      <Row justify="space-between">
        <AppText variant="smallBold">Region</AppText>
        <Button label="Change" variant="secondary" onPress={() => setOpen(true)} disabled={disabled} style={styles.change} />
      </Row>
      <AppText variant="small" tone="secondary">
        {`Numbers are read as ${regionName(value)} (${value}) numbers${known ? '' : ', from the device locale'}.`}
      </AppText>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modal, { backgroundColor: theme.background, paddingTop: insets.top + Spacing.three }]}>
          <AppText variant="heading">Region</AppText>
          <AppText variant="small" tone="secondary">
            The Default region interprets numbers typed in local format.
          </AppText>
          <ScrollView contentContainerStyle={styles.list}>
            {REGIONS.map((region) => (
              <Pressable
                key={region.code}
                accessibilityRole="button"
                accessibilityState={{ selected: region.code === value }}
                onPress={() => {
                  onChange(region.code);
                  setOpen(false);
                }}
                style={[styles.option, { borderColor: theme.border }]}>
                <AppText>{region.name}</AppText>
                <AppText variant="small" tone={region.code === value ? 'accent' : 'secondary'}>
                  {region.code}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
          <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  change: { minHeight: 32, paddingVertical: 0 },
  modal: { flex: 1, paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.four },
  list: { gap: Spacing.one, paddingVertical: Spacing.two },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
