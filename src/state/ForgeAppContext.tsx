import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ForgeText, colors, control, radius, spacing } from '@/design-system';
import { CURRENT_SNAPSHOT_VERSION, loadForgeSnapshot, loadWebAuthSession, saveForgeSnapshot, saveWebAuthSession, type ForgeSnapshot } from '@/data/repositories/ForgeRepository';
import { getForgeSnapshot, isAuthServiceConfigured, refreshAuthSession, requestLogout, restoreAuthSession, syncForgeSnapshot } from '@/data/authClient';
import { createEmptyDailyPlan, createEmptyDailyState, createEmptyExercises, createEmptyNutrition, createEmptyProfile } from '@/data/emptyState';
import { buildWorkoutSummary, createWorkoutSession } from '@/utils/workoutMetrics';
import { formatLocalizedDate, formatLocalizedDateTime } from '@/utils/date';
import type { AuthSession, CoachCommandDraft, CoachPlanDraft, DailyNutrition, DailyPlan, DailyState, Exercise, Food, FoodEntry, Goal, HealthSnapshot, MealType, NotificationPreferences, NutritionTarget, PlannedMeal, StoredCoachMessage, TodayWorkout, TrainingPreferences, UserProfile, WorkoutExercise, WorkoutSession, WorkoutSet, WorkoutSummary } from '@/types/domain';
import { getFoodPortionGrams } from '@/types/domain';

type WorkoutStatus = 'scheduled' | 'active' | 'completed';
type ToastAction = { label: string; onPress: () => void };
type PersistenceStatus = 'loading' | 'ready' | 'saving' | 'error';
type CloudSyncStatus = 'disabled' | 'idle' | 'syncing' | 'synced' | 'error' | 'offline' | 'conflict';
type CloudConnectivity = 'online' | 'offline' | 'unknown';
type CloudSnapshotCounts = { exerciseCount: number; trainingCount: number; foodCount: number; foodEntryCount: number; healthCount: number; coachMessageCount: number };
type CloudSnapshotSummary = CloudSnapshotCounts & { revision: number; updatedAt: string | null };
type CloudSnapshotDiff = { local: CloudSnapshotCounts; remote: CloudSnapshotCounts; changedDomains: string[] };
export type CoachCommandExecutionResult = { command?: CoachCommandDraft; status: 'applied' | 'skipped' | 'failed'; reason?: string; detail?: string };
export type ApplyCoachPlanResult = { changed: boolean; commandsApplied: number; duplicateCommandsSkipped: number; results: CoachCommandExecutionResult[] };

type ForgeAppState = {
  exercises: WorkoutExercise[];
  workout: TodayWorkout;
  completedSessions: WorkoutSession[];
  profile: UserProfile;
  authSession: AuthSession | null;
  hydrated: boolean;
  setAuthSession: (session: AuthSession) => void;
  signOut: () => void;
  dailyPlan: DailyPlan;
  workoutStatus: WorkoutStatus;
  restSeconds: number | null;
  workoutStartedAt: number | null;
  completedSetCount: number;
  coachInsightApplied: boolean;
  updateSet: (setId: string, field: 'kg' | 'reps', value: number) => void;
  completeSet: (setId: string) => void;
  addRestTime: () => void;
  startWorkout: () => void;
  applyCoachInsight: (exerciseName?: string) => ApplyCoachPlanResult;
  undoCoachInsight: () => void;
  finishWorkout: () => void;
  markWorkoutComplete: () => void;
  currentSummary: WorkoutSummary;
  recentSummary: WorkoutSummary | null;
  addSet: (exerciseId: string) => void;
  lastAddedSet: { exerciseId: string; setId: string } | null;
  undoLastAddedSet: () => void;
  removeExercise: (exerciseId: string) => void;
  replaceExercise: (exerciseId: string, replacement: Exercise) => void;
  createWorkoutPlan: (input: Pick<TodayWorkout, 'title' | 'focus' | 'estimatedMinutes'> & { exercises: WorkoutExercise[] }) => void;
  updateWorkoutPlan: (input: Pick<TodayWorkout, 'title' | 'focus' | 'estimatedMinutes'> & { exercises: WorkoutExercise[] }) => void;
  deleteWorkoutPlan: () => void;
  updateGoal: (goal: Goal) => void;
  updateWeeklyWorkoutGoal: (goal?: number) => void;
  updateTrainingPreferences: (preferences: TrainingPreferences) => void;
  updateNotificationPreferences: (preferences?: NotificationPreferences) => void;
  updateCoachDataConsent: (enabled: boolean) => void;
  applyCoachPlan: (plan: CoachPlanDraft) => ApplyCoachPlanResult;
  updateSessionNotes: (sessionId: string, notes: string) => void;
  updateDailyState: (state: Pick<DailyState, 'weightKg' | 'sleep' | 'fatigue' | 'soreness'>) => void;
  applyHealthData: (input: { weightKg?: number; sleepHours?: number; source: string; observedAt: string }) => void;
  healthSnapshots: HealthSnapshot[];
  recordHealthSnapshot: (snapshot: Omit<HealthSnapshot, 'id'>) => void;
  mergeHealthSnapshots: (snapshots: HealthSnapshot[]) => void;
  clearHealthSnapshots: () => void;
  showToast: (message: string, action?: ToastAction) => void;
  cloudSyncStatus: CloudSyncStatus;
  cloudConnectivity: CloudConnectivity;
  cloudSyncError: string | null;
  cloudSyncPending: boolean;
  cloudRevision: number;
  syncNow: () => Promise<void>;
  restoreFromCloud: () => Promise<void>;
  inspectCloud: () => Promise<void>;
  mergeCloudConflict: () => Promise<void>;
  cloudRemoteSummary: CloudSnapshotSummary | null;
  cloudRemoteDiff: CloudSnapshotDiff | null;
  coachMessages: StoredCoachMessage[];
  setCoachMessages: (messages: StoredCoachMessage[]) => void;
  nutrition: DailyNutrition;
  foodEntries: FoodEntry[];
  foods: Food[];
  mealPlan: PlannedMeal[];
  mealPlanApplied: boolean;
  applyMealPlan: (items?: CoachPlanDraft['mealPlan']) => ApplyCoachPlanResult;
  undoMealPlan: () => void;
  addFoodEntry: (foodId: string, input?: { serving?: string; meal?: MealType; consumedAt?: string }) => void;
  createFood: (food: Omit<Food, 'id' | 'available' | 'preferred' | 'locked' | 'avoided'>) => void;
  updateFood: (foodId: string, input: { typicalServingGrams: number }) => void;
  removeFood: (foodId: string) => void;
  updateNutritionTarget: (target: NutritionTarget) => void;
  removeFoodEntry: (entryId: string) => void;
  updateFoodEntry: (entryId: string, input: { serving: string; meal?: MealType; consumedAt?: string }) => void;
  setFoodAvailable: (foodId: string, available: boolean) => void;
  toggleFoodStatus: (foodId: string, key: 'available' | 'preferred' | 'locked' | 'avoided') => void;
};

function isRestorableCloudSnapshot(snapshot: ForgeSnapshot | null): snapshot is ForgeSnapshot {
  return Boolean(snapshot
    && snapshot.version === CURRENT_SNAPSHOT_VERSION
    && Array.isArray(snapshot.exercises)
    && Array.isArray(snapshot.completedSessions)
    && snapshot.profile && typeof snapshot.profile === 'object'
    && snapshot.dailyState && typeof snapshot.dailyState === 'object'
    && ['scheduled', 'active', 'completed'].includes(snapshot.workoutStatus)
    && snapshot.nutrition && typeof snapshot.nutrition === 'object'
    && Array.isArray(snapshot.foodEntries)
    && Array.isArray(snapshot.foods)
    && Array.isArray(snapshot.coachMessages)
    && Array.isArray(snapshot.healthSnapshots));
}

function cloudSnapshotCounts(snapshot: ForgeSnapshot): CloudSnapshotCounts {
  return {
    exerciseCount: snapshot.exercises.length,
    trainingCount: snapshot.completedSessions.length,
    foodCount: snapshot.foods.length,
    foodEntryCount: snapshot.foodEntries.length,
    healthCount: snapshot.healthSnapshots.length,
    coachMessageCount: snapshot.coachMessages.length,
  };
}
function cloudSnapshotSummary(remote: { revision: number; updatedAt: string | null; snapshot: ForgeSnapshot }): CloudSnapshotSummary {
  return { revision: remote.revision, updatedAt: remote.updatedAt, ...cloudSnapshotCounts(remote.snapshot) };
}
function cloudSnapshotDiff(local: ForgeSnapshot, remote: ForgeSnapshot): CloudSnapshotDiff {
  const checks: [string, unknown, unknown][] = [
    ['训练', { exercises: local.exercises, workout: local.workout, completedSessions: local.completedSessions }, { exercises: remote.exercises, workout: remote.workout, completedSessions: remote.completedSessions }],
    ['营养', { nutrition: local.nutrition, foods: local.foods, foodEntries: local.foodEntries, mealPlan: local.mealPlan, mealPlanApplied: local.mealPlanApplied }, { nutrition: remote.nutrition, foods: remote.foods, foodEntries: remote.foodEntries, mealPlan: remote.mealPlan, mealPlanApplied: remote.mealPlanApplied }],
    ['健康', local.healthSnapshots, remote.healthSnapshots],
    ['Coach', local.coachMessages, remote.coachMessages],
    ['账户与今日状态', { profile: local.profile, dailyState: local.dailyState, workoutStatus: local.workoutStatus }, { profile: remote.profile, dailyState: remote.dailyState, workoutStatus: remote.workoutStatus }],
  ];
  return { local: cloudSnapshotCounts(local), remote: cloudSnapshotCounts(remote), changedDomains: checks.filter(([, left, right]) => JSON.stringify(left) !== JSON.stringify(right)).map(([name]) => name) };
}

function mergeById<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>(remote.map((item) => [item.id, item]));
  local.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}
function mergeCloudSnapshots(local: ForgeSnapshot, remote: ForgeSnapshot): ForgeSnapshot {
  return {
    ...local,
    exercises: mergeById(local.exercises, remote.exercises),
    completedSessions: mergeById(local.completedSessions, remote.completedSessions),
    foods: mergeById(local.foods, remote.foods),
    foodEntries: mergeById(local.foodEntries, remote.foodEntries),
    coachMessages: mergeById(local.coachMessages, remote.coachMessages),
    healthSnapshots: mergeById(local.healthSnapshots, remote.healthSnapshots),
    mealPlan: mergeById(local.mealPlan ?? [], remote.mealPlan ?? []),
  };
}

function normalizeFood(food: Food): Food {
  const portion = getFoodPortionGrams(food);
  return { ...food, typicalServingGrams: portion, defaultServing: food.defaultServing?.trim() || String(portion) + ' g' };
}

