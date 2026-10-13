import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ForgeCard, ForgeMetric, ForgeScreen, ForgeSectionHeader, ForgeStatusPill, ForgeText, colors, control, mobileCanvasWidth, radius, spacing } from '@/design-system';
import { useForgeAppState } from '@/state/ForgeAppContext';
import { estimateOneRepMax, getVolumeKg } from '@/utils/workoutMetrics';
import { formatShortDate } from '@/utils/date';
import { formatWeight } from '@/utils/weight';

export function ProgressHomeScreen() {
  const appState = useForgeAppState();
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth, mobileCanvasWidth);
  const compact = width < 380;
  const sessions = appState.completedSessions;
  const latestSession = sessions[0];
  const strengthTrend = sessions.slice(0, 6).reverse().map((session) => Math.round(Math.max(...session.exercises.flatMap((exercise) => exercise.sets.filter((set) => set.status === 'completed').map(estimateOneRepMax)), 0) * 10) / 10);
  const trendLabels = sessions.slice(0, 6).reverse().map((session) => formatShortDate(new Date(session.completedAt)));
  const currentWeight = appState.dailyPlan.bodyState.weightKg;
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekSessions = sessions.filter((session) => new Date(session.completedAt) >= weekStart);
  const recentVolume = sessions.slice(0, 7).reduce((total, session) => total + getVolumeKg(session.exercises), 0);
  const latestStrength = strengthTrend[strengthTrend.length - 1];
  const hasStrengthTrend = strengthTrend.length > 0;
  const weightUnit = appState.profile.trainingPreferences?.weightUnit ?? 'kg';

  return <ForgeScreen contentStyle={styles.content}>
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <View style={styles.brandRow}><Ionicons name="sparkles" size={15} color={colors.accent} /><ForgeText variant="label" tone="accent">FORGE · 进展</ForgeText></View>
        <ForgeText variant="title">进展</ForgeText>
        <ForgeText tone="secondary">看见趋势，而不是被单次数据牵着走。</ForgeText>
      </View>
      <ForgeStatusPill label={sessions.length > 0 ? '本地记录' : '等待记录'} />
    </View>

    <ForgeCard style={styles.heroCard} accessibilityLabel="训练进展结论">
      <View style={styles.heroLabel}><Ionicons name="sparkles" size={17} color={colors.accent} /><ForgeText variant="label" tone="accent">FORGE 结论</ForgeText><ForgeText variant="caption" tone="tertiary">本地记录</ForgeText></View>
      <ForgeText variant="h2">{sessions.length > 0 ? '你的训练记录正在形成可追踪的趋势。' : '完成一次训练，开始建立你的真实趋势。'}</ForgeText>
      <ForgeText tone="secondary">{sessions.length > 0 ? `已记录 ${sessions.length} 次训练，数据保存在本地设备。` : '当前没有足够的历史训练数据，FORGE 不会用示例数据替代你的记录。'}</ForgeText>
      <View style={[styles.metricRow, compact && styles.metricRowCompact]}>
        <ForgeMetric value={`${weekSessions.length}`} label="本周训练" />
        <ForgeMetric value={latestStrength ? formatWeight(latestStrength, weightUnit) : '—'} label="最近估算 1RM" align={compact ? 'left' : 'center'} />
        <ForgeMetric value={sessions.length > 0 ? `${Math.round((weightUnit === 'lb' ? recentVolume / 0.45359237 : recentVolume) * 10) / 10} ${weightUnit}` : '—'} label="近 7 次训练量" align="right" />
      </View>
    </ForgeCard>

    {sessions.length === 0 ? <ForgeCard style={styles.emptyActionsCard} accessibilityLabel="开始记录真实进展">
      <View style={styles.emptyActionsCopy}>
        <ForgeText variant="h3">从一条真实记录开始</ForgeText>
        <ForgeText variant="caption" tone="secondary">记录体重、状态或完成一次训练后，进展页才会生成你的趋势。这里不会填充示例数据。</ForgeText>
      </View>
      <View style={styles.emptyActionsList}>
        <Pressable accessibilityRole="button" accessibilityLabel="记录今日状态" onPress={() => router.push('/profile')} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}><View style={styles.emptyActionCopy}><Ionicons name="create-outline" size={18} color={colors.accent} /><ForgeText variant="label">记录今日状态</ForgeText></View><Ionicons name="arrow-forward" size={16} color={colors.accent} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="开始一次训练" onPress={() => router.push('/train')} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}><View style={styles.emptyActionCopy}><Ionicons name="barbell-outline" size={18} color={colors.accent} /><ForgeText variant="label">开始一次训练</ForgeText></View><Ionicons name="arrow-forward" size={16} color={colors.accent} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="让 Coach 分析进展" onPress={() => router.push('/coach')} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}><View style={styles.emptyActionCopy}><Ionicons name="sparkles-outline" size={18} color={colors.accent} /><ForgeText variant="label">让 Coach 分析进展</ForgeText></View><Ionicons name="arrow-forward" size={16} color={colors.accent} /></Pressable>
      </View>
    </ForgeCard> : null}

    <View style={styles.section}><View style={styles.sectionHeader}><ForgeText variant="label" tone="secondary">体重趋势</ForgeText><ForgeText variant="caption" tone="secondary">需要连续记录</ForgeText></View><ForgeCard style={styles.trendCard} accessibilityLabel="体重趋势">
      <View style={styles.trendHeader}><View style={styles.trendTitle}><View style={styles.iconSquare}><Ionicons name="body-outline" size={20} color={colors.textPrimary} /></View><View><ForgeText variant="h3">体重趋势</ForgeText><ForgeText variant="caption" tone="secondary">从每日状态记录中生成</ForgeText></View></View><View style={styles.trendValue}><ForgeText variant="h2">{currentWeight ? formatWeight(currentWeight, weightUnit) : '—'}</ForgeText><ForgeText variant="caption" tone="secondary">当前记录</ForgeText></View></View>
      <View style={styles.emptyChart}><ForgeText variant="caption" tone="secondary">{currentWeight ? '再记录几天后，这里会显示 7 日均值。' : '在今日状态中记录体重后，这里会显示趋势。'}</ForgeText></View>
    </ForgeCard></View>

    <View style={styles.section}><View style={styles.sectionHeader}><ForgeText variant="label" tone="secondary">力量趋势</ForgeText><ForgeText variant="caption" tone="secondary">训练会话</ForgeText></View><ForgeCard style={styles.trendCard} accessibilityLabel="力量趋势">
      <View style={styles.trendHeader}><View style={styles.trendTitle}><View style={styles.iconSquare}><Ionicons name="barbell-outline" size={20} color={colors.textPrimary} /></View><View><ForgeText variant="h3">力量趋势</ForgeText><ForgeText variant="caption" tone="secondary">每次训练最高估算 1RM</ForgeText></View></View><View style={styles.trendValue}><ForgeText variant="h2">{latestStrength ? formatWeight(latestStrength, weightUnit) : '—'}</ForgeText><ForgeText variant="caption" tone="secondary">最近一次</ForgeText></View></View>
      {hasStrengthTrend ? <TrendBars values={strengthTrend} min={Math.max(0, Math.min(...strengthTrend) - 5)} max={Math.max(...strengthTrend) + 5} color={colors.success} labels={trendLabels} /> : <View style={styles.emptyChart}><ForgeText variant="caption" tone="secondary">完成训练后，这里会显示真实力量趋势。</ForgeText></View>}
      {latestSession ? <View style={styles.prRow}><ForgeStatusPill label="已记录" tone="success" /><ForgeText variant="caption" tone="secondary">{latestSession.workoutTitle} · {formatShortDate(new Date(latestSession.completedAt))}</ForgeText></View> : null}
    </ForgeCard></View>

    <View style={styles.section}><ForgeSectionHeader title="训练执行" /><ForgeCard style={styles.executionCard} accessibilityLabel="训练执行">
      <View style={styles.executionHeader}><View style={styles.iconSquare}><Ionicons name="checkmark-done-outline" size={20} color={colors.textPrimary} /></View><View style={styles.executionCopy}><ForgeText variant="h3">本周训练完成度</ForgeText><ForgeText variant="caption" tone="secondary">保持当前节奏，下一次按计划开始。</ForgeText></View></View>
      <View style={[styles.executionMetrics, compact && styles.executionMetricsCompact]}><ForgeMetric value={`${weekSessions.length}`} label="训练次数" /><ForgeMetric value={sessions.length > 0 ? `${Math.round((weightUnit === 'lb' ? recentVolume / 0.45359237 : recentVolume) * 10) / 10} ${weightUnit}` : '—'} label="近 7 次训练量" align={compact ? 'left' : 'center'} /><ForgeMetric value={latestSession ? '已记录' : '—'} label="最新状态" align="right" /></View>
      {appState.profile.weeklyWorkoutGoal ? <><View style={styles.completionTrack} accessibilityLabel={`本周已记录 ${weekSessions.length} 次，目标 ${appState.profile.weeklyWorkoutGoal} 次`}><View style={[styles.completionFill, { width: `${Math.min(100, (weekSessions.length / appState.profile.weeklyWorkoutGoal) * 100)}%` }]} /></View><ForgeText variant="caption" tone="secondary">{weekSessions.length} / {appState.profile.weeklyWorkoutGoal} 次 · 计划完成度</ForgeText></> : <ForgeText variant="caption" tone="tertiary">未设置每周目标，当前只显示真实完成次数。</ForgeText>}
    </ForgeCard></View>

    <ForgeCard style={styles.coachCard}><View style={styles.coachCopy}><View style={styles.heroLabel}><Ionicons name="sparkles" size={15} color={colors.accent} /><ForgeText variant="label" tone="accent">问问 FORGE</ForgeText></View><ForgeText variant="h3">想知道为什么？让 Coach 解释这段趋势。</ForgeText><ForgeText variant="caption" tone="secondary">你可以继续追问体重、力量或训练执行。</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel="打开教练解释进展" onPress={() => router.push('/coach')} style={({ pressed }) => [styles.coachAction, pressed && styles.pressed]}><ForgeText variant="caption" tone="accent">打开教练</ForgeText><Ionicons name="arrow-forward" size={16} color={colors.accent} /></Pressable></ForgeCard>

    <ForgeText variant="caption" tone="tertiary" style={styles.dataNote}>指标来自本地训练会话 · 未记录的数据不会被示例数据填充。</ForgeText>
  </ForgeScreen>;
}

