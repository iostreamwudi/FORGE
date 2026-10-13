import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  ForgeBottomSheet,
  ForgeButton,
  ForgeCard,
  ForgeIconButton,
  ForgeScreen,
  ForgeSectionHeader,
  ForgeText,
  colors,
  radius,
  spacing,
} from '@/design-system';
import type { Goal, GoalType } from '@/types/domain';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';
import { displayWeight, inputWeightToKg } from '@/utils/weight';

type Picker = 'fatigue' | null;

const goalOptions: (Goal & { description: string })[] = [
  { type: 'fat_loss', label: '减脂', description: '控制减重速度，尽量保留力量。' },
  { type: 'muscle_gain', label: '增肌', description: '稳定增加能量，推动训练进步。' },
  { type: 'recomposition', label: '体态重组', description: '兼顾体重、围度和力量变化。' },
  { type: 'maintenance', label: '维持', description: '保持体重，同时继续提升表现。' },
];

const fatigueOptions = ['低', '中等', '高'];

export function ProfileScreen() {
  const appState = useForgeAppState();
  const actions = useForgeAppActions();
  const currentState = appState.dailyPlan.bodyState;
  const [goal, setGoal] = useState<Goal>(appState.profile.goal);
  const [weeklyGoal, setWeeklyGoal] = useState(appState.profile.weeklyWorkoutGoal ? String(appState.profile.weeklyWorkoutGoal) : '');
  const weightUnit = appState.profile.trainingPreferences?.weightUnit ?? 'kg';
  const [state, setState] = useState({ weightKg: currentState.weightKg ? String(displayWeight(currentState.weightKg, weightUnit)) : '', sleep: currentState.sleep, fatigue: currentState.fatigue, soreness: currentState.soreness });
  const [picker, setPicker] = useState<Picker>(null);

  const pickerConfig = { title: '今天疲劳', options: fatigueOptions, selected: state.fatigue, onSelect: (value: string) => setState((current) => ({ ...current, fatigue: value })) };

  const save = () => {
    const weeklyGoalValue = weeklyGoal.trim() ? Number(weeklyGoal) : undefined;
    if (weeklyGoalValue !== undefined && (!Number.isInteger(weeklyGoalValue) || weeklyGoalValue < 1 || weeklyGoalValue > 7)) { actions.showToast('每周训练目标请输入 1–7 之间的整数，或留空。'); return; }
    actions.updateGoal(goal);
    actions.updateWeeklyWorkoutGoal(weeklyGoalValue);
    const displayWeightValue = Number.parseFloat(state.weightKg);
    actions.updateDailyState({ ...state, sleep: state.sleep.trim() || '未记录', soreness: state.soreness.trim() || '未记录', weightKg: Number.isFinite(displayWeightValue) && displayWeightValue > 0 ? inputWeightToKg(displayWeightValue, weightUnit) : undefined });
    goBackToToday();
  };

  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ForgeScreen contentStyle={styles.content}>
    <View style={styles.header}>
      <ForgeIconButton icon="chevron-back" label="返回" onPress={goBackToToday} variant="ghost" />
      <View style={styles.headerCopy}>
        <ForgeText variant="h2">目标与今日状态</ForgeText>
        <ForgeText variant="caption" tone="secondary">让 FORGE 的每日计划更贴近你。</ForgeText>
      </View>
      <View style={styles.headerSpacer} />
    </View>

    <ForgeCard style={styles.card}>
      <ForgeSectionHeader title="我的目标" />
      <ForgeText variant="caption" tone="secondary">目标会影响训练、营养和恢复建议。</ForgeText>
      <View style={styles.goalGrid}>
        {goalOptions.map((option) => {
          const selected = option.type === goal.type;
          return <Pressable key={option.type} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setGoal({ type: option.type as GoalType, label: option.label, targetWeightKg: option.targetWeightKg })} style={({ pressed }) => [styles.goalOption, selected && styles.goalSelected, pressed && styles.pressed]}>
            <ForgeText variant="label" tone={selected ? 'accent' : 'primary'}>{option.label}</ForgeText>
            <ForgeText variant="caption" tone="secondary" style={styles.goalDescription}>{option.description}</ForgeText>
          </Pressable>;
        })}
      </View>
      <View style={styles.weeklyGoalRow}><View style={styles.weeklyGoalCopy}><ForgeText variant="caption" tone="secondary">每周训练目标（可选）</ForgeText><ForgeText variant="caption" tone="tertiary">只有你设置后，训练页才会显示目标进度。</ForgeText></View><TextInput accessibilityLabel="每周训练目标次数" value={weeklyGoal} onChangeText={setWeeklyGoal} keyboardType="number-pad" inputMode="numeric" placeholder="1–7" placeholderTextColor={colors.textTertiary} style={styles.weeklyGoalInput} /></View>
    </ForgeCard>

    <ForgeCard style={styles.card}>
      <ForgeSectionHeader title="今天的身体状态" />
      <ForgeText variant="caption" tone="secondary">没有健康设备也可以手动记录，稍后随时修改。</ForgeText>
      <View style={styles.stateList}>
        <WeightRow unit={weightUnit} value={state.weightKg} onChange={(value) => setState((current) => ({ ...current, weightKg: value }))} />
        <FreeTextRow label="昨晚睡眠" value={state.sleep === '未记录' ? '' : state.sleep} placeholder="例如 7 小时 30 分" onChange={(value) => setState((current) => ({ ...current, sleep: value }))} />
        <StateRow label="疲劳程度" value={state.fatigue} onPress={() => setPicker('fatigue')} />
        <FreeTextRow label="酸痛情况" value={state.soreness === '未记录' ? '' : state.soreness} placeholder="例如：未记录或描述部位" onChange={(value) => setState((current) => ({ ...current, soreness: value }))} />
      </View>
      <View style={styles.sourceNote}><ForgeText variant="caption" tone="tertiary">当前来源</ForgeText><ForgeText variant="caption" tone="secondary">手动记录 · 保存后立即更新今日计划</ForgeText></View>
    </ForgeCard>

    <ForgeButton label="保存并更新今日计划" onPress={save} />

      <ForgeBottomSheet visible={picker !== null} title={pickerConfig.title} options={pickerConfig.options} selected={pickerConfig.selected} onSelect={(value) => { pickerConfig.onSelect(String(value)); setPicker(null); }} onClose={() => setPicker(null)} />
    </ForgeScreen>
  </KeyboardAvoidingView>;
}