function buildFoodEntry(food: Food, serving: string, id: string, createdAt = new Date().toISOString(), meal?: MealType, consumedAt = createdAt): FoodEntry | null {
  const amount = Number.parseFloat(serving);
  const isGramServing = /g/i.test(serving);
  if (isGramServing && (!Number.isFinite(amount) || amount <= 0)) return null;
  const multiplier = isGramServing ? amount / 100 : 1;
  return { id, foodId: food.id, name: food.name, serving, calories: Math.round(food.caloriesPer100g * multiplier), protein: Math.round(food.protein * multiplier * 10) / 10, carbs: Math.round(food.carbs * multiplier * 10) / 10, fat: Math.round(food.fat * multiplier * 10) / 10, createdAt, consumedAt, meal };
}

function normalizeFoodEntries(entries: FoodEntry[], foods: Food[]): FoodEntry[] {
  return entries.map((entry) => {
    const food = foods.find((item) => item.id === entry.foodId || item.name === entry.name);
    if (!food || !/g/i.test(entry.serving)) return entry;
    return buildFoodEntry(food, entry.serving, entry.id, entry.createdAt ?? entry.consumedAt ?? new Date().toISOString(), entry.meal, entry.consumedAt ?? entry.createdAt) ?? entry;
  });
}

function consumedNutritionFromEntries(entries: FoodEntry[]): Pick<DailyNutrition, 'consumedCalories' | 'consumedProtein' | 'consumedCarbs' | 'consumedFat'> {
  const today = new Date().toDateString();
  return entries.filter((entry) => {
    const timestamp = entry.consumedAt || entry.createdAt;
    return Boolean(timestamp) && new Date(timestamp as string).toDateString() === today;
  }).reduce((total, entry) => ({
    consumedCalories: total.consumedCalories + entry.calories,
    consumedProtein: Math.round((total.consumedProtein + entry.protein) * 10) / 10,
    consumedCarbs: Math.round((total.consumedCarbs + entry.carbs) * 10) / 10,
    consumedFat: Math.round((total.consumedFat + entry.fat) * 10) / 10,
  }), { consumedCalories: 0, consumedProtein: 0, consumedCarbs: 0, consumedFat: 0 });
}

type ForgeAppActions = {
  [Key in keyof ForgeAppState as ForgeAppState[Key] extends (...args: never[]) => unknown ? Key : never]: ForgeAppState[Key]
};
type ForgeAppData = Omit<ForgeAppState, keyof ForgeAppActions>;

const ForgeStateContext = createContext<ForgeAppData | null>(null);
const ForgeActionsContext = createContext<ForgeAppActions | null>(null);

