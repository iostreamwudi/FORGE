import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextProps, View, ViewProps } from 'react-native';
import { useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, control, radius, spacing, typography } from './tokens';

type TextVariant = keyof typeof typography;
type TextTone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'success' | 'warning' | 'danger';

const tones: Record<TextTone, string> = {
  primary: colors.textPrimary, secondary: colors.textSecondary, tertiary: colors.textTertiary,
  accent: colors.accent, success: colors.success, warning: colors.warning, danger: colors.danger,
};

export function ForgeText({ variant = 'body', tone = 'primary', style, allowFontScaling = true, ...props }: TextProps & { variant?: TextVariant; tone?: TextTone }) {
  return <Text allowFontScaling={allowFontScaling} style={[styles.text, typography[variant], { color: tones[tone] }, style]} {...props} />;
}

export function ForgeScreen({ children, scroll = true, contentStyle }: { children: React.ReactNode; scroll?: boolean; contentStyle?: ViewProps['style'] }) {
  const insets = useSafeAreaInsets();
  if (scroll) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.screenContent, contentStyle, { paddingTop: insets.top + spacing.xs, paddingBottom: insets.bottom + spacing.xxl }]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  }
  return <SafeAreaView style={[styles.screen, contentStyle]}>{children}</SafeAreaView>;
}

export function ForgeCard({ children, elevated = false, style, accessibilityLabel, accessible = Boolean(accessibilityLabel) }: ViewProps & { elevated?: boolean }) {
  return <View accessible={accessible} accessibilityLabel={accessibilityLabel} style={[styles.card, elevated && styles.cardElevated, style]}>{children}</View>;
}

export function ForgeButton({ label, onPress, disabled = false, loading = false, variant = 'primary' }: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'secondary';
}) {
  const isDisabled = disabled || loading;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.button, variant === 'secondary' && styles.secondaryButton, pressed && styles.pressed, focused && styles.focused, isDisabled && styles.disabled]}
    >
      {loading ? <ActivityIndicator color={colors.background} /> : <ForgeText variant="label" style={variant === 'primary' ? styles.buttonText : undefined}>{label}</ForgeText>}
    </Pressable>
  );
}

export function ForgeIconButton({ icon, label, onPress, size = 20, variant = 'surface' }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; size?: number; variant?: 'surface' | 'ghost' }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ pressed }) => [styles.iconButton, variant === 'ghost' && styles.iconButtonGhost, pressed && styles.pressed, focused && styles.focused]}>
      <Ionicons name={icon} size={size} color={colors.textPrimary} />
    </Pressable>
  );
}

export function ForgeStatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'accent' }) {
  const color = tone === 'success' ? colors.success : tone === 'accent' ? colors.accent : colors.textSecondary;
  return <View style={[styles.pill, { borderColor: color }]}><ForgeText variant="caption" style={{ color }}>{label}</ForgeText></View>;
}

export function ForgeMetric({ value, label, align = 'left', style, valueStyle, labelStyle }: { value: string | number; label: string; align?: 'left' | 'center' | 'right'; style?: ViewProps['style']; valueStyle?: TextProps['style']; labelStyle?: TextProps['style'] }) {
  const alignItems = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
  return <View style={[styles.metric, { alignItems }, style]}><ForgeText variant="h2" style={valueStyle}>{value}</ForgeText><ForgeText variant="caption" tone="secondary" style={labelStyle}>{label}</ForgeText></View>;
}

export function ForgeSectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.sectionHeader}>
      <ForgeText variant="label" tone="secondary">{title}</ForgeText>
      {action && onAction ? <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onAction} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} hitSlop={8} style={[focused && styles.focused]}><ForgeText variant="caption" tone="secondary">{action}</ForgeText></Pressable> : null}
    </View>
  );
}

export function ForgeDivider() { return <View style={styles.divider} />; }

export function ForgeBottomSheet({ visible, title, options, selected, onSelect, onClose }: {
  visible: boolean; title: string; options: (string | number)[]; selected?: string | number;
  onSelect: (value: string | number) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.scrim}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭选择器" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onStartShouldSetResponder={() => true} onTouchEnd={(event) => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <ForgeText variant="h3">{title}</ForgeText>
          <View style={styles.optionGrid}>
            {options.map((option) => (
              <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: option === selected }} onPress={() => onSelect(option)}
                style={({ pressed }) => [styles.option, option === selected && styles.optionSelected, pressed && styles.pressed]}>
                <ForgeText variant="h3" tone={option === selected ? 'accent' : 'primary'}>{option}</ForgeText>
              </Pressable>
            ))}
          </View>
          <ForgeButton label="关闭" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

export type ForgeAction = { label: string; onPress: () => void; tone?: TextTone };

export function ForgeActionSheet({ visible, title, subtitle, options, onClose }: { visible: boolean; title: string; subtitle?: string; options: ForgeAction[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.scrim}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭面板" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.actionSheet, { paddingBottom: insets.bottom + spacing.lg }]} onStartShouldSetResponder={() => true} onTouchEnd={(event) => event.stopPropagation()}>
        <View style={styles.sheetHandle} />
        <ForgeText variant="h3">{title}</ForgeText>
        {subtitle ? <ForgeText tone="secondary">{subtitle}</ForgeText> : null}
        <View style={styles.actionList}>{options.map((option) => <Pressable key={option.label} accessibilityRole="button" accessibilityLabel={option.label} onPress={() => { option.onPress(); onClose(); }} style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}><ForgeText variant="body" tone={option.tone ?? 'primary'}>{option.label}</ForgeText><Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /></Pressable>)}</View>
        <ForgeButton label="关闭" variant="secondary" onPress={onClose} />
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  text: { fontFamily: undefined },
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.xl },
  card: { backgroundColor: colors.surface1, borderRadius: radius.medium, borderCurve: 'continuous', padding: spacing.md },
  cardElevated: { backgroundColor: colors.elevated },
  button: { minHeight: control.button, borderRadius: radius.small, borderCurve: 'continuous', backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  secondaryButton: { backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  buttonText: { color: colors.background },
  pressed: { opacity: 0.72 },
  focused: { outlineStyle: 'solid' as never, outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 2 } as never,
  disabled: { opacity: 0.4 },
  iconButton: { width: control.touch, height: control.touch, borderRadius: radius.round, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  iconButtonGhost: { backgroundColor: 'transparent' },
  pill: { minHeight: 28, borderRadius: radius.round, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  metric: { minWidth: 72, gap: spacing.xxs },
  sectionHeader: { minHeight: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: { backgroundColor: colors.elevated, borderTopLeftRadius: radius.large, borderTopRightRadius: radius.large, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, gap: spacing.xl },
  actionSheet: { backgroundColor: colors.elevated, borderTopLeftRadius: radius.large, borderTopRightRadius: radius.large, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.md },
  actionList: { gap: spacing.xxs },
  actionRow: { minHeight: control.touch, paddingHorizontal: spacing.sm, borderRadius: radius.small, borderCurve: 'continuous', backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.round, backgroundColor: colors.textTertiary },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: { minWidth: 64, minHeight: 52, borderRadius: radius.small, borderCurve: 'continuous', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
});
