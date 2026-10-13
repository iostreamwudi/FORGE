import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, ZoomIn, useReducedMotion } from 'react-native-reanimated';
import { Pressable, StyleSheet, View } from 'react-native';
import { ForgeCard, ForgeText, colors, control, motion, radius, spacing } from '@/design-system';
import type { WorkoutExercise, WorkoutSet } from '@/types/domain';
import type { SetEditorTarget } from './useActiveWorkout';
import { formatWeight } from '@/utils/weight';

export function WorkoutExerciseCard({ item, weightUnit, onEdit, onComplete, onExerciseAction }: { item: WorkoutExercise; weightUnit: 'kg' | 'lb'; onEdit: (target: SetEditorTarget) => void; onComplete: (setId: string) => void; onExerciseAction: (item: WorkoutExercise) => void }) {
  return (
    <ForgeCard style={styles.card}>
      <View style={styles.heading}><View style={styles.headingCopy}><ForgeText variant="h3">{item.exercise.name}</ForgeText><ForgeText variant="caption" tone="secondary">{item.exercise.muscleGroup} · {item.exercise.equipment}</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel={`${item.exercise.name} options`} hitSlop={10} onPress={() => onExerciseAction(item)} style={({ pressed }) => [styles.exerciseMenu, pressed && styles.editCellPressed]}><Ionicons name="ellipsis-horizontal" color={colors.textTertiary} size={20} /></Pressable></View>
      <View style={styles.targets}><View style={styles.target}><ForgeText variant="label" tone="tertiary">上次</ForgeText><ForgeText variant="caption">{item.lastPerformance}</ForgeText></View><View style={styles.target}><ForgeText variant="label" tone="accent">目标</ForgeText><ForgeText variant="caption">{item.target}</ForgeText></View></View>
      <View style={styles.table}>
        <View style={styles.tableHeader}><TableText flex={0.55}>组</TableText><TableText>上次</TableText><TableText>重量</TableText><TableText>次数</TableText><View style={styles.statusHeader} /></View>
        {item.sets.map((set) => <SetRow key={set.id} set={set} weightUnit={weightUnit} onEdit={onEdit} onComplete={onComplete} />)}
      </View>
    </ForgeCard>
  );
}

function TableText({ children, flex = 1 }: { children: React.ReactNode; flex?: number }) {
  return <ForgeText variant="caption" tone="tertiary" style={{ flex }}>{children}</ForgeText>;
}

function SetRow({ set, weightUnit, onEdit, onComplete }: { set: WorkoutSet; weightUnit: 'kg' | 'lb'; onEdit: (target: SetEditorTarget) => void; onComplete: (setId: string) => void }) {
  const isActive = set.status === 'active';
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View entering={!reduceMotion && isActive ? FadeIn.duration(motion.fast) : undefined} style={[styles.row, isActive && styles.activeRow]}>
      <ForgeText variant="caption" tone={isActive ? 'accent' : 'secondary'} style={styles.setCell}>{set.label}</ForgeText>
      <ForgeText variant="caption" tone="secondary" style={styles.dataCell}>{set.last}</ForgeText>
      <Pressable accessibilityRole="button" accessibilityLabel={`编辑第 ${set.label} 组重量，当前 ${formatWeight(set.kg, weightUnit)}`} onPress={() => onEdit({ set, field: 'kg' })} style={({ pressed }) => [styles.dataCell, styles.editCell, pressed && styles.editCellPressed]}><ForgeText>{formatWeight(set.kg, weightUnit)}</ForgeText><Ionicons name="chevron-down" size={10} color={colors.textTertiary} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`编辑第 ${set.label} 组次数，当前 ${set.reps}`} onPress={() => onEdit({ set, field: 'reps' })} style={({ pressed }) => [styles.dataCell, styles.editCell, pressed && styles.editCellPressed]}><ForgeText>{set.reps}</ForgeText><Ionicons name="chevron-down" size={10} color={colors.textTertiary} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={set.status === 'completed' ? `第 ${set.label} 组已完成` : `完成第 ${set.label} 组`} accessibilityState={{ disabled: !isActive }} disabled={!isActive} onPress={() => onComplete(set.id)} style={styles.statusCell}>
        {set.status === 'completed' ? <Animated.View entering={!reduceMotion ? ZoomIn.duration(motion.fast) : undefined} style={styles.completed}><Ionicons name="checkmark" size={14} color={colors.success} /></Animated.View> : <View style={[styles.completeButton, isActive && styles.completeButtonActive]} />}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: 'hidden', gap: spacing.sm }, heading: { paddingHorizontal: spacing.md, paddingTop: spacing.md, flexDirection: 'row', justifyContent: 'space-between' }, headingCopy: { gap: spacing.xxs }, exerciseMenu: { minWidth: control.touch, minHeight: control.touch, alignItems: 'center', justifyContent: 'center' },
  targets: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.xxl }, target: { flex: 1, gap: 2 }, table: { paddingBottom: spacing.xxs },
  tableHeader: { minHeight: 28, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  row: { minHeight: control.row, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: 2, borderLeftColor: 'transparent', borderTopColor: colors.borderSubtle },
  activeRow: { backgroundColor: colors.activeSurface, borderLeftColor: colors.accent },
  setCell: { flex: 0.55 }, dataCell: { flex: 1 }, editCell: { minHeight: control.touch, borderRadius: radius.small, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs }, editCellPressed: { backgroundColor: colors.surfacePressed },
  statusHeader: { width: 40 }, statusCell: { width: 40, minHeight: control.touch, alignItems: 'center', justifyContent: 'center' },
  completeButton: { width: 22, height: 22, borderRadius: radius.round, borderWidth: 1, borderColor: colors.textTertiary }, completeButtonActive: { borderColor: colors.accent, borderWidth: 2 },
  completed: { width: 22, height: 22, borderRadius: radius.round, borderWidth: 1, borderColor: colors.success, alignItems: 'center', justifyContent: 'center' },
});