export function ForgeAppProvider({ children }: { children: React.ReactNode }) {
  const [exercises, setExercises] = useState<WorkoutExercise[]>(createEmptyExercises);
  const [workout, setWorkout] = useState<TodayWorkout>(() => createEmptyDailyPlan().workout);
  const [completedSessions, setCompletedSessions] = useState<WorkoutSession[]>([]);
  const [profile, setProfile] = useState<UserProfile>(createEmptyProfile);
  const [authSession, setAuthSessionState] = useState<AuthSession | null>(null);
  const [dailyState, setDailyState] = useState<DailyState>(createEmptyDailyState);
  const [healthSnapshots, setHealthSnapshots] = useState<HealthSnapshot[]>([]);
  const [workoutStatus, setWorkoutStatus] = useState<WorkoutStatus>('scheduled');
  const [coachInsightApplied, setCoachInsightApplied] = useState(false);
  const [restSeconds, setRestSeconds] = useState<number | null>(null);
  const [workoutStartedAt, setWorkoutStartedAt] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; action?: ToastAction } | null>(null);
  const [nutrition, setNutrition] = useState<DailyNutrition>(createEmptyNutrition);
  const [foodEntries, setFoodEntries] = useState<FoodEntry[]>([]);
  const [foods, setFoods] = useState<Food[]>([]);
  const [mealPlan, setMealPlan] = useState<PlannedMeal[]>([]);
  const [mealPlanApplied, setMealPlanApplied] = useState(false);
  const [coachMessages, setCoachMessagesState] = useState<StoredCoachMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('loading');
  const [lastPersistedAt, setLastPersistedAt] = useState<string | null>(null);
  const [isPersistedStale, setIsPersistedStale] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>('disabled');
  const [cloudConnectivity, setCloudConnectivity] = useState<CloudConnectivity>('unknown');
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const [cloudSyncPending, setCloudSyncPending] = useState(false);
  const [cloudRevision, setCloudRevision] = useState(0);
  const [cloudRemoteSummary, setCloudRemoteSummary] = useState<CloudSnapshotSummary | null>(null);
  const [cloudRemoteDiff, setCloudRemoteDiff] = useState<CloudSnapshotDiff | null>(null);
  const [recentlyAddedSet, setRecentlyAddedSet] = useState<{ exerciseId: string; setId: string } | null>(null);
  const lastAddedSet = useRef<{ exerciseId: string; setId: string } | null>(null);
  const lastRemovedExercise = useRef<{ exercise: WorkoutExercise; index: number } | null>(null);
  const authRestoreAttempted = useRef(false);

  const persistenceSnapshot = useMemo<ForgeSnapshot>(() => ({
    version: CURRENT_SNAPSHOT_VERSION, exercises, completedSessions, profile, authSession: Platform.OS === 'web' ? null : authSession, workout, dailyState, workoutStatus, workoutStartedAt, coachInsightApplied,
    nutrition, foodEntries, foods, mealPlan, mealPlanApplied, coachMessages, healthSnapshots, pendingCloudSync: cloudSyncPending, cloudRevision,
  }), [authSession, cloudRevision, cloudSyncPending, coachInsightApplied, coachMessages, completedSessions, dailyState, exercises, foodEntries, foods, healthSnapshots, mealPlan, mealPlanApplied, nutrition, profile, workout, workoutStartedAt, workoutStatus]);
  const cloudSyncSnapshot = useMemo<Omit<ForgeSnapshot, 'authSession' | 'pendingCloudSync' | 'cloudRevision'>>(() => { const { authSession: _authSession, pendingCloudSync: _pendingCloudSync, cloudRevision: _cloudRevision, ...snapshot } = persistenceSnapshot; return snapshot; }, [persistenceSnapshot]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const webAuthSession = loadWebAuthSession();
        const loadedSnapshot = await loadForgeSnapshot(webAuthSession?.profile.id);
        const snapshotMatchesSession = !webAuthSession || !loadedSnapshot?.profile?.id || loadedSnapshot.profile.id === webAuthSession.profile.id;
        const snapshot = Platform.OS === 'web' && (!webAuthSession || !snapshotMatchesSession) ? null : loadedSnapshot;
        if (!mounted) return;
        if (snapshot) {
          setExercises(snapshot.exercises);
          setWorkout(snapshot.workout ?? createEmptyDailyPlan().workout);
          setLastPersistedAt(snapshot.persistedAt ?? null);
          setIsPersistedStale(Boolean(snapshot.persistedAt && Date.now() - new Date(snapshot.persistedAt).getTime() >= 24 * 60 * 60 * 1000));
          setCompletedSessions(snapshot.completedSessions ?? []);
          const restoredSession = isAuthServiceConfigured() ? (Platform.OS === 'web' ? (webAuthSession ?? null) : (snapshot.authSession ?? webAuthSession ?? null)) : null;
          setProfile(snapshot.authSession && !restoredSession ? createEmptyProfile() : snapshot.profile);
          setAuthSessionState(restoredSession);
          setDailyState(snapshot.dailyState);
          setWorkoutStatus(snapshot.workoutStatus);
          setWorkoutStartedAt(snapshot.workoutStartedAt);
          setCoachInsightApplied(snapshot.coachInsightApplied);
          const restoredFoods = snapshot.foods.map(normalizeFood);
          const restoredEntries = normalizeFoodEntries(snapshot.foodEntries, restoredFoods);
          const restoredConsumed = consumedNutritionFromEntries(restoredEntries);
          const needsResync = JSON.stringify(restoredEntries) !== JSON.stringify(snapshot.foodEntries) || Object.entries(restoredConsumed).some(([key, value]) => value !== snapshot.nutrition[key as keyof typeof restoredConsumed]);
          setNutrition({ ...snapshot.nutrition, ...restoredConsumed });
          setFoodEntries(restoredEntries);
          setFoods(restoredFoods);
          setMealPlan(snapshot.mealPlan ?? []);
          setMealPlanApplied(Boolean(snapshot.mealPlanApplied));
          setCoachMessagesState(snapshot.coachMessages ?? []);
          setHealthSnapshots(snapshot.healthSnapshots ?? []);
          const restoredCloudRevision = typeof snapshot.cloudRevision === 'number' && Number.isInteger(snapshot.cloudRevision) && snapshot.cloudRevision >= 0 ? snapshot.cloudRevision : 0;
          const restoredCloudPending = Boolean(snapshot.pendingCloudSync) || needsResync;
          setCloudSyncPending(restoredCloudPending);
          setCloudRevision(restoredCloudRevision);
          setCloudSyncStatus(restoredSession && restoredCloudRevision > 0 && !restoredCloudPending ? 'synced' : restoredSession ? 'idle' : 'disabled');
        } else if (webAuthSession) {
          setAuthSessionState(webAuthSession);
          setProfile(webAuthSession.profile);
          setCloudSyncStatus('idle');
        }
        setPersistenceStatus('ready');
      } catch (error: unknown) {
        console.warn('FORGE local snapshot load failed', error);
        if (mounted) setPersistenceStatus('error');
      } finally {
        if (mounted) setHydrated(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = setTimeout(() => {
      setPersistenceStatus('saving');
      saveForgeSnapshot(persistenceSnapshot).then(() => { setLastPersistedAt(new Date().toISOString()); setIsPersistedStale(false); setPersistenceStatus('ready'); }).catch((error: unknown) => {
        console.warn('FORGE local snapshot save failed', error);
        setPersistenceStatus('error');
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [hydrated, persistenceSnapshot]);

  const retryPersistence = useCallback(async () => {
    setPersistenceStatus('saving');
    try {
      await saveForgeSnapshot(persistenceSnapshot);
      setLastPersistedAt(new Date().toISOString());
      setIsPersistedStale(false);
      setPersistenceStatus('ready');
    } catch (error: unknown) {
      console.warn('FORGE local snapshot retry failed', error);
      setPersistenceStatus('error');
    }
  }, [persistenceSnapshot]);

  useEffect(() => {
    if (restSeconds === null || restSeconds <= 0) return;
    const interval = setInterval(() => setRestSeconds((current) => current === null ? null : Math.max(0, current - 1)), 1000);
    return () => clearInterval(interval);
  }, [restSeconds]);

  useEffect(() => {
    const applyNetworkState = (state: NetworkState) => {
      const next = state.isConnected === false || state.isInternetReachable === false ? 'offline' : state.isConnected === true ? 'online' : 'unknown';
      setCloudConnectivity(next);
      if (next === 'offline') setCloudSyncStatus((current) => current === 'syncing' ? 'offline' : current);
      if (next === 'online') setCloudSyncStatus((current) => current === 'offline' ? 'idle' : current);
    };
    getNetworkStateAsync().then(applyNetworkState).catch(() => setCloudConnectivity('unknown'));
    const subscription = addNetworkStateListener(applyNetworkState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!hydrated || !authSession || cloudConnectivity !== 'offline') return;
    const timeout = setTimeout(() => setCloudSyncPending(true), 0);
    return () => clearTimeout(timeout);
  }, [authSession, cloudConnectivity, hydrated, cloudSyncSnapshot]);

  const showToast = useCallback((message: string, action?: ToastAction) => {
    setToast({ message, action });
    setTimeout(() => setToast((current) => current?.message === message ? null : current), 3200);
  }, []);

  const syncNow = useCallback(async () => {
    if (!authSession?.accessToken || !isAuthServiceConfigured()) { setCloudSyncStatus('disabled'); setCloudSyncError('登录并配置 FORGE API 后才能同步云端。'); return; }
    if (cloudConnectivity === 'offline') { setCloudSyncStatus('offline'); setCloudSyncError('设备当前离线，本地数据会保留；恢复网络后可以重试。'); return; }
    setCloudSyncStatus('syncing'); setCloudSyncError(null);
    try { const result = await syncForgeSnapshot(authSession.accessToken, cloudSyncSnapshot, cloudRevision); setCloudRevision(result.revision); setCloudSyncPending(false); setCloudRemoteSummary(null); setCloudRemoteDiff(null); setCloudSyncStatus('synced'); showToast('已同步到 FORGE 云端'); } catch (error: unknown) { const code = error instanceof Error ? error.message : 'SYNC_REQUEST_FAILED'; if (code === 'SYNC_CONFLICT') { let conflictDetail = ''; try { const remote = await getForgeSnapshot(authSession.accessToken); conflictDetail = `云端当前版本为 ${remote.revision}${remote.updatedAt ? `（${formatLocalizedDateTime(remote.updatedAt, '时间未知')}）` : ''}，请先读取并合并后再同步。`; } catch { conflictDetail = '云端版本详情暂时不可读取，请稍后重试。'; } setCloudSyncStatus('conflict'); setCloudSyncError(`检测到其他设备的新版本；本次没有覆盖云端数据。${conflictDetail}`); showToast('同步发生冲突，云端数据未被覆盖。'); } else if (code === 'SYNC_RESPONSE_INVALID') { setCloudSyncStatus('error'); setCloudSyncError('服务端同步响应无效，本地数据仍然保留。'); showToast('同步响应无效，请稍后重试。'); } else if (code === 'SYNC_SNAPSHOT_INVALID') { setCloudSyncStatus('error'); setCloudSyncError('云端拒绝了结构不完整的同步数据，本机数据仍然保留。'); showToast('同步数据结构无效，本机数据未丢失。'); } else { setCloudSyncStatus('error'); setCloudSyncError(code); showToast('云端同步失败，请重试。'); } }
  }, [authSession, cloudConnectivity, cloudRevision, cloudSyncSnapshot, showToast]);

  const inspectCloud = useCallback(async () => {
    if (!authSession?.accessToken || !isAuthServiceConfigured()) {
      setCloudSyncStatus('disabled');
      setCloudSyncError('登录并配置 FORGE API 后才能查看云端版本。');
      return;
    }
    if (cloudConnectivity === 'offline') {
      setCloudSyncStatus('offline');
      setCloudSyncError('设备当前离线，无法读取云端版本。');
      return;
    }
    setCloudSyncStatus('syncing');
    setCloudSyncError(null);
    try {
      const remote = await getForgeSnapshot(authSession.accessToken);
      if (!remote.snapshot) {
        setCloudRemoteSummary(null); setCloudRemoteDiff(null);
        setCloudSyncStatus('idle');
        setCloudSyncError('云端还没有可恢复的数据；本机数据未改变。');
        showToast('云端暂无可恢复数据');
        return;
      }
      if (!isRestorableCloudSnapshot(remote.snapshot)) throw new Error('SYNC_CLOUD_SNAPSHOT_INVALID');
      setCloudRemoteSummary(cloudSnapshotSummary({ revision: remote.revision, updatedAt: remote.updatedAt, snapshot: remote.snapshot }));
      setCloudRemoteDiff(cloudSnapshotDiff(cloudSyncSnapshot, remote.snapshot));
      setCloudSyncStatus('conflict');
      setCloudSyncError(null);
      showToast('已读取云端版本摘要');
    } catch {
      setCloudSyncStatus('error');
      setCloudSyncError('云端版本暂时无法读取，本机数据未改变。');
      showToast('云端版本读取失败，请重试');
    }
  }, [authSession, cloudConnectivity, cloudSyncSnapshot, showToast]);

  useEffect(() => {
    if (!hydrated || !authSession || cloudConnectivity !== 'online' || !cloudSyncPending || cloudSyncStatus !== 'idle') return;
    const timer = setTimeout(() => { void syncNow(); }, 900);
    return () => clearTimeout(timer);
  }, [authSession, cloudConnectivity, cloudSyncPending, cloudSyncStatus, hydrated, syncNow]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !hydrated || !authSession || cloudConnectivity !== 'online' || !cloudSyncPending || cloudSyncStatus !== 'idle') return;
      void syncNow();
    });
    return () => subscription.remove();
  }, [authSession, cloudConnectivity, cloudSyncPending, cloudSyncStatus, hydrated, syncNow]);

  const restoreFromCloud = useCallback(async () => {
    if (!authSession?.accessToken || !isAuthServiceConfigured()) {
      setCloudSyncStatus('disabled');
      setCloudSyncError('登录并配置 FORGE API 后才能从云端恢复。');
      return;
    }
    if (cloudConnectivity === 'offline') {
      setCloudSyncStatus('offline');
      setCloudSyncError('设备当前离线，本地数据未改变；恢复网络后可以重试。');
      return;
    }
    setCloudSyncStatus('syncing');
    setCloudSyncError(null);
    try {
      const remote = await getForgeSnapshot(authSession.accessToken);
      if (!remote.snapshot) {
        setCloudSyncStatus('idle');
        setCloudSyncError('云端还没有可恢复的数据；本机数据未改变。');
        showToast('云端暂无可恢复数据');
        return;
      }
      if (!isRestorableCloudSnapshot(remote.snapshot)) throw new Error('SYNC_CLOUD_SNAPSHOT_INVALID');
      const snapshot = remote.snapshot;
      setCloudRemoteSummary(cloudSnapshotSummary({ revision: remote.revision, updatedAt: remote.updatedAt, snapshot }));
      setCloudRemoteDiff(null);
      setExercises(snapshot.exercises);
      setWorkout(snapshot.workout ?? createEmptyDailyPlan().workout);
      setCompletedSessions(snapshot.completedSessions);
      setProfile(snapshot.profile);
      setAuthSessionState((current) => current ? { ...current, profile: snapshot.profile } : current);
      setDailyState(snapshot.dailyState);
      setWorkoutStatus(snapshot.workoutStatus);
      setWorkoutStartedAt(snapshot.workoutStartedAt);
      setCoachInsightApplied(Boolean(snapshot.coachInsightApplied));
      const restoredFoods = snapshot.foods.map(normalizeFood);
      const restoredEntries = normalizeFoodEntries(snapshot.foodEntries, restoredFoods);
      const restoredConsumed = consumedNutritionFromEntries(restoredEntries);
      const needsResync = JSON.stringify(restoredEntries) !== JSON.stringify(snapshot.foodEntries) || Object.entries(restoredConsumed).some(([key, value]) => value !== snapshot.nutrition[key as keyof typeof restoredConsumed]);
      setNutrition({ ...snapshot.nutrition, ...restoredConsumed });
      setFoodEntries(restoredEntries);
      setFoods(restoredFoods);
      setMealPlan(snapshot.mealPlan ?? []);
      setMealPlanApplied(Boolean(snapshot.mealPlanApplied));
      setCoachMessagesState(snapshot.coachMessages);
      setHealthSnapshots(snapshot.healthSnapshots);
      setCloudRevision(remote.revision);
      setCloudSyncPending(needsResync);
      setCloudSyncStatus(needsResync ? 'idle' : 'synced');
      setCloudSyncError(null);
      showToast('已从云端恢复真实数据');
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : 'SYNC_READ_FAILED';
      setCloudSyncStatus('error');
      setCloudSyncError(code === 'SYNC_CLOUD_SNAPSHOT_INVALID' ? '云端数据版本不兼容，本机数据未改变。' : '云端数据暂时无法读取，本机数据未改变。');
      showToast('云端恢复失败，请重试');
    }
  }, [authSession, cloudConnectivity, showToast]);

  const mergeCloudConflict = useCallback(async () => {
    if (!authSession?.accessToken || !isAuthServiceConfigured()) {
      setCloudSyncStatus('disabled');
      setCloudSyncError('登录并配置 FORGE API 后才能合并云端版本。');
      return;
    }
    if (cloudConnectivity === 'offline') {
      setCloudSyncStatus('offline');
      setCloudSyncError('设备当前离线，无法合并云端版本。');
      return;
    }
    setCloudSyncStatus('syncing');
    setCloudSyncError(null);
    try {
      const remote = await getForgeSnapshot(authSession.accessToken);
      if (!remote.snapshot) throw new Error('SYNC_CLOUD_SNAPSHOT_EMPTY');
      if (!isRestorableCloudSnapshot(remote.snapshot)) throw new Error('SYNC_CLOUD_SNAPSHOT_INVALID');
      const merged = mergeCloudSnapshots(persistenceSnapshot, remote.snapshot);
      const { authSession: _authSession, pendingCloudSync: _pendingCloudSync, cloudRevision: _cloudRevision, ...mergedCloudSnapshot } = merged;
      const result = await syncForgeSnapshot(authSession.accessToken, mergedCloudSnapshot, remote.revision);
      setExercises(merged.exercises);
      setWorkout(merged.workout ?? createEmptyDailyPlan().workout);
      setCompletedSessions(merged.completedSessions);
      setProfile(merged.profile);
      setAuthSessionState((current) => current ? { ...current, profile: merged.profile } : current);
      setDailyState(merged.dailyState);
      setWorkoutStatus(merged.workoutStatus);
      setWorkoutStartedAt(merged.workoutStartedAt);
      setCoachInsightApplied(Boolean(merged.coachInsightApplied));
      const restoredFoods = merged.foods.map(normalizeFood);
      const restoredEntries = normalizeFoodEntries(merged.foodEntries, restoredFoods);
      setNutrition({ ...merged.nutrition, ...consumedNutritionFromEntries(restoredEntries) });
      setFoodEntries(restoredEntries);
      setFoods(restoredFoods);
      setMealPlan(merged.mealPlan ?? []);
      setMealPlanApplied(Boolean(merged.mealPlanApplied));
      setCoachMessagesState(merged.coachMessages);
      setHealthSnapshots(merged.healthSnapshots);
      setCloudRevision(result.revision);
      setCloudSyncPending(false);
      setCloudRemoteSummary(null);
      setCloudRemoteDiff(null);
      setCloudSyncStatus('synced');
      showToast('已按合并规则同步本机与云端数据');
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : 'SYNC_MERGE_FAILED';
      setCloudSyncStatus(code === 'SYNC_CONFLICT' ? 'conflict' : 'error');
      setCloudSyncError(code === 'SYNC_CONFLICT' ? '合并期间云端又出现新版本，本次没有覆盖云端数据，请重新读取版本。' : '云端合并失败，本机数据仍然保留。');
      showToast('云端合并失败，请重新读取版本');
    }
  }, [authSession, cloudConnectivity, persistenceSnapshot, showToast]);

  const setAuthSession = useCallback((session: AuthSession) => {
    authRestoreAttempted.current = false;
    saveWebAuthSession(session);
    setAuthSessionState(session);
    setProfile(session.profile);
    // A login in the same tab must start from a clean account boundary. The
    // cloud restore effect will populate this account's snapshot afterwards;
    // never let the previous account's pending state sync into the new one.
    setExercises([]);
    setWorkout(createEmptyDailyPlan().workout);
    setCompletedSessions([]);
    setDailyState(createEmptyDailyState());
    setHealthSnapshots([]);
    setNutrition(createEmptyNutrition());
    setFoodEntries([]);
    setFoods([]);
    setWorkoutStatus('scheduled');
    setWorkoutStartedAt(null);
    setCoachInsightApplied(false);
    setMealPlan([]);
    setMealPlanApplied(false);
    setCoachMessagesState([]);
    setRecentlyAddedSet(null);
    setCloudSyncPending(false);
    setCloudRevision(0);
    setCloudSyncStatus('idle');
    setCloudSyncError(null);
    setCloudRemoteSummary(null); setCloudRemoteDiff(null);
  }, []);

  const signOut = useCallback(() => {
    saveWebAuthSession(null);
    if (authSession?.accessToken) void requestLogout(authSession.accessToken);
    setAuthSessionState(null); setProfile(createEmptyProfile()); setExercises([]); setWorkout(createEmptyDailyPlan().workout); setCompletedSessions([]); setDailyState(createEmptyDailyState()); setHealthSnapshots([]); setNutrition(createEmptyNutrition()); setFoodEntries([]); setFoods([]); setWorkoutStatus('scheduled'); setWorkoutStartedAt(null); setCoachInsightApplied(false); setMealPlan([]); setMealPlanApplied(false); setCoachMessagesState([]); setRecentlyAddedSet(null); setCloudSyncPending(false); setCloudRevision(0); setCloudRemoteSummary(null); setCloudRemoteDiff(null); setCloudSyncStatus('disabled'); setCloudSyncError(null);
    showToast('已退出登录并清理本机账户数据');
  }, [authSession, showToast]);

  const updateSet = useCallback((setId: string, field: 'kg' | 'reps', value: number) => {
    setExercises((current) => current.map((item) => ({ ...item, sets: item.sets.map((set) => set.id === setId ? { ...set, [field]: value } : set) })));
  }, []);

  const completeSet = useCallback((setId: string) => {
    setExercises((current) => {
      const flattened = current.flatMap((exercise) => exercise.sets);
      const activeIndex = flattened.findIndex((set) => set.id === setId && set.status === 'active');
      if (activeIndex < 0) return current;
      const nextSet = flattened.slice(activeIndex + 1).find((set) => set.status === 'planned');
      return current.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => set.id === setId ? { ...set, status: 'completed' } : set.id === nextSet?.id ? { ...set, status: 'active' } : set),
      }));
    });
    setRestSeconds(profile.trainingPreferences?.defaultRestSeconds ?? 150);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [profile.trainingPreferences?.defaultRestSeconds]);

  const addSet = useCallback((exerciseId: string) => {
    const addedSet = { exerciseId, setId: `${exerciseId}-${Date.now()}` };
    setExercises((current) => current.map((exercise) => {
      if (exercise.id !== exerciseId) return exercise;
      const nextNumber = exercise.sets.length + 1;
      const lastSet = exercise.sets[exercise.sets.length - 1];
      const newSet: WorkoutSet = { id: addedSet.setId, label: String(nextNumber), last: '—', kg: lastSet?.kg ?? 0, reps: lastSet?.reps ?? 8, status: 'planned' };
      lastAddedSet.current = addedSet;
      setRecentlyAddedSet(addedSet);
      return { ...exercise, sets: [...exercise.sets, newSet] };
    }));
    showToast('已增加一组', { label: '撤销', onPress: () => { setExercises((current) => current.map((exercise) => exercise.id === addedSet.exerciseId ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== addedSet.setId) } : exercise)); if (lastAddedSet.current?.setId === addedSet.setId) lastAddedSet.current = null; showToast('已撤销增加组数'); } });
  }, [showToast]);
  const undoLastAddedSet = useCallback(() => {
    const added = recentlyAddedSet;
    if (!added) return;
    setExercises((current) => current.map((exercise) => exercise.id === added.exerciseId ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== added.setId) } : exercise));
    lastAddedSet.current = null;
    setRecentlyAddedSet(null);
    showToast('已撤销增加组数');
  }, [recentlyAddedSet, showToast]);

  const removeExercise = useCallback((exerciseId: string) => {
    setExercises((current) => { const index = current.findIndex((exercise) => exercise.id === exerciseId); if (index < 0) return current; lastRemovedExercise.current = { exercise: current[index], index }; return current.filter((exercise) => exercise.id !== exerciseId); });
    showToast('动作已移除', { label: '撤销', onPress: () => { const removed = lastRemovedExercise.current; if (!removed) return; setExercises((current) => current.some((exercise) => exercise.id === removed.exercise.id) ? current : [...current.slice(0, removed.index), removed.exercise, ...current.slice(removed.index)]); lastRemovedExercise.current = null; showToast('动作已恢复'); } });
  }, [showToast]);

  const replaceExercise = useCallback((exerciseId: string, replacement: Exercise) => {
    setExercises((current) => current.map((item) => item.id === exerciseId ? { ...item, exercise: replacement, lastPerformance: '—' } : item));
    showToast(`${replacement.name} 已替换今天的动作`);
  }, [showToast]);
  const createWorkoutPlan = useCallback((input: Pick<TodayWorkout, 'title' | 'focus' | 'estimatedMinutes'> & { exercises: WorkoutExercise[] }) => {
    const setCount = input.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
    setWorkout({ id: `workout-${Date.now()}`, title: input.title, focus: input.focus, exerciseCount: input.exercises.length, setCount, estimatedMinutes: input.estimatedMinutes, adjustments: 0, status: 'scheduled' });
    setExercises(input.exercises);
    setWorkoutStatus('scheduled');
    setWorkoutStartedAt(null);
    showToast('真实训练计划已保存');
  }, [showToast]);
  const updateWorkoutPlan = useCallback((input: Pick<TodayWorkout, 'title' | 'focus' | 'estimatedMinutes'> & { exercises: WorkoutExercise[] }) => {
    const setCount = input.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
    setWorkout((current) => ({ ...current, title: input.title, focus: input.focus, exerciseCount: input.exercises.length, setCount, estimatedMinutes: input.estimatedMinutes, status: 'scheduled' }));
    setExercises(input.exercises);
    setWorkoutStatus('scheduled');
    setWorkoutStartedAt(null);
    showToast('训练计划已更新');
  }, [showToast]);
  const deleteWorkoutPlan = useCallback(() => {
    setWorkout(createEmptyDailyPlan().workout);
    setExercises([]);
    setWorkoutStatus('scheduled');
    setWorkoutStartedAt(null);
    showToast('训练计划已删除');
  }, [showToast]);

  const applyMealPlan = useCallback((items: CoachPlanDraft['mealPlan'] = []) => {
    const results: CoachCommandExecutionResult[] = [];
    const meals = items.flatMap((item, index) => {
      const foodName = typeof item?.foodName === 'string' ? item.foodName.trim() : '';
      const food = foods.find((candidate) => candidate.available && !candidate.avoided && (candidate.name.toLowerCase() === foodName.toLowerCase() || candidate.name.toLowerCase().includes(foodName.toLowerCase()) || foodName.toLowerCase().includes(candidate.name.toLowerCase())));
      const meal = item?.meal === 'breakfast' || item?.meal === 'lunch' || item?.meal === 'dinner' || item?.meal === 'snack' ? item.meal : undefined;
      const entry = food && meal ? buildFoodEntry(food, item.serving?.trim() || food.defaultServing, 'meal-plan-' + Date.now() + '-' + index, new Date().toISOString(), meal) : null;
      if (!food || !meal || !entry) {
        results.push({ command: item as never, status: 'failed', reason: !food ? '食物不在当前食物池' : !meal ? '缺少餐次' : '份量无法计算' });
        return [];
      }
      results.push({ command: item as never, status: 'applied', detail: meal + ':' + food.name + ' ' + entry.serving });
      return [{ id: entry.id, meal, foodId: food.id, foodName: food.name, serving: entry.serving, calories: entry.calories, protein: entry.protein, carbs: entry.carbs, fat: entry.fat }];
    });
    if (!items.length || !meals.length || results.some((item) => item.status === 'failed')) {
      showToast(!items.length ? '没有收到可写入的逐餐饮食方案。' : '饮食方案中有食物不在当前食物池，未写入不完整方案。');
      return { changed: false, commandsApplied: 0, duplicateCommandsSkipped: 0, results };
    }
    setMealPlan(meals);
    setMealPlanApplied(true);
    setCloudSyncPending(true);
    setCloudSyncStatus('idle');
    showToast('逐餐饮食方案已写入 FORGE，正在同步云端');
    return { changed: true, commandsApplied: meals.length, duplicateCommandsSkipped: 0, results };
  }, [foods, showToast]);
  const undoMealPlan = useCallback(() => { setMealPlanApplied(false); setMealPlan([]); setCloudSyncPending(true); setCloudSyncStatus('idle'); showToast('已撤销饮食方案'); }, [showToast]);
  const addFoodEntry = useCallback((foodId: string, input: { serving?: string; meal?: MealType; consumedAt?: string } = {}) => {
    const food = foods.find((item) => item.id === foodId);
    if (!food) return;
    const entry = buildFoodEntry(food, input.serving?.trim() || food.defaultServing, `${food.id}-${Date.now()}`, new Date().toISOString(), input.meal, input.consumedAt);
    if (!entry) { showToast('默认份量无效，请先修改食物池中的份量。'); return; }
    setFoodEntries((current) => [...current, entry]);
    setNutrition((current) => ({ ...current, consumedCalories: current.consumedCalories + entry.calories, consumedProtein: Math.round((current.consumedProtein + entry.protein) * 10) / 10, consumedCarbs: Math.round((current.consumedCarbs + entry.carbs) * 10) / 10, consumedFat: Math.round((current.consumedFat + entry.fat) * 10) / 10 }));
    showToast(`${food.name} 已记录`);
  }, [foods, showToast]);
  const createFood = useCallback((food: Omit<Food, 'id' | 'available' | 'preferred' | 'locked' | 'avoided'>) => {
    const created: Food = normalizeFood({ ...food, id: 'food-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), available: true, preferred: false, locked: false, avoided: false });
    setFoods((current) => [created, ...current]);
    showToast(created.name + ' 已添加到食物池');
  }, [showToast]);

  const updateFood = useCallback((foodId: string, input: { typicalServingGrams: number }) => {
    const portion = Number(input.typicalServingGrams);
    if (!Number.isFinite(portion) || portion <= 0 || portion > 5000) {
      showToast('每次参考份量应为 1–5000 g。');
      return;
    }
    const rounded = Math.round(portion * 10) / 10;
    setFoods((current) => current.map((food) => food.id === foodId ? { ...food, typicalServingGrams: rounded, defaultServing: String(rounded) + ' g' } : food));
    showToast('每次参考份量已更新');
  }, [showToast]);
  const removeFood = useCallback((foodId: string) => {
    setFoods((current) => {
      const food = current.find((item) => item.id === foodId);
      if (!food) return current;
      showToast(food.name + ' 已从食物池删除');
      return current.filter((item) => item.id !== foodId);
    });
  }, [showToast]);
  const updateNutritionTarget = useCallback((target: NutritionTarget) => {
    setNutrition((current) => ({ ...current, ...target }));
    showToast('营养目标已更新');
  }, [showToast]);
  const removeFoodEntry = useCallback((entryId: string) => {
    setFoodEntries((current) => {
      const entry = current.find((item) => item.id === entryId);
      if (!entry) return current;
      setNutrition((nutritionCurrent) => ({ ...nutritionCurrent, consumedCalories: Math.max(0, nutritionCurrent.consumedCalories - entry.calories), consumedProtein: Math.max(0, Math.round((nutritionCurrent.consumedProtein - entry.protein) * 10) / 10), consumedCarbs: Math.max(0, Math.round((nutritionCurrent.consumedCarbs - entry.carbs) * 10) / 10), consumedFat: Math.max(0, Math.round((nutritionCurrent.consumedFat - entry.fat) * 10) / 10) }));
      showToast(`${entry.name} 已从今日记录移除`);
      return current.filter((item) => item.id !== entryId);
    });
  }, [showToast]);
  const updateFoodEntry = useCallback((entryId: string, input: { serving: string; meal?: MealType; consumedAt?: string }) => {
    const currentEntry = foodEntries.find((entry) => entry.id === entryId);
    const food = currentEntry ? foods.find((item) => item.id === currentEntry.foodId) : undefined;
    if (!currentEntry || !food || !input.serving.trim()) { showToast('请输入有效份量。'); return; }
    const nextEntry = buildFoodEntry(food, input.serving.trim(), currentEntry.id, currentEntry.createdAt, input.meal, input.consumedAt ?? currentEntry.consumedAt ?? currentEntry.createdAt);
    if (!nextEntry) { showToast('份量格式无法计算，请使用例如 50 g。'); return; }
    setFoodEntries((current) => current.map((entry) => entry.id === entryId ? nextEntry : entry));
    setNutrition((current) => ({ ...current, consumedCalories: Math.max(0, current.consumedCalories - currentEntry.calories + nextEntry.calories), consumedProtein: Math.max(0, Math.round((current.consumedProtein - currentEntry.protein + nextEntry.protein) * 10) / 10), consumedCarbs: Math.max(0, Math.round((current.consumedCarbs - currentEntry.carbs + nextEntry.carbs) * 10) / 10), consumedFat: Math.max(0, Math.round((current.consumedFat - currentEntry.fat + nextEntry.fat) * 10) / 10) }));
    showToast(`${nextEntry.name} 份量已更新`);
  }, [foodEntries, foods, showToast]);
  const setFoodAvailable = useCallback((foodId: string, available: boolean) => {
    setFoods((current) => current.map((food) => food.id === foodId ? { ...food, available, avoided: available ? false : food.avoided } : food));
  }, []);
  const toggleFoodStatus = useCallback((foodId: string, key: 'available' | 'preferred' | 'locked' | 'avoided') => {
    setFoods((current) => current.map((food) => {
      if (food.id !== foodId) return food;
      const nextValue = !food[key];
      if (key === 'avoided' && nextValue) return { ...food, avoided: true, preferred: false, locked: false };
      if (key === 'locked' && nextValue) return { ...food, locked: true, avoided: false, available: true };
      return { ...food, [key]: nextValue };
    }));
  }, []);

  const applyCoachPlan = useCallback((plan: CoachPlanDraft): ApplyCoachPlanResult => {
    const results: CoachCommandExecutionResult[] = [];
    const allowedGoalTypes = ['fat_loss', 'muscle_gain', 'recomposition', 'maintenance'];
    let changed = false;
    if (plan.goal) {
      const goalPatch: Partial<Goal> = {};
      if (typeof plan.goal.label === 'string' && plan.goal.label.trim()) goalPatch.label = plan.goal.label.trim().slice(0, 80);
      if (typeof plan.goal.type === 'string' && allowedGoalTypes.includes(plan.goal.type)) goalPatch.type = plan.goal.type as Goal['type'];
      const targetWeightKg = Number(plan.goal.targetWeightKg);
      if (Number.isFinite(targetWeightKg) && targetWeightKg >= 20 && targetWeightKg <= 300) goalPatch.targetWeightKg = targetWeightKg;
      const goalChanged = Object.entries(goalPatch).some(([key, value]) => value !== profile.goal[key as keyof Goal]);
      if (goalChanged) {
        setProfile((current) => ({ ...current, goal: { ...current.goal, ...goalPatch } }));
        changed = true;
        results.push({ status: 'applied', detail: '目标已更新' });
      } else if (Object.keys(goalPatch).length === 0) {
        results.push({ status: 'failed', reason: '目标没有提供有效的可写入字段' });
      } else {
        results.push({ status: 'skipped', reason: '目标与当前设置相同' });
      }
    }
    const nutritionPatch: Partial<NutritionTarget> = {};
    const calories = Number(plan.nutrition?.calories);
    const protein = Number(plan.nutrition?.protein);
    const carbs = Number(plan.nutrition?.carbs);
    const fat = Number(plan.nutrition?.fat);
    if (Number.isFinite(calories) && calories >= 800 && calories <= 10000) nutritionPatch.calories = Math.round(calories);
    if (Number.isFinite(protein) && protein >= 0 && protein <= 1000) nutritionPatch.protein = Math.round(protein);
    if (Number.isFinite(carbs) && carbs >= 0 && carbs <= 1500) nutritionPatch.carbs = Math.round(carbs);
    if (Number.isFinite(fat) && fat >= 0 && fat <= 500) nutritionPatch.fat = Math.round(fat);
    if (Object.keys(nutritionPatch).length) {
      const nutritionChanged = Object.entries(nutritionPatch).some(([key, value]) => value !== nutrition[key as keyof NutritionTarget]);
      if (nutritionChanged) {
        setNutrition((current) => ({ ...current, ...nutritionPatch }));
        changed = true;
        results.push({ status: 'applied', detail: '营养目标已更新' });
      } else {
        results.push({ status: 'skipped', reason: '营养目标已经是相同设置' });
      }
    } else if (plan.nutrition) {
      results.push({ status: 'failed', reason: '营养目标没有提供有效数值' });
    }
    const state = plan.dailyState;
    if (state) {
      const statePatch: Partial<DailyState> = {};
      if (typeof state.sleep === 'string' && state.sleep.trim()) statePatch.sleep = state.sleep.trim().slice(0, 40);
      if (typeof state.fatigue === 'string' && state.fatigue.trim()) statePatch.fatigue = state.fatigue.trim().slice(0, 40);
      if (typeof state.soreness === 'string' && state.soreness.trim()) statePatch.soreness = state.soreness.trim().slice(0, 40);
      const weightKg = Number(state.weightKg);
      if (Number.isFinite(weightKg) && weightKg >= 20 && weightKg <= 300) statePatch.weightKg = weightKg;
      if (Object.keys(statePatch).length) {
        const stateChanged = Object.entries(statePatch).some(([key, value]) => value !== dailyState[key as keyof DailyState]);
        if (!stateChanged) {
          results.push({ status: 'skipped', reason: '今日状态已经是相同设置' });
        } else setDailyState((current) => {
        const next = {
          ...current,
          ...statePatch,
          source: 'Coach AI',
          sourceType: 'manual' as const,
          updatedAt: new Date().toISOString(),
        };
        const sleepHours = Number.parseFloat(next.sleep);
        const hasSleep = Number.isFinite(sleepHours);
        const hasFatigue = next.fatigue !== '未记录';
        const hasSoreness = next.soreness !== '未记录';
        const factorCount = Number(hasSleep) + Number(hasFatigue) + Number(hasSoreness);
        const fatigueScore = next.fatigue === '高' ? 2 : next.fatigue === '中等' ? 1 : 0;
        const sorenessScore = next.soreness.includes('高') ? 2 : next.soreness.includes('中等') ? 1 : 0;
        const readinessScore = factorCount === 0 ? 0 : Math.max(40, Math.min(98, Math.round(70 + (hasSleep ? (sleepHours - 7) * 5 : 0) - fatigueScore * 10 - sorenessScore * 7)));
        return { ...next, readinessScore, readinessLabel: readinessScore >= 75 ? 'GOOD' : readinessScore >= 55 ? 'FAIR' : 'LOW', quality: factorCount === 3 ? 'complete' : factorCount > 0 ? 'partial' : 'unknown' };
        });
        if (stateChanged) {
          changed = true;
          results.push({ status: 'applied', detail: '今日状态已更新' });
        }
      } else {
        results.push({ status: 'failed', reason: '今日状态没有提供有效字段' });
      }
    }
    const workoutDraft = plan.workout;
    if (workoutDraft && Array.isArray(workoutDraft.exercises)) {
      const createdAt = Date.now();
      const mapped = workoutDraft.exercises.slice(0, 12).flatMap((item, exerciseIndex) => {
        const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 80) : '';
        const sets = Array.isArray(item?.sets) ? item.sets.slice(0, 8).flatMap((set, setIndex) => {
          const reps = Number(set?.reps);
          if (!Number.isFinite(reps) || reps < 1 || reps > 100) return [];
          const kg = Number(set?.kg);
          return [{ id: 'coach-set-' + createdAt + '-' + exerciseIndex + '-' + setIndex, label: String(setIndex + 1), last: '未记录', kg: Number.isFinite(kg) && kg >= 0 && kg <= 500 ? kg : 0, reps: Math.round(reps), status: 'planned' as const }];
        }) : [];
        if (!name || !sets.length) return [];
        const exerciseId = 'coach-exercise-' + createdAt + '-' + exerciseIndex;
        return [{ id: exerciseId, exercise: { id: exerciseId, name, muscleGroup: typeof item.muscleGroup === 'string' && item.muscleGroup.trim() ? item.muscleGroup.trim().slice(0, 50) : '全身', equipment: typeof item.equipment === 'string' && item.equipment.trim() ? item.equipment.trim().slice(0, 50) : '未指定' }, lastPerformance: '未记录', target: typeof item.target === 'string' && item.target.trim() ? item.target.trim().slice(0, 120) : '按计划完成', sets }];
      });
      if (mapped.length) {
        const estimatedMinutes = Number(workoutDraft.estimatedMinutes);
        const title = typeof workoutDraft.title === 'string' && workoutDraft.title.trim() ? workoutDraft.title.trim().slice(0, 80) : 'Coach 今日训练计划';
        const focus = typeof workoutDraft.focus === 'string' && workoutDraft.focus.trim() ? workoutDraft.focus.trim().slice(0, 120) : '按 Coach 方案执行';
        setExercises(mapped);
        setWorkout({ id: 'workout-' + createdAt, title, focus, exerciseCount: mapped.length, setCount: mapped.reduce((total, item) => total + item.sets.length, 0), estimatedMinutes: Number.isFinite(estimatedMinutes) ? Math.max(15, Math.min(180, Math.round(estimatedMinutes))) : 60, adjustments: 0, status: 'scheduled' });
        setWorkoutStatus('scheduled');
        setWorkoutStartedAt(null);
        changed = true;
        results.push({ status: 'applied', detail: '训练计划已更新' });
      } else {
        results.push({ status: 'failed', reason: '训练方案没有包含有效动作或组数' });
      }
    }
    let commandsApplied = 0;
    let duplicateCommandsSkipped = 0;
    for (const command of plan.commands ?? []) {
      if (command.type === 'log_food') {
        const query = command.foodName.trim().toLowerCase();
        const food = foods.find((item) => item.available && !item.avoided && (item.name.toLowerCase() === query || item.name.toLowerCase().includes(query) || query.includes(item.name.toLowerCase())));
        const meal = command.meal === 'breakfast' || command.meal === 'lunch' || command.meal === 'dinner' || command.meal === 'snack' ? command.meal : undefined;
        const serving = command.serving?.trim() || food?.defaultServing || '';
        const matchedFood = food;
        const entry = matchedFood ? buildFoodEntry(matchedFood, serving, `${matchedFood.id}-coach-${Date.now()}-${commandsApplied}`, new Date().toISOString(), meal) : null;
        if (!matchedFood) {
          results.push({ command, status: 'failed', reason: '食物不在当前食物池' });
        } else if (!entry) {
          results.push({ command, status: 'failed', reason: '份量无法计算' });
        } else if (entry && matchedFood) {
          const servingKey = (value: string) => /g/i.test(value) ? String(Number.parseFloat(value)) + 'g' : value.trim().toLowerCase();
          const isDuplicate = foodEntries.some((existing) => {
            const timestamp = existing.consumedAt || existing.createdAt;
            return existing.foodId === matchedFood.id && (!meal || existing.meal === meal) && servingKey(existing.serving) === servingKey(entry.serving) && Boolean(timestamp) && new Date(timestamp as string).toDateString() === new Date().toDateString();
          });
          if (isDuplicate) {
            duplicateCommandsSkipped += 1;
            results.push({ command, status: 'skipped', reason: '今天已经记录过相同食物和份量' });
          } else {
            setFoodEntries((current) => [...current, entry]);
            setNutrition((currentNutrition) => ({ ...currentNutrition, consumedCalories: currentNutrition.consumedCalories + entry.calories, consumedProtein: Math.round((currentNutrition.consumedProtein + entry.protein) * 10) / 10, consumedCarbs: Math.round((currentNutrition.consumedCarbs + entry.carbs) * 10) / 10, consumedFat: Math.round((currentNutrition.consumedFat + entry.fat) * 10) / 10 }));
            commandsApplied += 1;
            changed = true;
            results.push({ command, status: 'applied', detail: entry.name + ' ' + entry.serving + ' 已扣除今日营养' });
          }
        }
      }
      if (command.type === 'add_food') {
        const name = command.foodName.trim().slice(0, 120);
        const duplicate = foods.some((item) => item.name.toLowerCase() === name.toLowerCase());
        const values = [command.caloriesPer100g, command.protein, command.carbs, command.fat];
        if (!duplicate && name && command.serving.trim() && values.every((value) => Number.isFinite(value) && value >= 0)) {
          const created = {
            id: 'food-coach-' + Date.now() + '-' + commandsApplied,
            name,
            defaultServing: command.serving.trim().slice(0, 80),
            typicalServingGrams: Number.isFinite(Number(command.typicalServingGrams)) && Number(command.typicalServingGrams) > 0 ? Math.round(Number(command.typicalServingGrams) * 10) / 10 : getFoodPortionGrams({ defaultServing: command.serving, typicalServingGrams: undefined }),
            caloriesPer100g: Math.round(command.caloriesPer100g * 10) / 10,
            protein: Math.round(command.protein * 10) / 10,
            carbs: Math.round(command.carbs * 10) / 10,
            fat: Math.round(command.fat * 10) / 10,
            ...(command.unit ? { unit: command.unit } : {}),
            available: true,
            preferred: false,
            locked: false,
            avoided: false,
          };
          setFoods((current) => [created, ...current]);
          commandsApplied += 1;
          changed = true;
          results.push({ command, status: 'applied', detail: created.name + ' 已加入食物池' });
        } else {
          results.push({ command, status: duplicate ? 'skipped' : 'failed', reason: duplicate ? '食物池中已存在同名食物' : '食物营养数据无效' });
        }
      }
      if (command.type === 'set_food_preference') {
        const query = command.foodName.trim().toLowerCase();
        const food = foods.find((item) => item.name.toLowerCase() === query || item.name.toLowerCase().includes(query) || query.includes(item.name.toLowerCase()));
        if (food) {
          const nextFood = (() => {
            if (command.preference === 'preferred') return { ...food, preferred: true, avoided: false, available: true };
            if (command.preference === 'avoided') return { ...food, avoided: true, preferred: false, locked: false };
            if (command.preference === 'available') return { ...food, available: true, avoided: false };
            return { ...food, available: false, avoided: true, preferred: false, locked: false };
          })();
          const preferenceChanged = ['available', 'preferred', 'locked', 'avoided'].some((key) => nextFood[key as keyof typeof nextFood] !== food[key as keyof typeof food]);
          if (!preferenceChanged) {
            results.push({ command, status: 'skipped', reason: '食物偏好已经是相同设置' });
            continue;
          }
          setFoods((current) => current.map((item) => {
            if (item.id !== food.id) return item;
            return nextFood;
          }));
          commandsApplied += 1;
          changed = true;
          results.push({ command, status: 'applied', detail: food.name + ' 偏好已更新' });
        } else {
          results.push({ command, status: 'failed', reason: '食物不在当前食物池' });
        }
      }
      if (command.type === 'adjust_workout') {
        const query = command.exerciseName.trim().toLowerCase();
        const target = exercises.find((item) => item.exercise.name.toLowerCase() === query || item.exercise.name.toLowerCase().includes(query) || query.includes(item.exercise.name.toLowerCase()));
        const addSets = Number(command.addSets);
        const reps = Number(command.reps);
        const kg = Number(command.kg);
        if (!target) {
          results.push({ command, status: 'failed', reason: '找不到匹配的训练动作' });
        } else {
          const validAddSets = Number.isInteger(addSets) && addSets >= 1 && addSets <= 4;
          const validReps = Number.isInteger(reps) && reps >= 1 && reps <= 100;
          const validKg = Number.isFinite(kg) && kg >= 0 && kg <= 500;
          const hasValueChange = (validReps && target.sets.some((set) => set.reps !== Math.round(reps))) || (validKg && target.sets.some((set) => set.kg !== kg)) || validAddSets;
          if (!validAddSets && !validReps && !validKg) {
            results.push({ command, status: 'failed', reason: '训练建议没有提供有效的可执行变更' });
          } else if (!hasValueChange) {
            results.push({ command, status: 'skipped', reason: '训练计划已经是相同设置' });
          } else {
            setExercises((current) => current.map((item) => {
              if (item.id !== target.id) return item;
              const updatedSets = item.sets.map((set) => ({ ...set, ...(validReps ? { reps: Math.round(reps) } : {}), ...(validKg ? { kg } : {}) }));
              const source = updatedSets[updatedSets.length - 1];
              const additions = validAddSets && source ? Array.from({ length: Math.round(addSets) }, (_, index) => ({ ...source, id: source.id + '-coach-' + Date.now() + '-' + index, label: String(updatedSets.length + index + 1), status: 'planned' as const })) : [];
              return { ...item, sets: [...updatedSets, ...additions] };
            }));
            commandsApplied += 1;
            changed = true;
            results.push({ command, status: 'applied', detail: target.exercise.name + ' 已更新今日训练计划' });
          }
        }
      }
      const completedSetsForCommand = exercises.flatMap((item) => item.sets).filter((set) => set.status === 'completed').length;
      if (command.type === 'complete_workout' && exercises.length > 0 && completedSetsForCommand > 0 && workoutStatus !== 'completed') {
        const session = createWorkoutSession({ workoutId: workout.id, workoutTitle: workout.title, exercises, startedAt: workoutStartedAt });
        setCompletedSessions((current) => [session, ...current.filter((item) => item.id !== session.id)].slice(0, 30));
        setWorkoutStatus('completed');
        setRestSeconds(null);
        setWorkoutStartedAt(null);
        commandsApplied += 1;
        changed = true;
        results.push({ command, status: 'applied', detail: '训练已标记为完成' });
      } else if (command.type === 'complete_workout') {
        results.push({ command, status: 'failed', reason: workoutStatus === 'completed' ? '今日训练已经完成' : completedSetsForCommand === 0 ? '请先完成至少一组训练，再标记训练完成' : '没有可完成的训练计划' });
      }
      if (command.type === 'set_weekly_workout_goal') {
        const count = Math.round(Number(command.count));
        if (Number.isFinite(count) && count >= 0 && count <= 14) {
          const nextGoal = count || undefined;
          if (profile.weeklyWorkoutGoal === nextGoal) {
            results.push({ command, status: 'skipped', reason: '每周训练目标已经是相同设置' });
          } else {
            setProfile((current) => ({ ...current, weeklyWorkoutGoal: nextGoal }));
            commandsApplied += 1;
            changed = true;
            results.push({ command, status: 'applied', detail: '每周训练目标已设为 ' + count + ' 次' });
          }
        } else {
          results.push({ command, status: 'failed', reason: '每周训练次数必须在 0 到 14 次之间' });
        }
      }
      if (command.type === 'set_training_preferences') {
        const currentPreferences = profile.trainingPreferences ?? { trainingDays: [] };
        const next: TrainingPreferences = { ...currentPreferences };
        let hasValidPreference = false;
        if (Array.isArray(command.trainingDays)) {
          const days = command.trainingDays.map(Number);
          if (days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) { next.trainingDays = [...new Set(days)].sort((left, right) => left - right); hasValidPreference = true; }
        }
        const rest = Number(command.defaultRestSeconds);
        if (Number.isFinite(rest) && rest >= 30 && rest <= 900) { next.defaultRestSeconds = Math.round(rest); hasValidPreference = true; }
        if (command.weightUnit === 'kg' || command.weightUnit === 'lb') { next.weightUnit = command.weightUnit; hasValidPreference = true; }
        const preferenceChanged = hasValidPreference && JSON.stringify(next) !== JSON.stringify(currentPreferences);
        if (preferenceChanged) {
          setProfile((current) => ({ ...current, trainingPreferences: next }));
          commandsApplied += 1;
          changed = true;
          results.push({ command, status: 'applied', detail: '训练偏好已更新' });
        } else if (hasValidPreference) {
          results.push({ command, status: 'skipped', reason: '训练偏好已经是相同设置' });
        } else {
          results.push({ command, status: 'failed', reason: '训练偏好没有可执行的变更' });
        }
      }
    }
    if (!changed) {
      if (duplicateCommandsSkipped > 0) {
        showToast('这顿饭今天已经记录过了，没有重复扣除营养。');
      } else {
        showToast('Coach 没有找到可直接修改的有效数据，请在对话中补充具体食物、目标或训练内容。');
      }
      return { changed: false, commandsApplied, duplicateCommandsSkipped, results };
    }
    setCloudSyncPending(true);
    setCloudSyncStatus('idle');
    setCloudSyncError(null);
    showToast(commandsApplied > 0 && !plan.goal && !plan.nutrition && !plan.dailyState && !plan.workout && !plan.mealPlan ? 'Coach 已按对话更新系统，正在同步云端' : 'Coach 方案已写入今日数据，正在同步云端');
    return { changed: true, commandsApplied, duplicateCommandsSkipped, results };
  }, [exercises, foodEntries, foods, profile.trainingPreferences, showToast, workout.id, workout.title, workoutStartedAt, workoutStatus]);
  const updateGoal = useCallback((goal: Goal) => {
    setProfile((current) => ({ ...current, goal }));
    showToast(`目标已更新为${goal.label}`);
  }, [showToast]);
  const updateWeeklyWorkoutGoal = useCallback((goal?: number) => {
    setProfile((current) => ({ ...current, weeklyWorkoutGoal: goal }));
    showToast(goal ? `每周训练目标已设为 ${goal} 次` : '已清除每周训练目标');
  }, [showToast]);
  const updateTrainingPreferences = useCallback((preferences: TrainingPreferences) => {
    setProfile((current) => ({ ...current, trainingPreferences: preferences }));
    showToast('训练偏好已保存');
  }, [showToast]);
  const updateNotificationPreferences = useCallback((preferences?: NotificationPreferences) => {
    setProfile((current) => ({ ...current, notificationPreferences: preferences }));
    showToast(preferences?.workoutReminderEnabled ? '训练提醒已保存' : '训练提醒已关闭');
  }, [showToast]);
  const updateCoachDataConsent = useCallback((enabled: boolean) => {
    setProfile((current) => ({ ...current, coachDataConsent: enabled }));
    showToast(enabled ? '已允许 Coach 使用你的训练、状态和饮食上下文' : '已关闭 Coach 数据授权');
  }, [showToast]);
  const updateSessionNotes = useCallback((sessionId: string, notes: string) => {
    setCompletedSessions((current) => current.map((session) => session.id === sessionId ? { ...session, notes: notes.trim() || undefined } : session));
    showToast('训练备注已保存');
  }, [showToast]);
  const setCoachMessages = useCallback((messages: StoredCoachMessage[]) => setCoachMessagesState(messages.slice(-100)), []);
  useEffect(() => {
    if (!hydrated || !authSession?.accessToken || cloudConnectivity !== 'online' || cloudSyncPending || cloudRevision !== 0) return;
    const timer = setTimeout(() => { void restoreFromCloud(); }, 500);
    return () => clearTimeout(timer);
  }, [authSession?.accessToken, cloudConnectivity, cloudRevision, cloudSyncPending, hydrated, restoreFromCloud]);

  useEffect(() => {
    if (!hydrated || authRestoreAttempted.current) return;
    authRestoreAttempted.current = true;
    const accessToken = authSession?.accessToken;
    if (!accessToken || !isAuthServiceConfigured()) return;
    let mounted = true;
    restoreAuthSession(accessToken).catch(() => authSession?.refreshToken ? refreshAuthSession(authSession.refreshToken) : Promise.reject(new Error('AUTH_SESSION_INVALID'))).then((session) => { if (mounted) { saveWebAuthSession(session); setAuthSessionState(session); setProfile(session.profile); } }).catch((error: unknown) => {
      if (mounted && error instanceof Error && (error.name === 'TypeError' || error.name === 'AbortError')) {
        showToast('登录服务暂时不可用，当前会话保留，请检查网络后重试。');
        return;
      }
      if (mounted) { saveWebAuthSession(null); setAuthSessionState(null); setProfile(createEmptyProfile()); showToast('登录会话已失效，请重新登录。'); }
    });
    return () => { mounted = false; };
  }, [authSession?.accessToken, authSession?.refreshToken, hydrated, showToast]);

  const updateDailyState = useCallback((state: Pick<DailyState, 'weightKg' | 'sleep' | 'fatigue' | 'soreness'>) => {
    const normalized = { ...state, sleep: state.sleep.trim() || '未记录', fatigue: state.fatigue.trim() || '未记录', soreness: state.soreness.trim() || '未记录' };
    const sleepHours = Number.parseFloat(normalized.sleep);
    const hasSleep = Number.isFinite(sleepHours);
    const hasFatigue = normalized.fatigue !== '未记录';
    const hasSoreness = normalized.soreness !== '未记录';
    const factorCount = Number(hasSleep) + Number(hasFatigue) + Number(hasSoreness);
    const fatigueScore = normalized.fatigue === '高' ? 2 : normalized.fatigue === '中等' ? 1 : 0;
    const sorenessScore = normalized.soreness.includes('高') ? 2 : normalized.soreness.includes('中等') ? 1 : 0;
    const readinessScore = factorCount === 0 ? 0 : Math.max(40, Math.min(98, Math.round(70 + (hasSleep ? (sleepHours - 7) * 5 : 0) - fatigueScore * 10 - sorenessScore * 7)));
    const readinessLabel = readinessScore >= 75 ? 'GOOD' : readinessScore >= 55 ? 'FAIR' : 'LOW';
    setDailyState((current) => ({
      ...current, ...normalized, readinessScore, readinessLabel,
      source: factorCount > 0 ? '手动记录' : '未记录', sourceType: factorCount > 0 ? 'manual' : 'unknown', quality: factorCount === 3 ? 'complete' : factorCount > 0 ? 'partial' : 'unknown', updatedAt: new Date().toISOString(),
    }));
    showToast('今日状态已更新');
  }, [showToast]);
  const applyHealthData = useCallback((input: { weightKg?: number; sleepHours?: number; source: string; observedAt: string }) => {
    if (input.weightKg === undefined && input.sleepHours === undefined) { showToast('没有可写入今日状态的健康数据。'); return; }
    setDailyState((current) => {
      const sleep = input.sleepHours === undefined ? current.sleep : `${input.sleepHours} 小时`;
      const hasSleep = input.sleepHours !== undefined || Number.isFinite(Number.parseFloat(current.sleep));
      const hasFatigue = current.fatigue !== '未记录';
      const hasSoreness = current.soreness !== '未记录';
      const factorCount = Number(hasSleep) + Number(hasFatigue) + Number(hasSoreness);
      const sleepHours = input.sleepHours ?? Number.parseFloat(current.sleep);
      const fatigueScore = current.fatigue === '高' ? 2 : current.fatigue === '中等' ? 1 : 0;
      const sorenessScore = current.soreness.includes('高') ? 2 : current.soreness.includes('中等') ? 1 : 0;
      const readinessScore = factorCount === 0 ? 0 : Math.max(40, Math.min(98, Math.round(70 + (Number.isFinite(sleepHours) ? (sleepHours - 7) * 5 : 0) - fatigueScore * 10 - sorenessScore * 7)));
      return { ...current, weightKg: input.weightKg ?? current.weightKg, sleep, readinessScore, readinessLabel: readinessScore >= 75 ? 'GOOD' : readinessScore >= 55 ? 'FAIR' : 'LOW', source: input.source, sourceType: current.sourceType === 'manual' ? 'mixed' : 'health', quality: factorCount === 3 ? 'complete' : factorCount > 0 ? 'partial' : 'unknown', updatedAt: input.observedAt };
    });
    showToast('健康数据已写入今日状态');
  }, [showToast]);
  const recordHealthSnapshot = useCallback((snapshot: Omit<HealthSnapshot, 'id'>) => {
    if (snapshot.weightKg === undefined && snapshot.sleepHours === undefined) return;
    setHealthSnapshots((current) => [{ ...snapshot, id: `${snapshot.source}-${snapshot.observedAt}` }, ...current.filter((item) => item.id !== `${snapshot.source}-${snapshot.observedAt}`)].slice(0, 90));
  }, []);

  const dailyPlan = useMemo<DailyPlan>(() => ({
    ...createEmptyDailyPlan(),
    workout: { ...workout, exerciseCount: exercises.length, setCount: exercises.reduce((total, exercise) => total + exercise.sets.length, 0), completedSetCount: exercises.flatMap((exercise) => exercise.sets).filter((set) => set.status === 'completed').length, status: workoutStatus },
    bodyState: dailyState,
    nutritionTarget: nutrition,
    goal: profile.goal,
  }), [dailyState, exercises, nutrition, profile.goal, workout, workoutStatus]);

  const applyCoachInsight = useCallback((exerciseName?: string): ApplyCoachPlanResult => {
    const target = exerciseName?.trim() || exercises[0]?.exercise.name;
    if (!target) {
      showToast('没有可修改的训练动作。');
      return { changed: false, commandsApplied: 0, duplicateCommandsSkipped: 0, results: [] };
    }
    const result = applyCoachPlan({ commands: [{ type: 'adjust_workout', exerciseName: target, addSets: 1 }] });
    setCoachInsightApplied(result.changed);
    return result;
  }, [applyCoachPlan, exercises, showToast]);
  const undoCoachInsight = useCallback(() => { setCoachInsightApplied(false); showToast('已取消建议标记；已写入的训练计划改动保留。'); }, [showToast]);
  const startWorkout = useCallback(() => {
    setWorkoutStatus('active');
    setWorkoutStartedAt((current) => current ?? Date.now());
  }, []);
  const finishWorkout = useCallback(() => setWorkoutStatus('active'), []);
  const markWorkoutComplete = useCallback(() => {
    const completedSets = exercises.flatMap((item) => item.sets).filter((set) => set.status === 'completed').length;
    if (completedSets === 0) {
      showToast('至少完成一组训练后，才能记录为完成。');
      return;
    }
    const session = createWorkoutSession({ workoutId: dailyPlan.workout.id, workoutTitle: dailyPlan.workout.title, exercises, startedAt: workoutStartedAt });
    setCompletedSessions((current) => [session, ...current.filter((item) => item.id !== session.id)].slice(0, 30));
    setWorkoutStatus('completed');
    setRestSeconds(null);
    setWorkoutStartedAt(null);
  }, [dailyPlan.workout.id, dailyPlan.workout.title, exercises, showToast, workoutStartedAt]);

  const currentSummary = useMemo(() => buildWorkoutSummary({
    workoutTitle: dailyPlan.workout.title,
    exercises,
    startedAt: workoutStartedAt,
    previousSessions: completedSessions,
  }), [completedSessions, dailyPlan.workout.title, exercises, workoutStartedAt]);
  const recentSummary = useMemo(() => {
    const recent = completedSessions[0];
    return recent ? buildWorkoutSummary({ sessionId: recent.id, workoutTitle: recent.workoutTitle, exercises: recent.exercises, startedAt: recent.startedAt, completedAt: recent.completedAt, previousSessions: completedSessions.slice(1) }) : null;
  }, [completedSessions]);

  const clearHealthSnapshots = useCallback(() => setHealthSnapshots([]), []);

  const mergeHealthSnapshots = useCallback((snapshots: HealthSnapshot[]) => {
    setHealthSnapshots((current) => {
      const merged = new Map<string, HealthSnapshot>(current.map((item) => [item.id, item]));
      snapshots.forEach((item) => merged.set(item.id, item));
      return [...merged.values()].sort((left, right) => right.observedAt.localeCompare(left.observedAt)).slice(0, 180);
    });
  }, []);

  const stateValue = useMemo<ForgeAppData>(() => ({
    exercises, workout, completedSessions, profile, authSession, hydrated, dailyPlan, workoutStatus, restSeconds, workoutStartedAt, coachInsightApplied,
    completedSetCount: (dailyPlan.workout.completedSetCount ?? 0) + exercises.flatMap((item) => item.sets).filter((set) => set.status === 'completed').length,
    currentSummary, recentSummary, lastAddedSet: recentlyAddedSet, healthSnapshots, cloudSyncStatus, cloudConnectivity, cloudSyncError, cloudSyncPending, cloudRevision, cloudRemoteSummary, cloudRemoteDiff,
    coachMessages, nutrition, foodEntries, foods, mealPlan, mealPlanApplied,
  }), [authSession, cloudConnectivity, cloudRemoteDiff, cloudRemoteSummary, cloudRevision, cloudSyncError, cloudSyncPending, cloudSyncStatus, coachInsightApplied, coachMessages, completedSessions, currentSummary, dailyPlan, exercises, foodEntries, foods, healthSnapshots, hydrated, lastAddedSet, mealPlan, mealPlanApplied, nutrition, profile, recentlyAddedSet, recentSummary, restSeconds, workout, workoutStartedAt, workoutStatus]);

  const actionsValue = useMemo<ForgeAppActions>(() => ({
    setAuthSession, signOut, updateSet, completeSet, addRestTime: () => setRestSeconds((current) => (current ?? 0) + 30),
    startWorkout, applyCoachInsight, undoCoachInsight, finishWorkout, markWorkoutComplete,
    addSet, undoLastAddedSet, removeExercise, replaceExercise, createWorkoutPlan, updateWorkoutPlan, deleteWorkoutPlan, updateGoal, updateWeeklyWorkoutGoal, updateTrainingPreferences, updateNotificationPreferences, updateCoachDataConsent, applyCoachPlan, updateSessionNotes, updateDailyState, applyHealthData,
    recordHealthSnapshot, mergeHealthSnapshots, clearHealthSnapshots, showToast, syncNow, restoreFromCloud, inspectCloud, mergeCloudConflict,
    setCoachMessages, applyMealPlan, undoMealPlan, addFoodEntry, createFood, updateFood, removeFood, updateNutritionTarget, removeFoodEntry, updateFoodEntry, setFoodAvailable, toggleFoodStatus,
  }), [addFoodEntry, addSet, applyCoachInsight, applyCoachPlan, applyHealthData, applyMealPlan, clearHealthSnapshots, completeSet, createFood, updateFood, updateWorkoutPlan, createWorkoutPlan, deleteWorkoutPlan, finishWorkout, inspectCloud, markWorkoutComplete, mergeCloudConflict, mergeHealthSnapshots, recordHealthSnapshot, removeExercise, removeFood, removeFoodEntry, replaceExercise, restoreFromCloud, setAuthSession, setCoachMessages, showToast, signOut, startWorkout, syncNow, toggleFoodStatus, undoCoachInsight, undoLastAddedSet, undoMealPlan, updateDailyState, updateFoodEntry, updateGoal, updateNotificationPreferences, updateNutritionTarget, updateSet, updateSessionNotes, updateTrainingPreferences, updateWeeklyWorkoutGoal, updateWorkoutPlan, updateCoachDataConsent, setFoodAvailable]);

  return <ForgeStateContext.Provider value={stateValue}>
    <ForgeActionsContext.Provider value={actionsValue}>
      {children}
      <PersistenceStatusBanner status={persistenceStatus} lastPersistedAt={lastPersistedAt} isPersistedStale={isPersistedStale} onRetry={retryPersistence} />
      <CloudSyncStatusBanner status={cloudSyncStatus} connectivity={cloudConnectivity} pending={cloudSyncPending} error={cloudSyncError} onRetry={() => void syncNow()} />
      <ToastOverlay toast={toast} onDismiss={() => setToast(null)} />
    </ForgeActionsContext.Provider>
  </ForgeStateContext.Provider>;
}

