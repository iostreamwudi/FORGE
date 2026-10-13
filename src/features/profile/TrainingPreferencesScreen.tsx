import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ForgeButton, ForgeCard, ForgeIconButton, ForgeScreen, ForgeSectionHeader, ForgeText, colors, radius, spacing } from '@/design-system';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const restOptions = [60, 90, 120, 150, 180];

export function TrainingPreferencesScreen() {
  const state = useForgeAppState();
  const actions = useForgeAppActions();
  const saved = state.profile.trainingPreferences;
  const [trainingDays, setTrainingDays] = useState<number[]>(saved?.trainingDays ?? []);
  const [defaultRestSeconds, setDefaultRestSeconds] = useState<number | undefined>(saved?.defaultRestSeconds);
  const [weightUnit, setWeightUnit] = useState(saved?.weightUnit ?? 'kg');

  const toggleDay = (day: number) => setTrainingDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort((left, right) => left - right));
  const save = () => {
    actions.updateTrainingPreferences({ trainingDays, weightUnit, ...(defaultRestSeconds ? { defaultRestSeconds } : {}) });
    if (router.canGoBack()) router.back(); else router.replace('/');
  };

  return <ForgeScreen contentStyle={styles.content}>
    <View style={styles.header}><ForgeIconButton icon="chevron-back" label="返回我的" variant="ghost" onPress={() => router.back()} /><View style={styles.headerCopy}><ForgeText variant="h2">训练偏好</ForgeText><ForgeText variant="caption" tone="secondary">只保存你主动选择的训练设置。</ForgeText></View><View style={styles.headerSpacer} /></View>
    <ForgeCard style={styles.card}><ForgeSectionHeader title="计划训练日" /><ForgeText variant="caption" tone="secondary">用于提醒和周目标参考；不选择表示尚未设置。</ForgeText><View style={styles.dayGrid}>{weekdays.map((label, index) => { const selected = trainingDays.includes(index + 1); return <Pressable key={label} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: selected }} onPress={() => toggleDay(index + 1)} style={({ pressed }) => [styles.day, selected && styles.selected, pressed && styles.pressed]}><ForgeText variant="caption" tone={selected ? 'accent' : 'secondary'}>{label}</ForgeText></Pressable>; })}</View></ForgeCard>
    <ForgeCard style={styles.card}><ForgeSectionHeader title="重量单位" /><ForgeText variant="caption" tone="secondary">FORGE 内部以 kg 保存，界面会按你的选择显示并在录入时换算。</ForgeText><View style={styles.restList}>{(['kg', 'lb'] as const).map((unit) => { const selected = weightUnit === unit; return <Pressable key={unit} accessibilityRole="radio" accessibilityLabel={unit === 'kg' ? '千克' : '磅'} accessibilityState={{ selected }} onPress={() => setWeightUnit(unit)} style={({ pressed }) => [styles.restOption, selected && styles.selected, pressed && styles.pressed]}><ForgeText variant="label" tone={selected ? 'accent' : 'primary'}>{unit}</ForgeText></Pressable>; })}</View></ForgeCard>
    <ForgeCard style={styles.card}><ForgeSectionHeader title="组间默认休息" /><ForgeText variant="caption" tone="secondary">完成一组后使用的默认倒计时，可在训练中继续增加 30 秒。</ForgeText><View style={styles.restList}>{restOptions.map((seconds) => { const selected = defaultRestSeconds === seconds; return <Pressable key={seconds} accessibilityRole="radio" accessibilityLabel={`${seconds} 秒`} accessibilityState={{ selected }} onPress={() => setDefaultRestSeconds(seconds)} style={({ pressed }) => [styles.restOption, selected && styles.selected, pressed && styles.pressed]}><ForgeText variant="label" tone={selected ? 'accent' : 'primary'}>{seconds} 秒</ForgeText></Pressable>; })}</View><Pressable accessibilityRole="button" accessibilityLabel="使用系统默认休息时间" onPress={() => setDefaultRestSeconds(undefined)} style={({ pressed }) => [styles.clear, pressed && styles.pressed]}><ForgeText variant="caption" tone="secondary">使用系统默认（150 秒）</ForgeText></Pressable></ForgeCard>
    <ForgeButton label="保存训练偏好" onPress={save} />
  </ForgeScreen>;
}

const styles = StyleSheet.create({ content: { gap: spacing.lg }, header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, headerCopy: { flex: 1, gap: spacing.xxs }, headerSpacer: { width: 44 }, card: { gap: spacing.sm }, dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }, day: { minWidth: 68, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, restList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }, restOption: { minWidth: 72, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, selected: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent, backgroundColor: colors.accentMuted }, clear: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, pressed: { opacity: 0.7 } });
