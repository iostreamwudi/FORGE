import type { DailyNutrition, DailyPlan, DailyState, UserProfile, WorkoutExercise, TodayWorkout } from '@/types/domain';

/**
 * First-run state for a real account. Empty values are intentional: the app
 * must never present invented health, workout, nutrition, or food data.
 */
export function createEmptyProfile(): UserProfile {
  return { id: 'local-user', name: '', initials: '', goal: { type: 'maintenance', label: '未设置' } };
}

export function createEmptyDailyState(): DailyState {
  return { readinessScore: 0, readinessLabel: 'LOW', sleep: '未记录', fatigue: '未记录', soreness: '未记录', source: '未记录', sourceType: 'unknown', quality: 'unknown' };
}

export function createEmptyNutrition(): DailyNutrition {
  return { calories: 0, protein: 0, carbs: 0, fat: 0, consumedCalories: 0, consumedProtein: 0, consumedCarbs: 0, consumedFat: 0 };
}

export function createEmptyWorkout(): TodayWorkout {
  return { id: '', title: '尚未创建训练计划', focus: '完成个人设置后开始', exerciseCount: 0, setCount: 0, estimatedMinutes: 0, adjustments: 0, status: 'scheduled' };
}

export function createEmptyDailyPlan(): DailyPlan {
  return { date: new Date().toISOString().slice(0, 10), workout: createEmptyWorkout(), nutritionTarget: createEmptyNutrition(), bodyState: createEmptyDailyState(), coachAdjustments: [], goal: createEmptyProfile().goal };
}

export function createEmptyExercises(): WorkoutExercise[] {
  return [];
}
