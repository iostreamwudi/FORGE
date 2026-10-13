import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import Animated, { FadeInDown, FadeOutDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ForgeActionSheet, ForgeBottomSheet, ForgeButton, ForgeIconButton, ForgeText, colors, control, motion, radius, spacing } from '@/design-system';
import { WorkoutExerciseCard } from './WorkoutExerciseCard';
import { useActiveWorkout } from './useActiveWorkout';
import type { SetEditorTarget } from './useActiveWorkout';
import type { Exercise, WorkoutExercise } from '@/types/domain';
import { displayWeight, inputWeightToKg } from '@/utils/weight';
import { isAuthServiceConfigured, searchExerciseCatalog, type ExerciseCatalogItem } from '@/data/authClient';

function buildWeightOptions(valueKg: number, unit: 'kg' | 'lb'): number[] {
  const value = displayWeight(valueKg, unit); const step = unit === 'lb' ? 5 : 2.5;
  return [...new Set([Math.max(0, value - step), value, value + step])].sort((left, right) => left - right);
}

function buildRepOptions(value: number): number[] {
  return [...new Set([Math.max(1, value - 2), value, value + 2])].sort((left, right) => left - right);
}

export function ActiveWorkoutScreen() {
  const insets = useSafeAreaInsets();
  const workout = useActiveWorkout();
  const [editor, setEditor] = useState<SetEditorTarget>(null);
  const [exerciseMenu, setExerciseMenu] = useState<WorkoutExercise | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<WorkoutExercise | null>(null);
  const [replaceQuery, setReplaceQuery] = useState('');
  const [replaceResults, setReplaceResults] = useState<ExerciseCatalogItem[]>([]);
  const [replaceStatus, setReplaceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [replaceError, setReplaceError] = useState('');
  const [finishOpen, setFinishOpen] = useState(false);
  const replaceAbortRef = useRef<AbortController | null>(null);
  const accessToken = workout.authSession?.accessToken;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const reduceMotion = useReducedMotion();
  const weightUnit = workout.profile.trainingPreferences?.weightUnit ?? 'kg';
  useEffect(() => {
    const startedAt = workout.workoutStartedAt ?? Date.now();
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [workout.workoutStartedAt]);
  const restTimer = workout.restSeconds === null ? '' : `${String(Math.floor(workout.restSeconds / 60)).padStart(2, '0')}:${String(workout.restSeconds % 60).padStart(2, '0')}`;
  const workoutTimer = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  const isRestComplete = workout.restSeconds === 0;
  const restBottom = Math.max(insets.bottom, spacing.sm);
  const scrollBottomPadding = workout.restSeconds === null ? insets.bottom + spacing.huge : restBottom + control.restBar + spacing.xl;
  const finishWorkout = () => {
    const completed = workout.completedSetCount;
    const total = workout.dailyPlan.workout.setCount;
    if (completed >= total && total > 0) { workout.finishWorkout(); router.push('/workout-summary'); return; }
    const incomplete = Math.max(0, total - completed);
    setFinishOpen(true);
  };
  const finishWithoutComplete = () => { setFinishOpen(false); workout.finishWorkout(); router.back(); };
  const finishAndReview = () => { setFinishOpen(false); workout.finishWorkout(); router.push('/workout-summary'); };

  const chooseValue = (value: string | number) => {
    if (editor) {
      const next = editor.field === 'kg' ? inputWeightToKg(Number(value), weightUnit) : Number(value);
      workout.updateSet(editor.set.id, editor.field, next);
    }
    setEditor(null);
  };

  const openExerciseMenu = (item: WorkoutExercise) => setExerciseMenu(item);
  const removeExercise = () => {
    if (!exerciseMenu) return;
    const target = exerciseMenu;
    setExerciseMenu(null);
    Alert.alert('移除动作？', `从今天的训练中移除${target.exercise.name}？`, [{ text: '取消', style: 'cancel' }, { text: '移除', style: 'destructive', onPress: () => workout.removeExercise(target.id) }]);
  };
  const openReplace = () => { setReplaceTarget(exerciseMenu); setExerciseMenu(null); setReplaceQuery(''); setReplaceResults([]); setReplaceStatus('idle'); setReplaceError(''); };
  const searchReplacement = useCallback(async (input = replaceQuery) => {
    const query = input.trim();
    if (!query) { setReplaceStatus('error'); setReplaceError('请输入动作名称后再搜索动作库。'); return; }
    if (!accessToken || !isAuthServiceConfigured()) { setReplaceStatus('error'); setReplaceError('动作库需要登录并连接 FORGE API；当前不会显示示例动作。'); return; }
    replaceAbortRef.current?.abort(); const controller = new AbortController(); replaceAbortRef.current = controller; setReplaceStatus('loading'); setReplaceError('');
    try { const results = await searchExerciseCatalog(accessToken, query, controller.signal); if (!controller.signal.aborted) { setReplaceResults(results); setReplaceStatus('ready'); } } catch { if (!controller.signal.aborted) { setReplaceStatus('error'); setReplaceError('动作库搜索失败，请稍后重试。'); } }
  }, [accessToken, replaceQuery]);
  useEffect(() => {
    if (!replaceTarget || replaceQuery.trim().length < 2 || !accessToken || !isAuthServiceConfigured()) return;
    const timeout = setTimeout(() => { void searchReplacement(); }, 450);
    return () => clearTimeout(timeout);
  }, [accessToken, replaceQuery, replaceTarget, searchReplacement]);
  const selectReplacement = (item: ExerciseCatalogItem) => { if (!replaceTarget) return; const replacement: Exercise = { id: item.id, name: item.name, muscleGroup: item.muscleGroup, equipment: item.equipment }; workout.replaceExercise(replaceTarget.id, replacement); setReplaceTarget(null); };

  return <View style={[styles.screen, { paddingTop: insets.top }]}> 
    <View style={styles.header}><ForgeIconButton icon="chevron-back" label="返回今日" variant="ghost" onPress={() => router.back()} /><View style={styles.title}><ForgeText variant="h3">{workout.dailyPlan.workout.title}</ForgeText><ForgeText variant="caption" tone="secondary">{workoutTimer}</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel="结束训练" onPress={finishWorkout} style={({ pressed }) => [styles.finish, pressed && styles.pressed]}><ForgeText variant="caption" tone="secondary">结束</ForgeText></Pressable></View>
    <View accessibilityLabel={`已完成 ${workout.completedSetCount} / ${workout.dailyPlan.workout.setCount} 组`} style={styles.progressSection}><ForgeText variant="caption" tone="tertiary">{workout.completedSetCount} / {workout.dailyPlan.workout.setCount} 组</ForgeText><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, (workout.completedSetCount / workout.dailyPlan.workout.setCount) * 100)}%` }]} /></View></View>
    <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPadding }]}>{workout.exercises.map((exercise) => <WorkoutExerciseCard key={exercise.id} item={exercise} weightUnit={weightUnit} onEdit={setEditor} onComplete={workout.completeSet} onExerciseAction={openExerciseMenu} />)}</ScrollView>
    {workout.lastAddedSet ? <View accessibilityLiveRegion="polite" style={[styles.undoBar, { bottom: workout.restSeconds === null ? insets.bottom + spacing.md : restBottom + control.restBar + spacing.sm }]}><ForgeText variant="label">已增加一组</ForgeText><Pressable accessibilityRole="button" accessibilityLabel="撤销增加的训练组" onPress={workout.undoLastAddedSet} style={({ pressed }) => [styles.undoAction, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">撤销</ForgeText></Pressable></View> : null}

    {workout.restSeconds !== null ? <Animated.View entering={!reduceMotion ? FadeInDown.duration(motion.standard) : undefined} exiting={!reduceMotion ? FadeOutDown.duration(motion.fast) : undefined} accessibilityLiveRegion="polite" accessibilityLabel={`${isRestComplete ? '休息完成' : '休息计时'} ${restTimer}`} style={[styles.restBar, isRestComplete && styles.restBarComplete, { bottom: restBottom }]}><View style={styles.restCopy}><ForgeText variant="label" tone={isRestComplete ? 'success' : 'secondary'}>{isRestComplete ? '准备好' : '休息'}</ForgeText><ForgeText variant="h2">{restTimer}</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel="增加 30 秒" onPress={workout.addRestTime} style={({ pressed }) => [styles.addTime, pressed && styles.pressed]}><ForgeText variant="caption">+30 秒</ForgeText></Pressable></Animated.View> : null}

    <ForgeBottomSheet visible={editor !== null} title={editor?.field === 'kg' ? `重量（${weightUnit}）` : '次数'} options={editor?.field === 'kg' ? buildWeightOptions(editor.set.kg, weightUnit) : buildRepOptions(editor?.set.reps ?? 1)} selected={editor?.field === 'kg' ? displayWeight(editor.set.kg, weightUnit) : editor?.set.reps} onSelect={chooseValue} onClose={() => setEditor(null)} />
    <Modal visible={finishOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setFinishOpen(false)} statusBarTranslucent><Pressable style={styles.scrim} onPress={() => setFinishOpen(false)}><Pressable style={styles.finishSheet} onPress={(event) => event.stopPropagation()}><ForgeText variant="h2">{workout.completedSetCount === 0 ? '还没有完成训练组' : `还有 ${Math.max(0, workout.dailyPlan.workout.setCount - workout.completedSetCount)} 组未完成`}</ForgeText><ForgeText tone="secondary">{workout.completedSetCount === 0 ? '至少完成一组后才能记入训练记录。' : '你可以继续训练，或结束本次训练但不计入完成。'}</ForgeText><ForgeButton label="继续训练" variant="secondary" onPress={() => setFinishOpen(false)} /><Pressable accessibilityRole="button" accessibilityLabel="结束但不计入完成" onPress={finishWithoutComplete} style={({ pressed }) => [styles.finishWithoutComplete, pressed && styles.pressed]}><ForgeText variant="label" tone="warning">结束但不计入完成</ForgeText></Pressable>{workout.completedSetCount > 0 ? <ForgeButton label="结束并查看复盘" onPress={finishAndReview} /> : null}</Pressable></Pressable></Modal>
    <ForgeActionSheet visible={exerciseMenu !== null} title="动作选项" subtitle={exerciseMenu?.exercise.name} options={[{ label: '动作详情', onPress: () => workout.showToast(`${exerciseMenu?.exercise.name}：${exerciseMenu?.exercise.muscleGroup} · ${exerciseMenu?.exercise.equipment}`) }, { label: '替换今天的动作', onPress: openReplace }, { label: '增加一组', onPress: () => exerciseMenu && workout.addSet(exerciseMenu.id) }, { label: '从训练中移除', tone: 'danger', onPress: removeExercise }]} onClose={() => setExerciseMenu(null)} />
    <Modal visible={replaceTarget !== null} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setReplaceTarget(null)} statusBarTranslucent><Pressable style={styles.scrim} onPress={() => setReplaceTarget(null)}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.replaceKeyboard}><Pressable style={styles.replaceSheet} onPress={(event) => event.stopPropagation()}><ForgeText variant="h2">替换动作</ForgeText><ForgeText variant="caption" tone="secondary">只选择 FORGE 服务端返回的真实动作。输入两个字后会自动搜索。</ForgeText><TextInput accessibilityLabel="搜索替换动作" value={replaceQuery} onChangeText={setReplaceQuery} placeholder="输入动作名称" placeholderTextColor={colors.textTertiary} style={styles.replaceInput} /><ForgeButton label={replaceStatus === 'loading' ? '搜索中…' : '搜索动作库'} onPress={() => { void searchReplacement(); }} disabled={replaceStatus === 'loading'} />{replaceStatus === 'error' ? <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.replaceFeedback}><ForgeText variant="caption" tone="danger">{replaceError}</ForgeText><ForgeButton label="重试搜索" variant="secondary" onPress={() => { void searchReplacement(); }} /></View> : null}{replaceStatus === 'ready' && replaceResults.length === 0 ? <ForgeText variant="caption" tone="secondary">没有匹配动作，可以换一个名称。</ForgeText> : null}{replaceResults.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`选择 ${item.name}`} onPress={() => selectReplacement(item)} style={({ pressed }) => [styles.replaceRow, pressed && styles.pressed]}><View style={styles.replaceCopy}><ForgeText variant="label">{item.name}</ForgeText><ForgeText variant="caption" tone="secondary">{item.muscleGroup} · {item.equipment}</ForgeText>{item.category || item.primaryMuscles?.length ? <ForgeText variant="caption" tone="secondary">{[item.category, item.primaryMuscles?.join('、')].filter(Boolean).join(' · ')}</ForgeText> : null}{item.sourceName ? <ForgeText variant="caption" tone="tertiary">来源 · {item.sourceName}{item.license ? ' · ' + item.license : ''}</ForgeText> : null}</View><ForgeText variant="caption" tone="accent">选择</ForgeText></Pressable>)}<ForgeButton label="关闭" variant="secondary" onPress={() => setReplaceTarget(null)} /></Pressable></KeyboardAvoidingView></Pressable></Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, header: { height: 54, paddingHorizontal: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }, finish: { minWidth: 60, minHeight: control.touch, alignItems: 'center', justifyContent: 'center' }, pressed: { opacity: 0.65 }, progressSection: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxs, paddingBottom: spacing.xs, gap: spacing.xs }, progressTrack: { height: 2, backgroundColor: colors.surface2 }, progressFill: { height: 2, backgroundColor: colors.accent }, content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm }, undoBar: { position: 'absolute', left: spacing.md, right: spacing.md, minHeight: control.touch, paddingHorizontal: spacing.md, borderRadius: radius.medium, backgroundColor: colors.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 50 }, undoAction: { minWidth: 64, minHeight: control.touch, alignItems: 'center', justifyContent: 'center' }, restBar: { position: 'absolute', left: spacing.md, right: spacing.md, minHeight: control.restBar, paddingHorizontal: spacing.md, backgroundColor: colors.elevated, borderRadius: radius.medium, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, restBarComplete: { borderColor: colors.success }, restCopy: { flex: 1, minHeight: control.touch, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }, addTime: { minWidth: 56, minHeight: control.touch, borderRadius: radius.small, borderCurve: 'continuous', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim }, finishSheet: { maxHeight: '80%', backgroundColor: colors.elevated, borderTopLeftRadius: radius.large, borderTopRightRadius: radius.large, padding: spacing.lg, gap: spacing.md }, finishWithoutComplete: { minHeight: control.button, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.warning, alignItems: 'center', justifyContent: 'center' }, replaceKeyboard: { flex: 1, justifyContent: 'flex-end' }, replaceSheet: { maxHeight: '85%', backgroundColor: colors.elevated, borderTopLeftRadius: radius.large, borderTopRightRadius: radius.large, padding: spacing.lg, gap: spacing.md }, replaceInput: { minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, fontSize: 16 }, replaceFeedback: { gap: spacing.sm }, replaceRow: { minHeight: 56, padding: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, replaceCopy: { flex: 1, gap: spacing.xxs },
});