export function useForgeAppState() {
  const value = useContext(ForgeStateContext);
  if (!value) throw new Error('useForgeAppState must be used inside ForgeAppProvider');
  return value;
}

export function useForgeAppActions() {
  const value = useContext(ForgeActionsContext);
  if (!value) throw new Error('useForgeAppActions must be used inside ForgeAppProvider');
  return value;
}

export function useForgeApp() {
  const state = useForgeAppState();
  const actions = useForgeAppActions();
  return useMemo<ForgeAppState>(() => ({ ...state, ...actions }), [actions, state]);
}

function ToastOverlay({ toast, onDismiss }: { toast: { message: string; action?: ToastAction } | null; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return <View style={[styles.toastPosition, { bottom: insets.bottom + control.touch + spacing.sm }]}> 
    <View style={styles.toast}><ForgeText variant="caption" style={styles.toastMessage}>{toast.message}</ForgeText>{toast.action ? <Pressable accessibilityRole="button" accessibilityLabel={toast.action.label} hitSlop={8} onPress={() => { toast.action?.onPress(); onDismiss(); }} style={({ pressed }) => [styles.toastAction, pressed && { opacity: 0.72 }]}><ForgeText variant="label" tone="accent">{toast.action.label}</ForgeText></Pressable> : null}</View>
  </View>;
}

function PersistenceStatusBanner({ status, lastPersistedAt, isPersistedStale, onRetry }: { status: PersistenceStatus; lastPersistedAt: string | null; isPersistedStale: boolean; onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  if (status === 'loading') return <View accessibilityLiveRegion="polite" style={styles.loadingOverlay}><ActivityIndicator color={colors.accent} /><ForgeText variant="caption" tone="secondary">正在读取本地记录…</ForgeText></View>;
  if (status === 'saving') return <View accessibilityLiveRegion="polite" style={[styles.savingBanner, { top: insets.top + spacing.xs }]}><ActivityIndicator size="small" color={colors.accent} /><ForgeText variant="caption" tone="secondary">正在保存本地记录…</ForgeText></View>;
  if (status === 'error') return <View accessibilityLiveRegion="assertive" style={[styles.errorBanner, { top: insets.top + spacing.xs }]}><View style={styles.errorCopy}><ForgeText variant="label" tone="warning">本地记录保存失败</ForgeText><ForgeText variant="caption" tone="secondary">当前修改仍在页面中，重试后才会写入设备。</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel="重试保存本地记录" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.72 }]}><ForgeText variant="label" tone="accent">重试</ForgeText></Pressable></View>;
  if (!isPersistedStale || !lastPersistedAt) return null;
  const savedDate = new Date(lastPersistedAt);
  return <View accessibilityLiveRegion="polite" style={[styles.staleBanner, { top: insets.top + spacing.xs }]}><View style={styles.errorCopy}><ForgeText variant="label" tone="warning">本地记录较旧</ForgeText><ForgeText variant="caption" tone="secondary">上次保存于 {formatLocalizedDate(savedDate, '时间未知')} · 当前不会自动同步到云端。</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel="重新保存本地记录" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.72 }]}><ForgeText variant="label" tone="accent">保存</ForgeText></Pressable></View>;
}

