import type { WorkoutExercise, WorkoutSession, WorkoutSet, WorkoutSummary } from '@/types/domain';

export function getCompletedSets(exercises: WorkoutExercise[]): WorkoutSet[] {
  return exercises.flatMap((exercise) => exercise.sets).filter((set) => set.status === 'completed');
}

export function getVolumeKg(exercises: WorkoutExercise[]): number {
  return Math.round(getCompletedSets(exercises).reduce((total, set) => total + set.kg * set.reps, 0));
}

export function estimateOneRepMax(set: WorkoutSet): number {
  return set.kg * (1 + set.reps / 30);
}

function getBestSet(exercises: WorkoutExercise[], exerciseId: string): WorkoutSet | null {
  const sets = exercises.find((item) => item.exercise.id === exerciseId)?.sets.filter((set) => set.status === 'completed') ?? [];
  return sets.reduce<WorkoutSet | null>((best, set) => !best || estimateOneRepMax(set) > estimateOneRepMax(best) ? set : best, null);
}

function getPersonalRecords(exercises: WorkoutExercise[], previousSessions: WorkoutSession[]) {
  const records = exercises.flatMap((exercise) => {
    const bestSet = getBestSet(exercises, exercise.exercise.id);
    if (!bestSet) return [];
    const previousBest = previousSessions.flatMap((session) => {
      const previousSet = getBestSet(session.exercises, exercise.exercise.id);
      return previousSet ? [estimateOneRepMax(previousSet)] : [];
    }).reduce((best, value) => Math.max(best, value), 0);
    return estimateOneRepMax(bestSet) > previousBest ? [{ exercise, set: bestSet }] : [];
  });
  return records;
}

function formatSet(set: WorkoutSet): string {
  return `${set.kg} kg × ${set.reps}`;
}

export function buildWorkoutSummary({
  sessionId,
  workoutTitle,
  exercises,
  startedAt,
  completedAt = new Date(),
  previousSessions = [],
}: {
  sessionId?: string;
  workoutTitle: string;
  exercises: WorkoutExercise[];
  startedAt: number | string | null;
  completedAt?: Date | string;
  previousSessions?: WorkoutSession[];
}): WorkoutSummary {
  const completedSets = getCompletedSets(exercises);
  const started = startedAt ? new Date(startedAt).getTime() : new Date(completedAt).getTime();
  const ended = new Date(completedAt).getTime();
  const durationMinutes = Math.max(1, Math.round((Math.max(0, ended - started) / 60000)));
  const records = getPersonalRecords(exercises, previousSessions);
  const topRecord = records[0];
  const volumeKg = getVolumeKg(exercises);
  const review: WorkoutSummary['review'] = [];
  if (records.length > 0) review.push({ label: 'STRONG', text: `${records[0].exercise.exercise.name} 创下了新的表现纪录。` });
  if (completedSets.length === 0) review.push({ label: 'WATCH', text: '还没有完成的训练组，完成后这里会生成复盘。' });
  else if (volumeKg > 0) review.push({ label: 'WATCH', text: `本次完成 ${completedSets.length} 组，累计训练量 ${volumeKg.toLocaleString()} kg。` });
  review.push({ label: 'NEXT', text: records.length > 0 ? `下次优先保持 ${formatSet(records[0].set)}。` : '继续记录下一次训练，FORGE 会逐步建立你的个人基线。' });
  return {
    sessionId,
    workoutTitle,
    durationMinutes,
    setCount: completedSets.length,
    volumeKg,
    prCount: records.length,
    pr: topRecord ? { exercise: topRecord.exercise.exercise.name, performance: formatSet(topRecord.set), kind: '估算 1RM 新高' } : undefined,
    review,
  };
}

export function createWorkoutSession({
  workoutId,
  workoutTitle,
  exercises,
  startedAt,
  completedAt = new Date(),
}: {
  workoutId: string;
  workoutTitle: string;
  exercises: WorkoutExercise[];
  startedAt: number | null;
  completedAt?: Date;
}): WorkoutSession {
  const ended = completedAt.toISOString();
  return {
    id: `session-${completedAt.getTime()}`,
    workoutId,
    workoutTitle,
    startedAt: new Date(startedAt ?? completedAt.getTime()).toISOString(),
    completedAt: ended,
    exercises: JSON.parse(JSON.stringify(exercises)) as WorkoutExercise[],
  };
}

