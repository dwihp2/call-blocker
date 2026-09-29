/**
 * The app's small component set: plain React Native views styled with
 * StyleSheet, so every screen looks the same without a UI dependency.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Spacing, useAppTheme, type AppTheme } from './theme';

export type Tone = 'default' | 'secondary' | 'accent' | 'danger' | 'success' | 'warning' | 'onAccent';

function toneColour(theme: AppTheme, tone: Tone): string {
  switch (tone) {
    case 'secondary':
      return theme.secondaryText;
    case 'accent':
      return theme.accent;
    case 'danger':
      return theme.danger;
    case 'success':
      return theme.success;
    case 'warning':
      return theme.warning;
    case 'onAccent':
      return theme.onAccent;
    default:
      return theme.text;
  }
}

export type TextVariant = 'title' | 'heading' | 'body' | 'small' | 'smallBold' | 'mono';

export function AppText({
  variant = 'body',
  tone = 'default',
  style,
  children,
  ...rest
}: TextProps & { variant?: TextVariant; tone?: Tone }) {
  const theme = useAppTheme();
  return (
    <Text style={[{ color: toneColour(theme, tone) }, variantStyles[variant], style]} {...rest}>
      {children}
    </Text>
  );
}

export function Screen({
  children,
  footer,
  topInset = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  /** A screen drawn without a navigation header starts below the status bar. */
  topInset?: boolean;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.screenContent,
          {
            paddingBottom: insets.bottom + Spacing.five,
            ...(topInset ? { paddingTop: insets.top + Spacing.three } : {}),
          },
        ]}
        keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]}>{children}</View>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <AppText variant="heading">{title}</AppText>
      {description ? (
        <AppText variant="small" tone="secondary">
          {description}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

export function Row({
  children,
  style,
  gap = Spacing.two,
  align = 'center',
  justify = 'flex-start',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
}) {
  return <View style={[styles.row, { gap, alignItems: align, justifyContent: justify }, style]}>{children}</View>;
}

export function Divider() {
  const theme = useAppTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  const background = variant === 'primary' ? theme.accent : variant === 'danger' ? theme.dangerSoft : theme.backgroundElement;
  const colour = variant === 'primary' ? theme.onAccent : variant === 'danger' ? theme.danger : theme.text;
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: inactive ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}>
      {busy ? <ActivityIndicator size="small" color={colour} /> : null}
      <Text style={[styles.buttonLabel, { color: colour }]}>{label}</Text>
    </Pressable>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              selected && { backgroundColor: theme.card, borderColor: theme.border },
              disabled && { opacity: 0.45 },
            ]}>
            <AppText variant="small" tone={selected ? 'default' : 'secondary'}>
              {option.detail ? `${option.label} (${option.detail})` : option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Banner({
  tone = 'warning',
  title,
  message,
  actionLabel,
  onPress,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  message?: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  const theme = useAppTheme();
  const background =
    tone === 'danger' ? theme.dangerSoft : tone === 'success' ? theme.successSoft : tone === 'info' ? theme.accentSoft : theme.warningSoft;
  const colour = tone === 'danger' ? theme.danger : tone === 'success' ? theme.success : tone === 'info' ? theme.accent : theme.warning;
  const body = (
    <>
      <AppText variant="smallBold" style={{ color: colour }}>
        {title}
      </AppText>
      {message ? <AppText variant="small">{message}</AppText> : null}
      {actionLabel ? (
        <AppText variant="smallBold" tone="accent">
          {actionLabel}
        </AppText>
      ) : null}
    </>
  );
  if (!onPress) {
    return <View style={[styles.banner, { backgroundColor: background }]}>{body}</View>;
  }
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.banner, { backgroundColor: background }]}>
      {body}
    </Pressable>
  );
}