function CloudSyncStatusBanner({ status, connectivity, pending, error, onRetry }: { status: CloudSyncStatus; connectivity: CloudConnectivity; pending: boolean; error: string | null; onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  const top = insets.top + spacing.xs + control.touch + spacing.xs;
  if (status === 'syncing') return <View accessibilityLiveRegion="polite" style={[styles.savingBanner, { top }]}><ActivityIndicator size="small" color={colors.accent} /><ForgeText variant="caption" tone="secondary">正在确认云端保存…</ForgeText></View>;
  if (status === 'error' || status === 'conflict') return <View accessibilityLiveRegion="assertive" style={[styles.errorBanner, { top }]}><View style={styles.errorCopy}><ForgeText variant="label" tone="warning">云端未确认保存</ForgeText><ForgeText variant="caption" tone="secondary">{error ?? '本地记录仍然保留。'}</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel="重试云端同步" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.72 }]}><ForgeText variant="label" tone="accent">重试</ForgeText></Pressable></View>;
  if (status === 'offline' || (pending && connectivity === 'offline')) return <View accessibilityLiveRegion="polite" style={[styles.staleBanner, { top }]}><View style={styles.errorCopy}><ForgeText variant="label" tone="secondary">已保存到本机</ForgeText><ForgeText variant="caption" tone="secondary">当前离线，联网后可继续同步云端。</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel="恢复网络后同步云端" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.72 }]}><ForgeText variant="label" tone="accent">同步</ForgeText></Pressable></View>;
  if (status === 'disabled' || status === 'synced' || (!pending && status !== 'idle')) return null;
  return <View accessibilityLiveRegion="polite" style={[styles.staleBanner, { top }]}><View style={styles.errorCopy}><ForgeText variant="label" tone="secondary">有修改待同步</ForgeText><ForgeText variant="caption" tone="secondary">已保存在本机，云端尚未确认。</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel="同步待保存修改" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.72 }]}><ForgeText variant="label" tone="accent">同步</ForgeText></Pressable></View>;
}

