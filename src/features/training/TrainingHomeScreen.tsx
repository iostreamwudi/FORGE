import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';
import { ForgeButton, ForgeCard, ForgeMetric, ForgeScreen, ForgeSectionHeader, ForgeStatusPill, ForgeText, colors, radius, spacing } from '@/design-system';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';
import { formatWeight } from '@/utils/weight';
import { formatLocalizedDateTime, formatShortDate } from '@/utils/date';
import { requestTrainingPlan, requestTrainingProgression, type TrainingProgressionInsight } from '@/data/authClient';

export function TrainingHomeScreen() {
  const appState = useForgeAppState();
  const actions = useForgeAppActions();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [progression, setProgression] = useState<TrainingProgressionInsight[]>([]);
  const [progressionStatus, setProgressionStatus] = useState<'idle' | 'ready' | 'empty' | 'error'>('idle');
  const [progressionGeneratedAt, setProgressionGeneratedAt] = useState<string | null>(null);
  const [progressionRetryKey, setProgressionRetryKey] = useState(0);
  const [expandedProgressionId, setExpandedProgressionId] = useState<string | null>(null);
  const [cloudPlan, setCloudPlan] = useState<{ revision: number; updatedAt: string } | null>(null);
  const [cloudPlanStatus, setCloudPlanStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const workout = appState.dailyPlan.workout;
  const recentSummary = appState.recentSummary;
  const hasWorkout = Boolean(workout.id && appState.exercises.length);
  const ctaLabel = hasWorkout ? (appState.workoutStatus === 'active' ? '继续训练' : appState.workoutStatus === 'completed' ? '查看训练总结' : '开始训练') : '完成个人设置';
  const weekCompletedCount = appState.completedSessions.filter((session) => new Date(session.completedAt) >= startOfWeek()).length;
  const weeklyGoal = appState.profile.weeklyWorkoutGoal;
  const weightUnit = appState.profile.trainingPreferences?.weightUnit ?? 'kg';
  const latestCompletedAt = appState.completedSessions.reduce<string | null>((latest, session) => {
    if (!latest) return session.completedAt;
    return new Date(session.completedAt).getTime() > new Date(latest).getTime() ? session.completedAt : latest;
  }, null);
  const progressionStale = Boolean(progressionGeneratedAt && latestCompletedAt && new Date(latestCompletedAt).getTime() > new Date(progressionGeneratedAt).getTime());
  useEffect(() => {
    const accessToken = appState.authSession?.accessToken;
    if (!accessToken) return;
    let active = true;
    void Promise.allSettled([requestTrainingPlan(accessToken), requestTrainingProgression(accessToken)]).then(([planResult, progressionResult]) => {
      if (!active) return;
      if (planResult.status === 'fulfilled') {
        setCloudPlan({ revision: planResult.value.revision, updatedAt: planResult.value.updatedAt });
        setCloudPlanStatus('ready');
      } else if (planResult.reason instanceof Error && planResult.reason.message === '当前账户还没有可用的云端训练计划。') {
        setCloudPlan(null);
        setCloudPlanStatus('empty');
      } else {
        setCloudPlan(null);
        setCloudPlanStatus('error');
      }
      if (progressionResult.status === 'fulfilled') {
        const nextProgression = progressionResult.value.exercises.slice(0, 3);
        setProgression(nextProgression);
        setProgressionGeneratedAt(progressionResult.value.generatedAt);
        setProgressionStatus(nextProgression.length ? 'ready' : 'empty');
      } else {
        setProgression([]);
        setProgressionGeneratedAt(null);
        setProgressionStatus('error');
      }
    });
    return () => { active = false; };
  }, [appState.authSession?.accessToken, appState.completedSessions, appState.workout.id, progressionRetryKey]);
  
  const handleWorkout = () => {
    if (!hasWorkout) { router.push('/training/create'); return; }
    if (appState.workoutStatus === 'completed') router.push('/workout-summary');
    else { actions.startWorkout(); router.push('/active-workout'); }
  };

  return <ForgeScreen contentStyle={styles.content}>
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <View style={styles.brandRow}><Ionicons name="sparkles" size={15} color={colors.accent} /><ForgeText variant="label" tone="accent">FORGE · 训练</ForgeText></View>
        <ForgeText variant="title">训练</ForgeText>
        <ForgeText tone="secondary">按计划练，按表现调整。</ForgeText>
      </View>
      <View style={styles.weekSummary} accessibilityLabel={weeklyGoal ? `本周完成 ${weekCompletedCount} / ${weeklyGoal} 次` : `本周完成 ${weekCompletedCount} 次`}>
        <ForgeText variant="caption" tone="tertiary">本周 {weeklyGoal ? `${weekCompletedCount} / ${weeklyGoal}` : `${weekCompletedCount} 次`}</ForgeText>
        {weeklyGoal ? <View style={styles.weekProgressTrack}><View style={[styles.weekProgressFill, { width: `${Math.min(100, (weekCompletedCount / weeklyGoal) * 100)}%` }]} /></View> : null}
      </View>
    </View>

    <ForgeCard style={styles.nextCard} accessible={false} accessibilityLabel={hasWorkout ? `下一次训练：${workout.title}` : '尚未创建训练计划'}>
      <View style={styles.cardEyebrow}><ForgeText variant="label" tone="secondary">下一次训练</ForgeText>{hasWorkout ? <ForgeStatusPill label="今天" tone="accent" /> : <ForgeStatusPill label="未设置" tone="neutral" />}</View>
      <View style={styles.nextTitleRow}><View style={styles.iconSquare}><Ionicons name="barbell-outline" size={24} color={colors.textPrimary} /></View><View style={styles.nextCopy}><ForgeText variant="h1">{workout.title}</ForgeText><ForgeText tone="secondary">{workout.focus}</ForgeText></View></View>
      {hasWorkout ? <><View style={styles.metricRow}><ForgeMetric value={`${workout.exerciseCount}`} label="个动作" /><ForgeMetric value={`${workout.setCount}`} label="组" align="center" /><ForgeMetric value={`${workout.estimatedMinutes} min`} label="预计时长" align="right" /></View><View style={styles.adjustmentRow}><Ionicons name="sparkles" size={16} color={colors.accent} /><ForgeText variant="caption">FORGE 已根据你的状态调整 {workout.adjustments} 项</ForgeText></View></> : <ForgeText variant="caption" tone="secondary">设置目标、身体状态并连接训练计划后，这里会显示真实训练内容。</ForgeText>}
      <ForgeButton label={ctaLabel} onPress={handleWorkout} />
      {hasWorkout ? <View style={styles.planActions}><ForgeButton label="编辑计划" variant="secondary" onPress={() => router.push('/training/create?mode=edit')} /><Pressable accessibilityRole="button" accessibilityLabel="删除训练计划" onPress={() => setDeleteOpen(true)} style={styles.deleteAction}><ForgeText variant="caption" tone="danger">删除计划</ForgeText></Pressable></View> : null}
    </ForgeCard>

    <View style={styles.section}><ForgeSectionHeader title="本周计划" /><ForgeCard style={styles.weekCard}><View style={styles.emptyRecent}><ForgeText variant="h3">{hasWorkout ? '训练计划已保存' : '还没有本周计划'}</ForgeText><ForgeText variant="caption" tone="secondary">{hasWorkout ? (cloudPlanStatus === 'ready' && cloudPlan ? '云端版本 ' + cloudPlan.revision + ' · ' + formatLocalizedDateTime(cloudPlan.updatedAt, '同步时间未知') : cloudPlanStatus === 'loading' ? '正在读取云端训练计划版本…' : cloudPlanStatus === 'error' ? '云端计划暂时无法读取，本地计划仍保留；请稍后重试。' : cloudPlanStatus === 'empty' ? '云端还没有保存训练计划。' : '当前计划尚未确认云端版本；连接服务端后可跨设备同步。') : '创建你的第一个真实训练计划后，这里会显示安排。'}</ForgeText>{!hasWorkout ? <ForgeButton label="创建训练计划" variant="secondary" onPress={() => router.push('/training/create')} /> : null}</View></ForgeCard></View>

    {(progression.length || (appState.authSession?.accessToken && (progressionStatus === 'idle' || progressionStatus === 'empty' || progressionStatus === 'error'))) ? <View style={styles.section}><ForgeSectionHeader title="渐进建议" />{progressionGeneratedAt ? <ForgeText variant="caption" tone="tertiary">服务端分析于 {formatLocalizedDateTime(progressionGeneratedAt, '时间未知')}</ForgeText> : null}{progressionStale ? <View style={styles.staleNotice} accessibilityLiveRegion="polite"><ForgeText variant="caption" tone="warning">你在分析后完成了新的训练，当前建议可能已过期。</ForgeText><ForgeButton label="重新计算建议" variant="secondary" onPress={() => setProgressionRetryKey((value) => value + 1)} /></View> : null}{progression.length ? <ForgeCard style={styles.progressionCard}>{progression.map((item) => {
      const expanded = expandedProgressionId === item.exerciseId;
      return <Pressable key={item.exerciseId} accessibilityRole="button" accessibilityLabel={item.exerciseName + (expanded ? ' 渐进建议依据，已展开' : ' 渐进建议依据，已收起')} accessibilityHint={expanded ? '双击收起规则依据' : '双击查看规则依据'} accessibilityState={{ expanded }} onPress={() => setExpandedProgressionId(expanded ? null : item.exerciseId)} style={({ pressed }) => [styles.progressionRow, pressed && styles.pressed]}>
        <View style={styles.progressionCopy}>
          <ForgeText variant="label">{item.exerciseName}</ForgeText>
          <ForgeText variant="caption" tone="secondary">最近 {item.latest.weightKg} kg × {item.latest.reps} · {formatShortDate(new Date(item.latest.completedAt))}</ForgeText>
          <ForgeText variant="caption" tone="secondary">{item.suggestion}</ForgeText>
          <ForgeText variant="caption" tone="tertiary">规则 {item.ruleVersion} · 最近 {item.windowDays} 天 · 基于 {item.historyCount} 次记录</ForgeText>
          <ForgeText variant="caption" tone="accent">{expanded ? '收起依据' : '查看依据'}</ForgeText>
          {expanded ? <View style={styles.progressionDetail} accessibilityLiveRegion="polite" accessible accessibilityLabel="渐进建议规则依据已展开">
            <ForgeText variant="caption" tone="secondary">最近一条记录：{item.latest.weightKg} kg × {item.latest.reps}，完成于 {formatShortDate(new Date(item.latest.completedAt))}。</ForgeText>
            {item.previous ? <ForgeText variant="caption" tone="secondary">上一条记录：{item.previous.weightKg} kg × {item.previous.reps}，完成于 {formatShortDate(new Date(item.previous.completedAt))}。</ForgeText> : <ForgeText variant="caption" tone="secondary">目前只有一条有效记录，系统会保持保守，不会用不足的样本强行提高负重。</ForgeText>}
            <ForgeText variant="caption" tone="tertiary">计算范围：最近 {item.windowDays} 天内的已完成记录；规则版本 {item.ruleVersion}，共使用 {item.historyCount} 次记录。</ForgeText>
            {item.ruleActivatedAt ? <ForgeText variant="caption" tone="tertiary">规则激活于 {formatLocalizedDateTime(item.ruleActivatedAt, '时间未知')}。</ForgeText> : null}
            {item.ruleChangeNote ? <ForgeText variant="caption" tone="tertiary">规则变更说明：{item.ruleChangeNote}</ForgeText> : null}
          </View> : null}
        </View>
      </Pressable>;
    })}</ForgeCard> : <ForgeCard style={styles.progressionCard}><View style={styles.emptyRecent} accessibilityLiveRegion="polite" accessible accessibilityLabel={progressionStatus === 'error' ? '渐进建议暂时不可用' : progressionStatus === 'empty' ? '暂无足够的有效样本' : '正在读取渐进建议'}><ForgeText variant="h3">{progressionStatus === 'error' ? '渐进建议暂时不可用' : progressionStatus === 'empty' ? '暂无足够的有效样本' : '正在读取渐进建议'}</ForgeText><ForgeText variant="caption" tone="secondary">{progressionStatus === 'error' ? '服务端暂时无法读取真实训练历史，请重试；不会用示例数据替代。' : progressionStatus === 'empty' ? '完成至少两次同一动作后，FORGE 才会基于真实趋势给出建议。' : '正在读取最近 90 天内的真实完成记录。'}</ForgeText>{progressionStatus === 'error' ? <ForgeButton label="重试渐进建议" variant="secondary" onPress={() => setProgressionRetryKey((value) => value + 1)} /> : null}</View></ForgeCard>}</View> : null}

    <View style={styles.section}><ForgeSectionHeader title="最近一次训练" action={recentSummary ? '查看全部' : undefined} onAction={recentSummary ? () => router.push('/training/history') : undefined} /><ForgeCard style={styles.recentCard}>
      {recentSummary ? <><View style={styles.recentHeader}><View><ForgeText variant="h3">{recentSummary.workoutTitle}</ForgeText><ForgeText variant="caption" tone="secondary">本地记录 · {recentSummary.durationMinutes} 分钟</ForgeText></View><ForgeStatusPill label="已完成" tone="success" /></View>
      <View style={styles.recentMetrics}><ForgeMetric value={`${recentSummary.setCount}`} label="组" /><ForgeMetric value={formatWeight(recentSummary.volumeKg, weightUnit)} label="训练量" align="center" /><ForgeMetric value={`${recentSummary.prCount}`} label="个 PR" align="right" /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="查看最近一次训练总结" onPress={() => router.push('/workout-summary')} style={({ pressed }) => [styles.summaryLink, pressed && styles.pressed]}><ForgeText variant="caption" tone="secondary">查看训练总结</ForgeText><Ionicons name="arrow-forward" size={16} color={colors.textSecondary} /></Pressable></> : <View style={styles.emptyRecent}><ForgeText variant="h3">还没有完成的训练</ForgeText><ForgeText variant="caption" tone="secondary">完成今天的训练后，最近一次训练总结会显示在这里。</ForgeText></View>}
    </ForgeCard></View>
    <Modal visible={deleteOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setDeleteOpen(false)} statusBarTranslucent><Pressable style={styles.scrim} onPress={() => setDeleteOpen(false)}><Pressable style={styles.confirmSheet} onPress={(event) => event.stopPropagation()}><ForgeText variant="h3">删除训练计划？</ForgeText><ForgeText tone="secondary">当前计划和动作安排会从本机移除；已经完成的训练记录会保留。</ForgeText><View style={styles.planActions}><ForgeButton label="取消" variant="secondary" onPress={() => setDeleteOpen(false)} /><Pressable accessibilityRole="button" accessibilityLabel="确认删除训练计划" onPress={() => { actions.deleteWorkoutPlan(); setDeleteOpen(false); }} style={styles.deleteConfirm}><ForgeText variant="label" tone="danger">确认删除</ForgeText></Pressable></View></Pressable></Pressable></Modal>
  </ForgeScreen>;
}


function startOfWeek() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  headerCopy: { gap: spacing.xxs },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxs },
  weekSummary: { width: 76, alignItems: 'flex-end', gap: spacing.xxs, paddingBottom: spacing.xxs },
  weekProgressTrack: { width: '100%', height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.borderSubtle },
  weekProgressFill: { height: '100%', borderRadius: 2, backgroundColor: colors.accent },
  nextCard: { gap: spacing.md, backgroundColor: colors.surface2 },
  cardEyebrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconSquare: { width: 52, height: 52, borderRadius: radius.small, borderCurve: 'continuous', backgroundColor: colors.surface1, alignItems: 'center', justifyContent: 'center' },
  nextCopy: { flex: 1, gap: spacing.xxs },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  adjustmentRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  section: { gap: spacing.xs },
  weekCard: { paddingVertical: spacing.xs },
  weekRow: { minHeight: 64, paddingHorizontal: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  weekRowCurrent: { backgroundColor: colors.accentMuted, borderLeftWidth: 2, borderLeftColor: colors.accent },
  day: { width: 74, gap: spacing.xxs },
  weekDetail: { flex: 1, gap: spacing.xxs },
  recentCard: { gap: spacing.md },
  progressionCard: { gap: spacing.md },
  progressionRow: { paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  progressionCopy: { gap: spacing.xxs },
  progressionDetail: { gap: spacing.xxs, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  staleNotice: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.warning },
  emptyRecent: { minHeight: 88, justifyContent: 'center', gap: spacing.xs },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recentMetrics: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  summaryLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  planActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deleteAction: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, justifyContent: 'center', backgroundColor: colors.scrim },
  confirmSheet: { margin: spacing.lg, padding: spacing.lg, gap: spacing.md, borderRadius: radius.medium, backgroundColor: colors.elevated },
  deleteConfirm: { minHeight: 48, flex: 1, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.68 },
});
