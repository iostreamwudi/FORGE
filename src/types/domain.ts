export type WorkoutStatus = 'scheduled' | 'active' | 'completed';
export type WorkoutSetStatus = 'completed' | 'active' | 'planned';

export interface User { id: string; name: string; initials: string }
export interface Exercise { id: string; name: string; muscleGroup: string; equipment: string }
export interface WorkoutSet {
  id: string;
  label: string;
  last: string;
  kg: number;
  reps: number;
  status: WorkoutSetStatus;
}
export interface WorkoutExercise {
  id: string;
  exercise: Exercise;
  lastPerformance: string;
  target: string;
  sets: WorkoutSet[];
}
export interface TodayWorkout {
  id: string;
  title: string;
  focus: string;
  exerciseCount: number;
  setCount: number;
  estimatedMinutes: number;
  adjustments: number;
  completedSetCount?: number;
  status: WorkoutStatus;
}
export interface Readiness {
  score: number;
  label: 'GOOD' | 'FAIR' | 'LOW';
  factors: { label: string; value: string }[];
  estimated: true;
}
export interface CoachInsight { id: string; headline: string; recommendation: string }
export interface StoredCoachMessage { id: string; role: 'coach' | 'user'; text: string; detail?: string; sourceQuestion?: string; error?: boolean; feedback?: 'up' | 'down'; createdAt?: string; }
export type CoachCommandDraft =
  | { type: 'log_food'; foodName: string; serving?: string; meal?: MealType }
  | { type: 'adjust_workout'; exerciseName: string; addSets?: number; reps?: number; kg?: number }
  | { type: 'set_food_preference'; foodName: string; preference: 'preferred' | 'avoided' | 'available' | 'unavailable' }
  | { type: 'add_food'; foodName: string; serving: string; caloriesPer100g: number; protein: number; carbs: number; fat: number; typicalServingGrams?: number; unit?: string; basis?: string; confidence?: 'high' | 'medium' | 'low' }
  | { type: 'complete_workout' }
  | { type: 'set_weekly_workout_goal'; count: number }
  | { type: 'set_training_preferences'; trainingDays?: number[]; defaultRestSeconds?: number; weightUnit?: WeightUnit };

export interface CoachPlanDraft {
  commands?: CoachCommandDraft[];
  goal?: { type?: GoalType; label?: string; targetWeightKg?: number };
  dailyState?: { weightKg?: number; sleep?: string; fatigue?: string; soreness?: string };
  nutrition?: Partial<NutritionTarget>;
  mealPlan?: { meal: MealType; foodName: string; serving?: string }[];
  workout?: { title?: string; focus?: string; estimatedMinutes?: number; exercises?: { name: string; muscleGroup?: string; equipment?: string; target?: string; sets?: { reps?: number; kg?: number }[] }[] };
}
export interface WorkoutSummary {
  sessionId?: string;
  workoutTitle: string;
  durationMinutes: number;
  setCount: number;
  volumeKg: number;
  prCount: number;
  pr?: { exercise: string; performance: string; kind: string };
  review: { label: 'STRONG' | 'WATCH' | 'NEXT'; text: string }[];
}
export interface WorkoutSession {
  id: string;
  workoutId: string;
  workoutTitle: string;
  startedAt: string;
  completedAt: string;
  exercises: WorkoutExercise[];
  notes?: string;
}

export type GoalType = 'fat_loss' | 'muscle_gain' | 'recomposition' | 'maintenance';
export interface Goal { type: GoalType; label: string; targetWeightKg?: number; }
export type WeightUnit = 'kg' | 'lb';
export interface TrainingPreferences { trainingDays: number[]; defaultRestSeconds?: number; weightUnit?: WeightUnit; }
export interface NotificationPreferences { workoutReminderEnabled: boolean; reminderHour: number; reminderMinute: number; scheduledNotificationIds?: string[]; }
export interface UserProfile { id: string; name: string; initials: string; emailVerified?: boolean; goal: Goal; weeklyWorkoutGoal?: number; trainingPreferences?: TrainingPreferences; notificationPreferences?: NotificationPreferences; coachDataConsent?: boolean; }
export interface AuthSession { accessToken: string; refreshToken?: string; profile: UserProfile; }
export interface NutritionTarget { calories: number; protein: number; carbs: number; fat: number; }
export type DataSource = 'manual' | 'health' | 'mixed' | 'unknown';
export type DailyStateQuality = 'complete' | 'partial' | 'unknown';
export interface DailyState { readinessScore: number; readinessLabel: 'GOOD' | 'FAIR' | 'LOW'; weightKg?: number; sleep: string; fatigue: string; soreness: string; source: string; sourceType?: DataSource; quality?: DailyStateQuality; updatedAt?: string; }
export interface HealthSnapshot { id: string; source: 'Apple 健康' | 'Health Connect'; observedAt: string; weightKg?: number; sleepHours?: number; }
export interface DailyNutrition extends NutritionTarget { consumedCalories: number; consumedProtein: number; consumedCarbs: number; consumedFat: number; }
export interface DailyPlan { date: string; workout: TodayWorkout; nutritionTarget: NutritionTarget; bodyState: DailyState; coachAdjustments: string[]; goal?: Goal; }
export interface Food { id: string; name: string; caloriesPer100g: number; protein: number; carbs: number; fat: number; defaultServing: string; typicalServingGrams?: number; available: boolean; preferred: boolean; locked: boolean; avoided: boolean; unit?: string; }

export function getFoodPortionGrams(food: Pick<Food, 'defaultServing' | 'typicalServingGrams'>): number {
  const explicit = Number(food.typicalServingGrams);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit * 10) / 10;
  const parsed = Number.parseFloat(food.defaultServing);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 10) / 10 : 100;
}
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export interface FoodEntry { id: string; foodId: string; name: string; serving: string; calories: number; protein: number; carbs: number; fat: number; createdAt?: string; consumedAt?: string; meal?: MealType; }
export interface PlannedMeal { id: string; meal: MealType; foodId: string; foodName: string; serving: string; calories: number; protein: number; carbs: number; fat: number; }
export interface MealRecommendation { id: string; title: string; estimatedCalories: number; items: { foodId: string; name: string; serving: string; }[]; }
export interface CoachAction { id: string; label: string; description?: string; type: 'apply' | 'navigate' | 'info'; }