function goBackToToday() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function WeightRow({ unit, value, onChange }: { unit: 'kg' | 'lb'; value: string; onChange: (value: string) => void }) {
  return <View style={styles.stateRow}>
    <View><ForgeText variant="caption" tone="secondary">今天体重</ForgeText><ForgeText variant="label">{unit}</ForgeText></View>
    <TextInput accessibilityLabel={`今天体重，单位${unit === 'kg' ? '千克' : '磅'}`} value={value} onChangeText={onChange} keyboardType="decimal-pad" inputMode="decimal" placeholder={unit === 'kg' ? '例如 74.1' : '例如 163.6'} placeholderTextColor={colors.textTertiary} style={styles.weightInput} />
  </View>;
}

function StateRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}：${value}`} onPress={onPress} style={({ pressed }) => [styles.stateRow, pressed && styles.pressed]}>
    <View><ForgeText variant="caption" tone="secondary">{label}</ForgeText><ForgeText variant="label">{value}</ForgeText></View>
    <ForgeText variant="caption" tone="tertiary">修改  ›</ForgeText>
  </Pressable>;
}

function FreeTextRow({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <View style={styles.stateRow}><ForgeText variant="caption" tone="secondary">{label}</ForgeText><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.textTertiary} style={styles.freeTextInput} /></View>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerCopy: { flex: 1, gap: spacing.xxs },
  headerSpacer: { width: 44 },
  card: { gap: spacing.sm },
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  goalOption: { width: '48%', minHeight: 86, padding: spacing.sm, borderRadius: radius.small, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface2, gap: spacing.xs },
  goalSelected: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
  weeklyGoalRow: { minHeight: 64, padding: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  weeklyGoalCopy: { flex: 1, gap: spacing.xxs },
  weeklyGoalInput: { width: 64, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, textAlign: 'center', fontSize: 16 },
  goalDescription: { lineHeight: 17 },
  stateList: { gap: spacing.xs, marginTop: spacing.xs },
  stateRow: { minHeight: 56, paddingHorizontal: spacing.sm, borderRadius: radius.small, borderCurve: 'continuous', backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  keyboard: { flex: 1 },
  sourceNote: { gap: spacing.xxs, paddingTop: spacing.xs },
  weightInput: { minWidth: 112, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.small, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, textAlign: 'right', fontSize: 16 },
  freeTextInput: { flex: 1, minHeight: 44, marginLeft: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.small, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, fontSize: 16 },
  pressed: { opacity: 0.72 },
});
