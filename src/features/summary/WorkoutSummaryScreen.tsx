import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ForgeButton, ForgeCard, ForgeMetric, ForgeText, colors, control, radius, spacing } from '@/design-system';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';
import { formatWeight } from '@/utils/weight';

export function WorkoutSummaryScreen() {
  const insets = useSafeAreaInsets();
  const appState = useForgeAppState();
  const actions = useForgeAppActions();
  const summary = appState.currentSummary;
  const hasCompletedSet = appState.completedSetCount > 0;
  const done = () => { if (!hasCompletedSet) { actions.showToast('本次没有完成训练组，未计入完成记录。'); router.back(); return; } actions.markWorkoutComplete(); actions.showToast('训练已完成，FORGE 已更新建议'); router.dismissAll(); router.replace('/'); };
  const footerBottomPadding = Math.max(insets.bottom, spacing.sm);
  const contentBottomPadding = footerBottomPadding + control.button + spacing.xxxl;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: contentBottomPadding }]}>
        <View style={styles.hero}>
          <View style={styles.workoutLabel}><View style={styles.completeIcon}><Ionicons name="checkmark" size={16} color={colors.background} /></View><ForgeText variant="h3">{summary.workoutTitle}</ForgeText></View>
          <ForgeText variant="title">{hasCompletedSet ? '训练复盘。' : '训练尚未完成。'}</ForgeText>
          <ForgeText variant="caption" tone="secondary">{summary.durationMinutes} 分钟</ForgeText>
          {!hasCompletedSet ? <ForgeText variant="caption" tone="warning">没有完成训练组，本次不会写入完成记录。</ForgeText> : null}
        </View>
        <View style={styles.metrics}>
          <ForgeMetric value={summary.setCount} label="组数" align="center" style={styles.summaryMetric} />
          <View style={styles.metricDivider} />
          <ForgeMetric value={formatWeight(summary.volumeKg, appState.profile.trainingPreferences?.weightUnit ?? 'kg')} label="总容量" align="center" style={styles.summaryMetric} />
          <View style={styles.metricDivider} />
          <ForgeMetric value={summary.prCount} label="个人纪录" align="center" style={styles.summaryMetric} />
        </View>

        {summary.pr ? <ForgeCard style={styles.prCard}><ForgeText variant="label" tone="success">新个人纪录</ForgeText><View style={styles.prCopy}><ForgeText variant="caption" tone="secondary">{summary.pr.exercise}</ForgeText><ForgeText variant="h1">{summary.pr.performance}</ForgeText><ForgeText variant="caption" tone="success">{summary.pr.kind}</ForgeText></View></ForgeCard> : null}

        <ForgeCard style={styles.review}>
          <View style={styles.reviewTitle}><Ionicons name="sparkles" size={15} color={colors.accent} /><ForgeText variant="label" tone="accent">FORGE 复盘</ForgeText></View>
          {summary.review.map((item) => <View key={item.label} style={styles.reviewItem}><ForgeText variant="label" tone={item.label === 'WATCH' ? 'warning' : item.label === 'STRONG' ? 'success' : 'secondary'} style={styles.reviewLabel}>{item.label === 'STRONG' ? '亮点' : item.label === 'WATCH' ? '注意' : '下一步'}</ForgeText><ForgeText style={styles.reviewCopy}>{item.text}</ForgeText></View>)}
        </ForgeCard>
        <ForgeCard style={styles.coachHandoff}>
          <View style={styles.coachHandoffCopy}><View style={styles.reviewTitle}><Ionicons name="sparkles" size={15} color={colors.accent} /><ForgeText variant="label" tone="accent">FORGE 已记录</ForgeText></View><ForgeText variant="caption" tone="secondary">本次完成情况会用于下一次训练建议。</ForgeText></View>
          <Pressable accessibilityRole="button" accessibilityLabel="查看教练建议" onPress={() => router.push('/coach')} hitSlop={8} style={({ pressed }) => [styles.coachHandoffAction, pressed && styles.pressed]}><ForgeText variant="caption" tone="secondary">查看教练</ForgeText><Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /></Pressable>
        </ForgeCard>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}><ForgeButton label={hasCompletedSet ? '确认记录完成' : '返回训练'} onPress={done} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xl }, hero: { alignItems: 'center', gap: spacing.xxs }, pressed: { opacity: 0.68 },
  workoutLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs }, completeIcon: { width: 32, height: 32, borderRadius: radius.round, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  metrics: { minHeight: 72, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSubtle }, summaryMetric: { flex: 1 }, metricDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: colors.borderSubtle },
  prCard: { gap: spacing.sm }, prCopy: { alignItems: 'center', gap: spacing.xxs },
  review: { borderLeftWidth: 2, borderLeftColor: colors.accent, gap: spacing.md }, reviewTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, reviewItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, reviewLabel: { width: 60, paddingTop: 3 }, reviewCopy: { flex: 1 },
  coachHandoff: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface2 }, coachHandoffCopy: { flex: 1, gap: spacing.xs }, coachHandoffAction: { minHeight: control.touch, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle },
});
