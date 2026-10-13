import type { TodayWorkout } from '@/types/domain';

export interface WorkoutRepository {
  getTodayWorkout(): Promise<TodayWorkout | null>;
  saveWorkout(workout: TodayWorkout): Promise<void>;
}

// Workout persistence belongs here; screens must consume repository-backed state.