function TrendBars({ values, min, max, color, labels }: { values: number[]; min: number; max: number; color: string; labels: string[] }) {
  return <View style={styles.chart} accessibilityLabel={`趋势：${values[0]} 到 ${values[values.length - 1]}`}>
    <View style={styles.chartGrid}><View style={styles.gridLine} /><View style={styles.gridLine} /><View style={styles.gridLine} /></View>
    <View style={styles.bars}>{values.map((value, index) => { const height = 18 + ((value - min) / Math.max(1, max - min)) * 54; return <View key={`${value}-${index}`} style={styles.barSlot}><View style={[styles.bar, { height, backgroundColor: color }]} /><View style={[styles.barDot, { backgroundColor: color }]} /></View>; })}</View>
    <View style={styles.chartLabels}>{labels.map((label, index) => <ForgeText key={`${label}-${index}`} variant="caption" tone="tertiary">{label}</ForgeText>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg }, header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md }, headerCopy: { flex: 1, gap: spacing.xxs }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxs }, heroCard: { gap: spacing.sm, backgroundColor: colors.surface2 }, heroLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, metricRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.sm, marginTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, metricRowCompact: { flexWrap: 'wrap', justifyContent: 'flex-start' }, section: { gap: spacing.xs }, sectionHeader: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, trendCard: { gap: spacing.md }, trendHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, trendTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, iconSquare: { width: 42, height: 42, borderRadius: radius.small, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, trendValue: { alignItems: 'flex-end', gap: 2 }, chart: { height: 128, paddingTop: spacing.xs, position: 'relative', gap: spacing.xs }, chartGrid: { position: 'absolute', left: 0, right: 0, top: spacing.sm, height: 78, justifyContent: 'space-between' }, gridLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSubtle }, bars: { height: 82, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', paddingHorizontal: spacing.xs }, barSlot: { flex: 1, height: 82, alignItems: 'center', justifyContent: 'flex-end', gap: 2 }, bar: { width: 4, borderRadius: 2, opacity: 0.62 }, barDot: { width: 8, height: 8, borderRadius: 4, marginBottom: -2 }, chartLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xs }, emptyChart: { minHeight: 82, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSubtle }, prRow: { minHeight: control.touch, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle }, executionCard: { gap: spacing.md }, executionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, executionCopy: { flex: 1, gap: spacing.xxs }, executionMetrics: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }, executionMetricsCompact: { flexWrap: 'wrap', justifyContent: 'flex-start' }, completionTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfacePressed, overflow: 'hidden' }, completionFill: { height: '100%', borderRadius: 4, backgroundColor: colors.accent }, coachCard: { gap: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.accent, backgroundColor: colors.surface2 }, coachCopy: { gap: spacing.xs }, coachAction: { minHeight: control.touch, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, dataNote: { textAlign: 'center', paddingHorizontal: spacing.sm }, pressed: { opacity: 0.68 },
  emptyActionsCard: { gap: spacing.md, backgroundColor: colors.surface1 }, emptyActionsCopy: { gap: spacing.xs }, emptyActionsList: { gap: spacing.xs }, emptyAction: { minHeight: control.touch, paddingHorizontal: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, emptyActionCopy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
