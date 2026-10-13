import { Platform } from 'react-native';
import { getDatabase, initializeDatabase } from '@/data/database/client';
import type { AuthSession, DailyNutrition, DailyState, Food, FoodEntry, HealthSnapshot, PlannedMeal, StoredCoachMessage, TodayWorkout, UserProfile, WorkoutExercise, WorkoutSession } from '@/types/domain';

export type ForgeSnapshot = {
  version: number;
  persistedAt?: string;
  exercises: WorkoutExercise[];
  completedSessions: WorkoutSession[];
  profile: UserProfile;
  authSession?: AuthSession | null;
  workout?: TodayWorkout;
  dailyState: DailyState;
  workoutStatus: 'scheduled' | 'active' | 'completed';
  workoutStartedAt: number | null;
  coachInsightApplied: boolean;
  nutrition: DailyNutrition;
  foodEntries: FoodEntry[];
  foods: Food[];
  mealPlan?: PlannedMeal[];
  mealPlanApplied: boolean;
  coachMessages: StoredCoachMessage[];
  healthSnapshots: HealthSnapshot[];
  pendingCloudSync?: boolean;
  cloudRevision?: number;
};

const SNAPSHOT_ID = 'default';
const WEB_AUTH_STORAGE_KEY = 'forge.auth.session.v1';
const WEB_SNAPSHOT_STORAGE_PREFIX = 'forge.snapshot.v2.';
const LEGACY_WEB_SNAPSHOT_STORAGE_KEY = 'forge.snapshot.v2';

function webSnapshotStorageKey(profileId?: string): string | null {
  const normalized = profileId?.trim();
  return normalized ? `${WEB_SNAPSHOT_STORAGE_PREFIX}${normalized}` : null;
}

export function loadWebAuthSession(): AuthSession | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    // sessionStorage survives a reload in the same browser tab, but is cleared when the tab is closed.
    // This keeps refreshes reliable without turning a new tab into an implicit auto-login.
    const raw = window.sessionStorage.getItem(WEB_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Partial<AuthSession>;
    if (typeof candidate.accessToken !== 'string' || !candidate.accessToken || !candidate.profile?.id) return null;
    return {
      accessToken: candidate.accessToken,
      refreshToken: typeof candidate.refreshToken === 'string' ? candidate.refreshToken : undefined,
      profile: candidate.profile,
    } as AuthSession;
  } catch {
    return null;
  }
}

export function saveWebAuthSession(session: AuthSession | null): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    if (!session) {
      window.sessionStorage.removeItem(WEB_AUTH_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(WEB_AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Restricted/private browser storage should not prevent the in-memory session from working.
  }
}
export const CURRENT_SNAPSHOT_VERSION = 2;

export async function loadForgeSnapshot(profileId?: string): Promise<ForgeSnapshot | null> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return null;
    try {
      const storageKey = webSnapshotStorageKey(profileId);
      if (!storageKey) return null;
      let raw = window.localStorage.getItem(storageKey);
      // Migrate only a legacy snapshot that belongs to the currently authenticated user.
      // Never load the legacy unscoped key before a user id is known.
      if (!raw) {
        const legacyRaw = window.localStorage.getItem(LEGACY_WEB_SNAPSHOT_STORAGE_KEY);
        if (legacyRaw) {
          try {
            const legacySnapshot = JSON.parse(legacyRaw) as Partial<ForgeSnapshot>;
            if (legacySnapshot.profile?.id === profileId) {
              raw = legacyRaw;
              window.localStorage.setItem(storageKey, legacyRaw);
              window.localStorage.removeItem(LEGACY_WEB_SNAPSHOT_STORAGE_KEY);
            }
          } catch {
            window.localStorage.removeItem(LEGACY_WEB_SNAPSHOT_STORAGE_KEY);
          }
        }
      }
      if (!raw) return null;
      const snapshot = JSON.parse(raw) as Partial<ForgeSnapshot>;
      if (snapshot.version !== CURRENT_SNAPSHOT_VERSION) return null;
      if (snapshot.profile?.id !== profileId) return null;
      return snapshot as ForgeSnapshot;
    } catch {
      return null;
    }
  }
  await initializeDatabase();
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ payload: string; updated_at: string }>('SELECT payload, updated_at FROM app_state WHERE id = ?', SNAPSHOT_ID);
  if (!row?.payload) return null;
  try {
    const snapshot = JSON.parse(row.payload) as Partial<ForgeSnapshot>;
    if (snapshot.version !== CURRENT_SNAPSHOT_VERSION) return null;
    return { ...(snapshot as ForgeSnapshot), persistedAt: row.updated_at };
  } catch {
    return null;
  }
}

export async function saveForgeSnapshot(snapshot: ForgeSnapshot): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') throw new Error('WEB_STORAGE_UNAVAILABLE');
    const storageKey = webSnapshotStorageKey(snapshot.profile?.id);
    if (!storageKey) return;
    const persistedSnapshot = { ...snapshot, persistedAt: new Date().toISOString() };
    window.localStorage.setItem(storageKey, JSON.stringify(persistedSnapshot));
    return;
  }
  await initializeDatabase();
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO app_state (id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    SNAPSHOT_ID,
    JSON.stringify(snapshot),
    new Date().toISOString(),
  );
}