export function TextField({
  label,
  hint,
  style,
  ...rest
}: TextInputProps & { label?: string; hint?: string }) {
  const theme = useAppTheme();
  return (
    <View style={styles.field}>
      {label ? <AppText variant="smallBold">{label}</AppText> : null}
      <TextInput
        placeholderTextColor={theme.secondaryText}
        style={[
          styles.input,
          { backgroundColor: theme.card, borderColor: theme.border, color: theme.text },
          style,
        ]}
        {...rest}
      />
      {hint ? (
        <AppText variant="small" tone="secondary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Row justify="space-between" align="center" style={styles.toggleRow}>
      <View style={styles.toggleLabel}>
        <AppText>{label}</AppText>
        {description ? (
          <AppText variant="small" tone="secondary">
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </Row>
  );
}

export function KeyValueRow({ label, value, tone = 'secondary' }: { label: string; value: string; tone?: Tone }) {
  return (
    <Row justify="space-between" align="flex-start" style={styles.keyValue}>
      <AppText variant="small" tone="secondary" style={styles.keyValueLabel}>
        {label}
      </AppText>
      <AppText variant="small" tone={tone} style={styles.keyValueValue}>
        {value}
      </AppText>
    </Row>
  );
}

export function StatusRow({
  label,
  detail,
  state,
  actionLabel,
  onAction,
}: {
  label: string;
  detail?: string;
  state: 'on' | 'off' | 'attention';
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useAppTheme();
  const colour = state === 'on' ? theme.success : state === 'attention' ? theme.warning : theme.secondaryText;
  const text = state === 'on' ? 'On' : state === 'attention' ? 'Needs attention' : 'Off';
  return (
    <View style={styles.statusRow}>
      <Row justify="space-between" align="center">
        <Row gap={Spacing.two}>
          <View style={[styles.statusDot, { backgroundColor: colour }]} />
          <AppText>{label}</AppText>
        </Row>
        <AppText variant="small" tone="secondary">
          {text}
        </AppText>
      </Row>
      {detail ? (
        <AppText variant="small" tone="secondary">
          {detail}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" style={styles.statusAction} /> : null}
    </View>
  );
}

export function Meter({ value, max, caption }: { value: number; max: number; caption: string }) {
  const theme = useAppTheme();
  const ratio = max <= 0 ? 0 : Math.min(1, value / max);
  return (
    <View style={styles.field}>
      <View style={[styles.meterTrack, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.meterFill, { width: `${ratio * 100}%`, backgroundColor: theme.accent }]} />
      </View>
      <AppText variant="small" tone="secondary">
        {caption}
      </AppText>
    </View>
  );
}

export function EmptyState({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return (
    <Card style={styles.empty}>
      <AppText variant="heading">{title}</AppText>
      <AppText tone="secondary">{message}</AppText>
      {children}
    </Card>
  );
}

export function NavRow({ label, detail, onPress }: { label: string; detail?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.navRow}>
      <View style={styles.toggleLabel}>
        <AppText>{label}</AppText>
        {detail ? (
          <AppText variant="small" tone="secondary">
            {detail}
          </AppText>
        ) : null}
      </View>
      <AppText tone="secondary">{'›'}</AppText>
    </Pressable>
  );
}

export function Loading({ message }: { message: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.loading, { backgroundColor: theme.background }]}>
      <ActivityIndicator />
      <AppText tone="secondary">{message}</AppText>
    </View>
  );
}

export interface MenuOption {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

/** A row menu, used for the actions a Rule row offers. */
export function MenuSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title?: string;
  options: readonly MenuOption[];
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: insets.bottom + Spacing.three }]}
          onPress={() => {}}>
          {title ? (
            <AppText variant="small" tone="secondary">
              {title}
            </AppText>
          ) : null}
          {options.map((option) => (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                option.onPress();
              }}
              style={styles.sheetOption}>
              <AppText tone={option.destructive ? 'danger' : 'default'}>{option.label}</AppText>
            </Pressable>
          ))}
          <Button label="Cancel" variant="secondary" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const variantStyles = StyleSheet.create<Record<TextVariant, TextStyle>>({
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  smallBold: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  mono: { fontSize: 15, lineHeight: 21, fontFamily: Fonts?.mono },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenContent: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  section: { gap: Spacing.two },
  row: { flexDirection: 'row' },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
  },
  buttonLabel: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  segmented: { flexDirection: 'row', padding: Spacing.half, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.two, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  banner: { borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  field: { gap: Spacing.one },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16, minHeight: 44 },
  toggleRow: { paddingVertical: Spacing.one },
  toggleLabel: { flex: 1, gap: Spacing.half },
  keyValue: { gap: Spacing.two },
  keyValueLabel: { flex: 1 },
  keyValueValue: { flex: 1, textAlign: 'right' },
  statusRow: { gap: Spacing.one, paddingVertical: Spacing.one },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusAction: { alignSelf: 'flex-start', minHeight: 36, paddingVertical: 0 },
  meterTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
  empty: { alignItems: 'flex-start' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingVertical: Spacing.two, minHeight: 44 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: Spacing.three, gap: Spacing.two },
  sheetOption: { paddingVertical: Spacing.three, minHeight: 44, justifyContent: 'center' },
});