const styles = {
  loadingOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, backgroundColor: colors.background, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.sm },
  savingBanner: { position: 'absolute' as const, left: spacing.md, right: spacing.md, zIndex: 150, minHeight: control.touch, paddingHorizontal: spacing.md, borderRadius: radius.medium, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  errorBanner: { position: 'absolute' as const, left: spacing.md, right: spacing.md, zIndex: 150, minHeight: control.touch, paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: spacing.xs, borderRadius: radius.medium, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.warning, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  staleBanner: { position: 'absolute' as const, left: spacing.md, right: spacing.md, zIndex: 150, minHeight: control.touch, paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: spacing.xs, borderRadius: radius.medium, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  errorCopy: { flex: 1, gap: spacing.xxs },
  retryButton: { minHeight: control.touch, minWidth: control.touch, paddingHorizontal: spacing.sm, alignItems: 'center' as const, justifyContent: 'center' as const },
  toastPosition: { position: 'absolute' as const, left: spacing.md, right: spacing.md, alignItems: 'center' as const, zIndex: 100 },
  toast: { minHeight: control.touch, maxWidth: 360, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.medium, borderCurve: 'continuous' as const, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.lg },
  toastMessage: { flex: 1 },
  toastAction: { minHeight: control.touch, justifyContent: 'center' as const },
};
