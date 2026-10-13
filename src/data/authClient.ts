import Constants from 'expo-constants';
import type { AuthSession, Exercise, Food, HealthSnapshot, TodayWorkout, UserProfile, WorkoutExercise } from '@/types/domain';
import type { ForgeSnapshot } from '@/data/repositories/ForgeRepository';

type AuthMode = 'login' | 'register';
type AuthInput = { email: string; password: string; confirmPassword?: string };
const DEFAULT_FORGE_API_URL = 'https://forge.iamwudi.ltd';
export type AuthChallenge = { mfaRequired: true; challengeToken: string; profile: UserProfile };
export type FoodCatalogSort = 'relevance' | 'calories_asc';
export type FoodCatalogItem = Pick<Food, 'id' | 'name' | 'caloriesPer100g' | 'protein' | 'carbs' | 'fat' | 'defaultServing' | 'unit'> & {
  sourceName?: string;
  sourceUrl?: string;
  license?: string;
};
export type ExerciseCatalogItem = Pick<Exercise, 'id' | 'name' | 'muscleGroup' | 'equipment'> & { category?: string; primaryMuscles?: string[]; instructions?: string; sourceName?: string; sourceUrl?: string; license?: string };
export type ExerciseCatalogFacets = { categories: string[]; muscleGroups: string[]; equipment: string[] };
export type ExerciseCatalogFilters = { category?: string; muscleGroup?: string; equipment?: string };
export type ExerciseCatalogPage = { exercises: ExerciseCatalogItem[]; nextCursor: string | null; total?: number; facets?: ExerciseCatalogFacets; source?: string };
export type TrainingPlanResult = { revision: number; updatedAt: string; source: 'cloud-snapshot'; workout: TodayWorkout; exercises: WorkoutExercise[] };
export type TrainingProgressionRecord = { weightKg: number; reps: number; volumeKg: number; completedAt: string };
export type TrainingProgressionInsight = { exerciseId: string; exerciseName: string; latest: TrainingProgressionRecord; previous?: TrainingProgressionRecord; suggestion: string; ruleVersion: string; ruleActivatedAt?: string | null; ruleChangeNote?: string; historyCount: number; windowDays: number };
export type TrainingProgressionResult = { generatedAt: string; exercises: TrainingProgressionInsight[] };
export type DataExportStatus = 'pending' | 'ready' | 'failed' | 'revoked' | 'expired';
export type DataExportResult = { jobId?: string; status?: DataExportStatus; downloadUrl?: string; expiresAt?: string };
export type DataExportJob = DataExportResult & { jobId: string; createdAt?: string; completedAt?: string; downloadedAt?: string };
export type AccountSession = { id: string; createdAt: string; expiresAt: string; deviceLabel: string; lastSeenAt: string; current: boolean };
export type SyncResult = { revision: number; updatedAt: string };
export type CloudSnapshotResult = { revision: number; snapshot: ForgeSnapshot | null; updatedAt: string | null };
export type CoachHistoryMessage = { id: string; role: 'user' | 'assistant'; text: string; sourceQuestion?: string; feedback?: 'up' | 'down'; createdAt: string };
export type CoachConversation = { id: string; title: string; dateKey: string; createdAt: string; updatedAt: string; lastMessagePreview: string; messageCount: number; summary: string; summaryUpdatedAt: string | null; archivedAt: string | null };

function readEnv(name: string): string {
  return typeof process !== 'undefined' && process.env ? String(process.env[name] ?? '').trim() : '';
}

function apiBaseUrl(): string {
  const configuredUrl = readEnv('EXPO_PUBLIC_FORGE_API_URL');
  const runtimeUrl = typeof Constants.expoConfig?.extra?.forgeApiUrl === 'string' ? Constants.expoConfig.extra.forgeApiUrl : '';
  return (configuredUrl || runtimeUrl || DEFAULT_FORGE_API_URL).trim().replace(/\/$/, '');
}

export function isAuthServiceConfigured(): boolean {
  return Boolean(apiBaseUrl());
}

export type CoachProviderHealth = { status: 'ready' | 'unconfigured' | 'degraded' | 'unavailable'; checkedAt: string; model: string | null; latencyMs?: number; message?: string };

export async function requestCoachProviderHealth(accessToken: string, signal?: AbortSignal): Promise<CoachProviderHealth> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/coach/health', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, signal });
  const payload = await response.json().catch(() => null) as Partial<CoachProviderHealth> | null;
  if (!response.ok || !payload || !['ready', 'unconfigured', 'degraded', 'unavailable'].includes(String(payload.status)) || typeof payload.checkedAt !== 'string') throw new Error(payload?.message || 'COACH_HEALTH_FAILED');
  return { status: payload.status as CoachProviderHealth['status'], checkedAt: payload.checkedAt, model: typeof payload.model === 'string' ? payload.model : null, latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : undefined, message: typeof payload.message === 'string' ? payload.message : undefined };
}

export async function checkAuthService(signal?: AbortSignal): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(baseUrl + '/v1/auth/session', {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok && response.status !== 401) {
    throw new Error('AUTH_SERVICE_UNAVAILABLE');
  }
}

export async function requestAuth(mode: AuthMode, input: AuthInput, signal?: AbortSignal): Promise<AuthSession | AuthChallenge> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  const payload = await response.json().catch(() => null) as { accessToken?: string; refreshToken?: string; profile?: UserProfile; user?: UserProfile; mfaRequired?: unknown; challengeToken?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'AUTH_REQUEST_FAILED');
  const profile = payload?.profile ?? payload?.user;
  if (payload?.mfaRequired === true && typeof payload.challengeToken === 'string' && profile?.id) return { mfaRequired: true, challengeToken: payload.challengeToken, profile };
  if (!payload?.accessToken || !profile?.id) throw new Error('AUTH_RESPONSE_INVALID');
  return { accessToken: payload.accessToken, refreshToken: payload.refreshToken, profile };
}

export type MfaStatus = { enabled: boolean; enabledAt: string | null };
export type MfaSetup = { status: 'pending'; secret: string; otpauthUri: string; expiresAt: string };
export type MfaEnableResult = { enabled: true; enabledAt: string; recoveryCodes: string[] };
export type SecurityAuditEvent = { eventType: string; createdAt: string };

export async function verifyMfaLogin(challengeToken: string, code: string): Promise<AuthSession> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(baseUrl + '/v1/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ challengeToken, code }) });
  const payload = await response.json().catch(() => null) as { accessToken?: unknown; refreshToken?: unknown; profile?: UserProfile; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'MFA_LOGIN_FAILED');
  if (typeof payload?.accessToken !== 'string' || !payload.profile?.id) throw new Error('AUTH_RESPONSE_INVALID');
  return { accessToken: payload.accessToken, refreshToken: typeof payload.refreshToken === 'string' ? payload.refreshToken : undefined, profile: payload.profile };
}

export async function requestMfaStatus(accessToken: string): Promise<MfaStatus> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(baseUrl + '/v1/account/mfa', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { enabled?: unknown; enabledAt?: unknown; message?: string } | null;
  if (!response.ok || typeof payload?.enabled !== 'boolean' || (payload.enabledAt !== null && typeof payload.enabledAt !== 'string')) throw new Error(payload?.message || 'MFA_STATUS_FAILED');
  return { enabled: payload.enabled, enabledAt: typeof payload.enabledAt === 'string' ? payload.enabledAt : null };
}

export async function requestMfaSetup(accessToken: string): Promise<MfaSetup> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(baseUrl + '/v1/account/mfa/setup', { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { status?: unknown; secret?: unknown; otpauthUri?: unknown; expiresAt?: unknown; message?: string } | null;
  if (!response.ok || payload?.status !== 'pending' || typeof payload.secret !== 'string' || typeof payload.otpauthUri !== 'string' || typeof payload.expiresAt !== 'string') throw new Error(payload?.message || 'MFA_SETUP_FAILED');
  return { status: 'pending', secret: payload.secret, otpauthUri: payload.otpauthUri, expiresAt: payload.expiresAt };
}

export async function enableMfa(accessToken: string, code: string): Promise<MfaEnableResult> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(baseUrl + '/v1/account/mfa/enable', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ code }) });
  const payload = await response.json().catch(() => null) as { enabled?: unknown; enabledAt?: unknown; recoveryCodes?: unknown; message?: string } | null;
  if (!response.ok || payload?.enabled !== true || typeof payload.enabledAt !== 'string' || !Array.isArray(payload.recoveryCodes) || payload.recoveryCodes.some((item) => typeof item !== 'string')) throw new Error(payload?.message || 'MFA_ENABLE_FAILED');
  return { enabled: true, enabledAt: payload.enabledAt, recoveryCodes: payload.recoveryCodes };
}

export async function disableMfa(accessToken: string, code: string): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(baseUrl + '/v1/account/mfa', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ code }) });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'MFA_DISABLE_FAILED');
}

export async function requestSecurityAudit(accessToken: string, options: { cursor?: string; limit?: number } = {}): Promise<{ events: SecurityAuditEvent[]; nextCursor: string | null }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(options.limit ?? 50, 1), 100)) });
  if (options.cursor) params.set('cursor', options.cursor);
  const response = await fetch(baseUrl + '/v1/account/security-audit?' + params.toString(), { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { events?: unknown; nextCursor?: unknown; message?: string } | null;
  if (!response.ok || !Array.isArray(payload?.events) || (payload.nextCursor !== null && payload.nextCursor !== undefined && typeof payload.nextCursor !== 'string')) throw new Error(payload?.message || 'SECURITY_AUDIT_FAILED');
  const events = payload.events.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.eventType !== 'string' || typeof candidate.createdAt !== 'string') return [];
    return [{ eventType: candidate.eventType, createdAt: candidate.createdAt }];
  });
  return { events, nextCursor: payload.nextCursor === null || payload.nextCursor === undefined ? null : payload.nextCursor };
}

export type RecoveryCodeStatus = { total: number; remaining: number };

export async function requestRecoveryCodeStatus(accessToken: string): Promise<RecoveryCodeStatus> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/account/mfa/recovery-codes', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { total?: unknown; remaining?: unknown; message?: string } | null;
  if (!response.ok || typeof payload?.total !== 'number' || !Number.isInteger(payload.total) || payload.total < 0 || typeof payload.remaining !== 'number' || !Number.isInteger(payload.remaining) || payload.remaining < 0 || payload.remaining > payload.total) throw new Error(payload?.message || 'MFA_RECOVERY_STATUS_FAILED');
  return { total: payload.total, remaining: payload.remaining };
}

async function updateRecoveryCodes(accessToken: string, code: string, method: 'POST' | 'DELETE'): Promise<string[]> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/account/mfa/recovery-codes', { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ code }) });
  const payload = await response.json().catch(() => null) as { recoveryCodes?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'MFA_RECOVERY_CODES_UPDATE_FAILED');
  if (method === 'DELETE') return [];
  if (!Array.isArray(payload?.recoveryCodes) || payload.recoveryCodes.length !== 8 || payload.recoveryCodes.some((item) => typeof item !== 'string')) throw new Error('MFA_RECOVERY_CODES_RESPONSE_INVALID');
  return payload.recoveryCodes;
}

export async function regenerateRecoveryCodes(accessToken: string, code: string): Promise<string[]> {
  return updateRecoveryCodes(accessToken, code, 'POST');
}

export async function revokeRecoveryCodes(accessToken: string, code: string): Promise<void> {
  await updateRecoveryCodes(accessToken, code, 'DELETE');
}

export async function requestEmailVerification(accessToken: string): Promise<{ status: 'sent'; expiresAt?: string }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/account/email-verification/resend', { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { status?: unknown; expiresAt?: unknown; code?: unknown; message?: string } | null;
  if (!response.ok || payload?.status !== 'sent' || (payload.expiresAt !== undefined && typeof payload.expiresAt !== 'string')) {
    const failure = new Error(payload?.message || 'EMAIL_VERIFICATION_FAILED') as Error & { code?: string; retryAfterSeconds?: number };
    if (typeof payload?.code === 'string') failure.code = payload.code;
    const retryAfter = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) failure.retryAfterSeconds = Math.ceil(retryAfter);
    throw failure;
  }
  return { status: 'sent', expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : undefined };
}

export async function requestEmailChange(accessToken: string, newEmail: string, currentPassword: string): Promise<{ status: 'sent'; email: string; expiresAt?: string }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/account/email-change/request', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ newEmail: newEmail.trim(), currentPassword }) });
  const payload = await response.json().catch(() => null) as { status?: unknown; email?: unknown; expiresAt?: unknown; code?: unknown; message?: string } | null;
  if (!response.ok || payload?.status !== 'sent' || typeof payload.email !== 'string' || (payload.expiresAt !== undefined && typeof payload.expiresAt !== 'string')) {
    const failure = new Error(payload?.message || 'EMAIL_CHANGE_REQUEST_FAILED') as Error & { code?: string; retryAfterSeconds?: number };
    if (typeof payload?.code === 'string') failure.code = payload.code;
    const retryAfter = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) failure.retryAfterSeconds = Math.ceil(retryAfter);
    throw failure;
  }
  return { status: 'sent', email: payload.email, expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : undefined };
}

export async function verifyEmail(tokenValue: string): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!tokenValue.trim()) throw new Error('EMAIL_VERIFICATION_INVALID');
  const response = await fetch(baseUrl + '/v1/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token: tokenValue.trim() }) });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'EMAIL_VERIFICATION_FAILED');
}

export async function requestPasswordReset(email: string, signal?: AbortSignal): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }), signal });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'PASSWORD_RESET_REQUEST_FAILED');
}

export async function restoreAuthSession(accessToken: string, signal?: AbortSignal): Promise<AuthSession> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  let lastError: unknown = new Error('AUTH_SESSION_INVALID');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const abortRequest = () => controller.abort();
    signal?.addEventListener('abort', abortRequest, { once: true });
    try {
      const response = await fetch(`${baseUrl}/v1/auth/session`, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
      const payload = await response.json().catch(() => null) as { refreshToken?: string; profile?: UserProfile; user?: UserProfile; message?: string } | null;
      if (!response.ok) throw new Error(payload?.message || 'AUTH_SESSION_INVALID');
      const profile = payload?.profile ?? payload?.user;
      if (!payload || !profile?.id) throw new Error('AUTH_RESPONSE_INVALID');
      return { accessToken, refreshToken: payload.refreshToken, profile };
    } catch (error: unknown) {
      lastError = error;
      if (attempt === 1 || signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350));
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortRequest);
    }
  }
  throw lastError;
}

export async function refreshAuthSession(refreshToken: string, signal?: AbortSignal): Promise<AuthSession> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ refreshToken }), signal });
  const payload = await response.json().catch(() => null) as { accessToken?: string; refreshToken?: string; profile?: UserProfile; user?: UserProfile; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'AUTH_REFRESH_INVALID');
  const profile = payload?.profile ?? payload?.user;
  if (!payload?.accessToken || !profile?.id) throw new Error('AUTH_RESPONSE_INVALID');
  return { accessToken: payload.accessToken, refreshToken: payload.refreshToken, profile };
}

export async function requestLogout(accessToken: string): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return;
  await fetch(`${baseUrl}/v1/auth/logout`, { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } }).catch(() => undefined);
}

export async function requestDataExport(accessToken: string): Promise<DataExportResult> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/account/export`, { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => null) as { message?: string; jobId?: unknown; status?: unknown; downloadUrl?: unknown; expiresAt?: unknown } | null;
  if (!response.ok) throw new Error(payload?.message || 'DATA_EXPORT_REQUEST_FAILED');
  if (payload?.jobId !== undefined && typeof payload.jobId !== 'string') throw new Error('DATA_EXPORT_RESPONSE_INVALID');
  if (payload?.status !== undefined && !['pending', 'ready', 'failed', 'revoked', 'expired'].includes(String(payload.status))) throw new Error('DATA_EXPORT_RESPONSE_INVALID');
  if (payload?.downloadUrl !== undefined && payload.downloadUrl !== null && (typeof payload.downloadUrl !== 'string' || !/^https:\/\//i.test(payload.downloadUrl))) throw new Error('DATA_EXPORT_RESPONSE_INVALID');
  if (payload?.expiresAt !== undefined && typeof payload.expiresAt !== 'string') throw new Error('DATA_EXPORT_RESPONSE_INVALID');
  return { jobId: payload?.jobId, status: payload?.status as DataExportStatus | undefined, downloadUrl: typeof payload?.downloadUrl === 'string' ? payload.downloadUrl : undefined, expiresAt: payload?.expiresAt };
}

export async function requestDataExportStatus(accessToken: string, jobId: string): Promise<DataExportResult> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/account/export/${encodeURIComponent(jobId)}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => null) as { message?: string; id?: unknown; status?: unknown; downloadUrl?: unknown; expiresAt?: unknown } | null;
  if (!response.ok) throw new Error(payload?.message || 'DATA_EXPORT_STATUS_FAILED');
  if (payload?.id !== jobId || !['pending', 'ready', 'failed', 'revoked', 'expired'].includes(String(payload.status))) throw new Error('DATA_EXPORT_RESPONSE_INVALID');
  if (payload.downloadUrl !== undefined && payload.downloadUrl !== null && (typeof payload.downloadUrl !== 'string' || !/^https:\/\//i.test(payload.downloadUrl))) throw new Error('DATA_EXPORT_RESPONSE_INVALID');
  if (payload.expiresAt !== undefined && typeof payload.expiresAt !== 'string') throw new Error('DATA_EXPORT_RESPONSE_INVALID');
  return { jobId, status: payload.status as DataExportStatus, downloadUrl: typeof payload.downloadUrl === 'string' ? payload.downloadUrl : undefined, expiresAt: payload.expiresAt };
}

export async function requestDataExportHistory(accessToken: string): Promise<DataExportJob[]> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/account/export`, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => null) as { jobs?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'DATA_EXPORT_HISTORY_FAILED');
  if (!Array.isArray(payload?.jobs)) throw new Error('DATA_EXPORT_RESPONSE_INVALID');
  return payload.jobs.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !['pending', 'ready', 'failed', 'revoked', 'expired'].includes(String(candidate.status))) return [];
    if (candidate.downloadUrl !== undefined && candidate.downloadUrl !== null && (typeof candidate.downloadUrl !== 'string' || !/^https:\/\//i.test(candidate.downloadUrl))) return [];
    return [{ jobId: candidate.id, status: candidate.status as DataExportStatus, downloadUrl: typeof candidate.downloadUrl === 'string' ? candidate.downloadUrl : undefined, expiresAt: typeof candidate.expiresAt === 'string' ? candidate.expiresAt : undefined, createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : undefined, completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : undefined, downloadedAt: typeof candidate.downloadedAt === 'string' ? candidate.downloadedAt : undefined }];
  });
}

export async function revokeDataExport(accessToken: string, jobId: string): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/account/export/${encodeURIComponent(jobId)}`, { method: 'DELETE', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'DATA_EXPORT_REVOKE_FAILED');
}

export type PrivacyPolicySection = { id: string; title: string; body: string };
export type PrivacyPolicy = {
  version: string;
  effectiveAt: string;
  securityAuditRetentionDays: number;
  exportIncludesSecurityAudit: boolean;
  accountDeletionIncludesSecurityAudit: boolean;
  healthDataStoredServerSide: boolean;
  sections: PrivacyPolicySection[];
};

export async function requestPrivacyPolicy(accessToken: string): Promise<PrivacyPolicy> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/account/privacy-policy', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as Partial<PrivacyPolicy> & { message?: string } | null;
  const sections = Array.isArray(payload?.sections) ? payload.sections.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    return typeof candidate.id === 'string' && typeof candidate.title === 'string' && typeof candidate.body === 'string' ? [{ id: candidate.id, title: candidate.title, body: candidate.body }] : [];
  }) : [];
  if (!response.ok || typeof payload?.version !== 'string' || typeof payload?.effectiveAt !== 'string' || typeof payload?.securityAuditRetentionDays !== 'number' || !Number.isInteger(payload.securityAuditRetentionDays) || payload.securityAuditRetentionDays < 30 || payload.securityAuditRetentionDays > 730 || payload.exportIncludesSecurityAudit !== true || payload.accountDeletionIncludesSecurityAudit !== true || payload.healthDataStoredServerSide !== true || sections.length === 0) throw new Error(payload?.message || 'PRIVACY_POLICY_FAILED');
  return {
    version: payload.version,
    effectiveAt: payload.effectiveAt,
    securityAuditRetentionDays: payload.securityAuditRetentionDays,
    exportIncludesSecurityAudit: true,
    accountDeletionIncludesSecurityAudit: true,
    healthDataStoredServerSide: true,
    sections,
  };
}

export async function requestAccountSessions(accessToken: string): Promise<AccountSession[]> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/account/sessions', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { sessions?: unknown; message?: string } | null;
  if (!response.ok || !Array.isArray(payload?.sessions)) throw new Error(payload?.message || 'ACCOUNT_SESSIONS_FAILED');
  return payload.sessions.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.createdAt !== 'string' || typeof candidate.expiresAt !== 'string' || typeof candidate.deviceLabel !== 'string' || typeof candidate.lastSeenAt !== 'string' || typeof candidate.current !== 'boolean') return [];
    return [{ id: candidate.id, createdAt: candidate.createdAt, expiresAt: candidate.expiresAt, deviceLabel: candidate.deviceLabel, lastSeenAt: candidate.lastSeenAt, current: candidate.current }];
  });
}

export async function revokeAccountSession(accessToken: string, sessionId: string): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/account/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE', headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'ACCOUNT_SESSION_REVOKE_FAILED');
}

export async function revokeOtherAccountSessions(accessToken: string): Promise<{ revokedCount: number; revokedAt: string }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/account/sessions/revoke-others', { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { revokedCount?: unknown; revokedAt?: unknown; message?: string } | null;
  if (!response.ok || typeof payload?.revokedCount !== 'number' || !Number.isInteger(payload.revokedCount) || payload.revokedCount < 0 || typeof payload.revokedAt !== 'string') throw new Error(payload?.message || 'ACCOUNT_SESSIONS_REVOKE_FAILED');
  return { revokedCount: payload.revokedCount, revokedAt: payload.revokedAt };
}

export async function requestAccountDeletion(accessToken: string): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/account`, { method: 'DELETE', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'ACCOUNT_DELETION_FAILED');
}

export async function submitUserFeedback(accessToken: string, input: { category: string; message: string }): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'FEEDBACK_SUBMIT_FAILED');
}

export async function requestCoachConsent(accessToken: string, enabled: boolean): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(`${baseUrl}/v1/account/coach-consent`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ enabled }) });
  const payload = await response.json().catch(() => null) as { message?: string; enabled?: unknown } | null;
  if (!response.ok) throw new Error(payload?.message || 'COACH_CONSENT_UPDATE_FAILED');
  if (payload?.enabled !== enabled) throw new Error('COACH_CONSENT_RESPONSE_INVALID');
}

export async function searchNutritionFoodCatalog(accessToken: string, query: string, options: { cursor?: string; limit?: number; sort?: FoodCatalogSort; signal?: AbortSignal } = {}): Promise<{ foods: FoodCatalogItem[]; nextCursor: string | null }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const params = new URLSearchParams({ query: query.trim(), limit: String(Math.min(Math.max(options.limit ?? 20, 1), 50)), sort: options.sort ?? 'relevance' });
  if (options.cursor) params.set('cursor', options.cursor);
  const response = await fetch(`${baseUrl}/v1/nutrition/foods/search?${params.toString()}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }, signal: options.signal });
  const payload = await response.json().catch(() => null) as { foods?: unknown; nextCursor?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'FOOD_CATALOG_SEARCH_FAILED');
  if (!Array.isArray(payload?.foods)) throw new Error('FOOD_CATALOG_RESPONSE_INVALID');
  const foods = payload.foods.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    const numeric = ['caloriesPer100g', 'protein', 'carbs', 'fat'].map((key) => Number(candidate[key]));
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.defaultServing !== 'string' || numeric.some((value) => !Number.isFinite(value) || value < 0)) return [];
    const sourceUrl = typeof candidate.sourceUrl === 'string' && /^https?:\/\//i.test(candidate.sourceUrl) ? candidate.sourceUrl : undefined;
    return [{ id: candidate.id, name: candidate.name, defaultServing: candidate.defaultServing, caloriesPer100g: numeric[0], protein: numeric[1], carbs: numeric[2], fat: numeric[3], unit: typeof candidate.unit === 'string' ? candidate.unit : undefined, sourceName: typeof candidate.sourceName === 'string' ? candidate.sourceName : undefined, sourceUrl, license: typeof candidate.license === 'string' ? candidate.license : undefined }];
  });
  if (payload.nextCursor !== undefined && payload.nextCursor !== null && typeof payload.nextCursor !== 'string') throw new Error('FOOD_CATALOG_RESPONSE_INVALID');
  return { foods, nextCursor: payload.nextCursor === null || payload.nextCursor === undefined ? null : payload.nextCursor };
}

export type CoachAuditEvent = { eventType: string; consentEnabled: boolean; contextSent: boolean; createdAt: string };

async function transcribeVoiceAtPath(accessToken: string, audioUri: string, path: '/v1/coach/voice' | '/v1/nutrition/voice'): Promise<string> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  if (!audioUri) throw new Error('AUDIO_REQUIRED');
  const audioResponse = await fetch(audioUri);
  if (!audioResponse.ok) throw new Error('AUDIO_READ_FAILED');
  const blob = await audioResponse.blob();
  if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('AUDIO_INVALID');
  const form = new FormData();
  form.append('file', blob, blob.type.includes('webm') ? 'forge-recording.webm' : 'forge-recording.m4a');
  const response = await fetch(baseUrl + path, { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, body: form });
  const payload = await response.json().catch(() => null) as { text?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'VOICE_TRANSCRIPTION_FAILED');
  if (typeof payload?.text !== 'string' || !payload.text.trim()) throw new Error('VOICE_TRANSCRIPTION_RESPONSE_INVALID');
  return payload.text.trim();
}

export async function transcribeNutritionVoice(accessToken: string, audioUri: string): Promise<string> {
  return transcribeVoiceAtPath(accessToken, audioUri, '/v1/nutrition/voice');
}

export async function transcribeCoachVoice(accessToken: string, audioUri: string): Promise<string> {
  return transcribeVoiceAtPath(accessToken, audioUri, '/v1/coach/voice');
}

export async function requestCoachAudit(accessToken: string, options: { cursor?: string; limit?: number } = {}): Promise<{ events: CoachAuditEvent[]; nextCursor: string | null }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(options.limit ?? 50, 1), 100)) });
  if (options.cursor) params.set('cursor', options.cursor);
  const response = await fetch(baseUrl + '/v1/coach/audit?' + params.toString(), { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { events?: unknown; nextCursor?: unknown; message?: string } | null;
  if (!response.ok || !Array.isArray(payload?.events) || (payload.nextCursor !== null && payload.nextCursor !== undefined && typeof payload.nextCursor !== 'string')) throw new Error(payload?.message || 'COACH_AUDIT_FAILED');
  const events = payload.events.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.eventType !== 'string' || typeof candidate.consentEnabled !== 'boolean' || typeof candidate.contextSent !== 'boolean' || typeof candidate.createdAt !== 'string') return [];
    return [{ eventType: candidate.eventType, consentEnabled: candidate.consentEnabled, contextSent: candidate.contextSent, createdAt: candidate.createdAt }];
  });
  return { events, nextCursor: payload.nextCursor === null || payload.nextCursor === undefined ? null : payload.nextCursor };
}

export async function requestCoachConversations(accessToken: string, options: { query?: string; includeArchived?: boolean } = {}): Promise<{ conversations: CoachConversation[] }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set('query', options.query.trim());
  if (options.includeArchived) params.set('includeArchived', '1');
  const response = await fetch(baseUrl + '/v1/coach/conversations?' + params.toString(), { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { conversations?: unknown; message?: string } | null;
  if (!response.ok || !Array.isArray(payload?.conversations)) throw new Error(payload?.message || 'COACH_CONVERSATIONS_FAILED');
  const conversations = payload.conversations.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || typeof candidate.dateKey !== 'string' || typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string' || typeof candidate.lastMessagePreview !== 'string' || !Number.isInteger(candidate.messageCount)) return [];
    return [{ id: candidate.id, title: candidate.title, dateKey: candidate.dateKey, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt, lastMessagePreview: candidate.lastMessagePreview, messageCount: candidate.messageCount as number, summary: typeof candidate.summary === 'string' ? candidate.summary : '', summaryUpdatedAt: typeof candidate.summaryUpdatedAt === 'string' ? candidate.summaryUpdatedAt : null, archivedAt: typeof candidate.archivedAt === 'string' ? candidate.archivedAt : null }];
  });
  return { conversations };
}
export async function createCoachConversation(accessToken: string, input: { dateKey?: string; title?: string } = {}): Promise<CoachConversation> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  const response = await fetch(baseUrl + '/v1/coach/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => null) as { conversation?: unknown; message?: string } | null;
  if (!response.ok || !payload?.conversation || typeof payload.conversation !== 'object') throw new Error(payload?.message || 'COACH_CONVERSATION_CREATE_FAILED');
  const candidate = payload.conversation as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || typeof candidate.dateKey !== 'string' || typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string' || typeof candidate.lastMessagePreview !== 'string' || !Number.isInteger(candidate.messageCount)) throw new Error('COACH_CONVERSATION_RESPONSE_INVALID');
  return { id: candidate.id, title: candidate.title, dateKey: candidate.dateKey, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt, lastMessagePreview: candidate.lastMessagePreview, messageCount: candidate.messageCount as number, summary: typeof candidate.summary === 'string' ? candidate.summary : '', summaryUpdatedAt: typeof candidate.summaryUpdatedAt === 'string' ? candidate.summaryUpdatedAt : null, archivedAt: typeof candidate.archivedAt === 'string' ? candidate.archivedAt : null };
}
export async function updateCoachConversation(accessToken: string, id: string, input: { title?: string; archived?: boolean }): Promise<void> {
  const baseUrl = apiBaseUrl();
  const response = await fetch(baseUrl + '/v1/coach/conversations/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify(input) });
  if (!response.ok) { const payload = await response.json().catch(() => null) as { message?: string } | null; throw new Error(payload?.message || 'COACH_CONVERSATION_UPDATE_FAILED'); }
}
export async function deleteCoachConversation(accessToken: string, id: string): Promise<void> {
  const baseUrl = apiBaseUrl();
  const response = await fetch(baseUrl + '/v1/coach/conversations/' + encodeURIComponent(id), { method: 'DELETE', headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  if (!response.ok) { const payload = await response.json().catch(() => null) as { message?: string } | null; throw new Error(payload?.message || 'COACH_CONVERSATION_DELETE_FAILED'); }
}

export async function requestCoachHistory(accessToken: string, options: { conversationId?: string; cursor?: string; limit?: number; query?: string; signal?: AbortSignal } = {}): Promise<{ messages: CoachHistoryMessage[]; nextCursor: string | null }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(options.limit ?? 100, 1), 100)) });
  if (options.conversationId) params.set('conversationId', options.conversationId);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.query?.trim()) params.set('query', options.query.trim());
  const response = await fetch(baseUrl + '/v1/coach/messages?' + params.toString(), { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, signal: options.signal });
  const payload = await response.json().catch(() => null) as { messages?: unknown; nextCursor?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'COACH_HISTORY_FAILED');
  if (!Array.isArray(payload?.messages) || (payload.nextCursor !== null && payload.nextCursor !== undefined && typeof payload.nextCursor !== 'string')) throw new Error('COACH_HISTORY_RESPONSE_INVALID');
  const messages = payload.messages.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || (candidate.role !== 'user' && candidate.role !== 'assistant') || typeof candidate.text !== 'string' || typeof candidate.createdAt !== 'string') return [];
    if (candidate.sourceQuestion !== undefined && typeof candidate.sourceQuestion !== 'string') return [];
    if (candidate.feedback !== undefined && candidate.feedback !== 'up' && candidate.feedback !== 'down') return [];
    return [{ id: candidate.id, role: candidate.role as 'user' | 'assistant', text: candidate.text, sourceQuestion: typeof candidate.sourceQuestion === 'string' ? candidate.sourceQuestion : undefined, feedback: candidate.feedback as 'up' | 'down' | undefined, createdAt: candidate.createdAt }];
  });
  return { messages, nextCursor: payload.nextCursor === null || payload.nextCursor === undefined ? null : payload.nextCursor };
}

export async function clearCoachHistory(accessToken: string): Promise<number> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/coach/messages', { method: 'DELETE', headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { deletedCount?: unknown; message?: string } | null;
  if (!response.ok || typeof payload?.deletedCount !== 'number' || !Number.isInteger(payload.deletedCount) || payload.deletedCount < 0) throw new Error(payload?.message || 'COACH_HISTORY_DELETE_FAILED');
  return payload.deletedCount;
}

export async function deleteCoachMessage(accessToken: string, messageId: string): Promise<number> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  if (!messageId) throw new Error('COACH_MESSAGE_REQUIRED');
  const response = await fetch(baseUrl + '/v1/coach/messages/' + encodeURIComponent(messageId), { method: 'DELETE', headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken } });
  const payload = await response.json().catch(() => null) as { deletedCount?: unknown; message?: string } | null;
  if (!response.ok || typeof payload?.deletedCount !== 'number' || !Number.isInteger(payload.deletedCount) || payload.deletedCount < 1) throw new Error(payload?.message || 'COACH_MESSAGE_DELETE_FAILED');
  return payload.deletedCount;
}

export async function submitCoachFeedback(accessToken: string, messageId: string, feedback: 'up' | 'down' | null): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/coach/messages/' + encodeURIComponent(messageId), { method: 'PATCH', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ feedback }) });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'COACH_FEEDBACK_FAILED');
}

export async function syncForgeSnapshot(accessToken: string, snapshot: Omit<ForgeSnapshot, 'authSession' | 'pendingCloudSync' | 'cloudRevision'>, baseRevision = 0, signal?: AbortSignal): Promise<SyncResult> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(`${baseUrl}/v1/sync/snapshot`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ ...snapshot, baseRevision }), signal });
  const payload = await response.json().catch(() => null) as { message?: string; revision?: unknown; updatedAt?: unknown } | null;
  if (response.status === 409) throw new Error('SYNC_CONFLICT');
  if (!response.ok) throw new Error(payload?.message || 'SYNC_REQUEST_FAILED');
  const revision = payload && typeof payload.revision === 'number' && Number.isInteger(payload.revision) && payload.revision >= 0 ? payload.revision : null;
  if (revision === null || typeof payload?.updatedAt !== 'string') throw new Error('SYNC_RESPONSE_INVALID');
  return { revision, updatedAt: payload.updatedAt };
}

export async function deleteCloudHealthTrends(accessToken: string, baseRevision: number): Promise<{ deletedCount: number; revision: number; updatedAt: string | null }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/health/trends', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ baseRevision }) });
  const payload = await response.json().catch(() => null) as { deletedCount?: unknown; revision?: unknown; updatedAt?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'HEALTH_CLOUD_DELETE_FAILED');
  const deletedCount = typeof payload?.deletedCount === 'number' && Number.isInteger(payload.deletedCount) && payload.deletedCount >= 0 ? payload.deletedCount : null;
  const revision = typeof payload?.revision === 'number' && Number.isInteger(payload.revision) && payload.revision >= 0 ? payload.revision : null;
  const updatedAt = payload?.updatedAt === null ? null : typeof payload?.updatedAt === 'string' ? payload.updatedAt : undefined;
  if (deletedCount === null || revision === null || updatedAt === undefined) throw new Error('HEALTH_CLOUD_DELETE_RESPONSE_INVALID');
  return { deletedCount, revision, updatedAt };
}

export async function requestHealthTrends(accessToken: string, signal?: AbortSignal): Promise<{ generatedAt: string; snapshots: HealthSnapshot[] }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/health/trends', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, signal });
  const payload = await response.json().catch(() => null) as { generatedAt?: unknown; snapshots?: unknown; message?: string } | null;
  if (!response.ok || typeof payload?.generatedAt !== 'string' || !Array.isArray(payload.snapshots)) throw new Error(payload?.message || 'HEALTH_TRENDS_FAILED');
  const snapshots = payload.snapshots.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || (candidate.source !== 'Apple 健康' && candidate.source !== 'Health Connect') || typeof candidate.observedAt !== 'string') return [];
    const weightKg = candidate.weightKg === undefined ? undefined : Number(candidate.weightKg);
    const sleepHours = candidate.sleepHours === undefined ? undefined : Number(candidate.sleepHours);
    if ((weightKg !== undefined && (!Number.isFinite(weightKg) || weightKg <= 0)) || (sleepHours !== undefined && (!Number.isFinite(sleepHours) || sleepHours < 0)) || (weightKg === undefined && sleepHours === undefined)) return [];
    return [{ id: candidate.id, source: candidate.source, observedAt: candidate.observedAt, ...(weightKg === undefined ? {} : { weightKg }), ...(sleepHours === undefined ? {} : { sleepHours }) }] as HealthSnapshot[];
  });
  return { generatedAt: payload.generatedAt, snapshots };
}

export async function requestTrainingPlan(accessToken: string, signal?: AbortSignal): Promise<TrainingPlanResult> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/training/plan', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, signal });
  const payload = await response.json().catch(() => null) as { revision?: unknown; updatedAt?: unknown; source?: unknown; workout?: unknown; exercises?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'TRAINING_PLAN_FAILED');
  if (!payload || !Number.isInteger(payload.revision) || (payload.revision as number) < 0 || typeof payload.updatedAt !== 'string' || payload.source !== 'cloud-snapshot' || !payload.workout || typeof payload.workout !== 'object' || !Array.isArray(payload.exercises)) throw new Error('TRAINING_PLAN_RESPONSE_INVALID');
  return { revision: payload.revision as number, updatedAt: payload.updatedAt, source: 'cloud-snapshot', workout: payload.workout as TodayWorkout, exercises: payload.exercises as WorkoutExercise[] };
}

export async function requestTrainingProgression(accessToken: string, signal?: AbortSignal): Promise<TrainingProgressionResult> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(baseUrl + '/v1/training/progression', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken }, signal });
  const payload = await response.json().catch(() => null) as { generatedAt?: unknown; exercises?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'TRAINING_PROGRESSION_FAILED');
  if (typeof payload?.generatedAt !== 'string' || !Array.isArray(payload.exercises)) throw new Error('TRAINING_PROGRESSION_RESPONSE_INVALID');
  const exercises = payload.exercises.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    const latest = candidate.latest;
    const previous = candidate.previous;
    const validRecord = (record: unknown): record is TrainingProgressionRecord => {
      if (!record || typeof record !== 'object') return false;
      const value = record as Record<string, unknown>;
      return typeof value.completedAt === 'string' && [value.weightKg, value.reps, value.volumeKg].every((number) => Number.isFinite(Number(number)) && Number(number) >= 0);
    };
    if (typeof candidate.exerciseId !== 'string' || typeof candidate.exerciseName !== 'string' || typeof candidate.suggestion !== 'string' || typeof candidate.ruleVersion !== 'string' || !Number.isInteger(candidate.historyCount) || (candidate.historyCount as number) < 1 || !Number.isInteger(candidate.windowDays) || (candidate.windowDays as number) < 1 || !validRecord(latest) || (previous !== undefined && !validRecord(previous))) return [];
    return [{ exerciseId: candidate.exerciseId, exerciseName: candidate.exerciseName, latest, previous: previous as TrainingProgressionRecord | undefined, suggestion: candidate.suggestion, ruleVersion: candidate.ruleVersion, ...(typeof candidate.ruleActivatedAt === 'string' ? { ruleActivatedAt: candidate.ruleActivatedAt } : {}), ...(typeof candidate.ruleChangeNote === 'string' && candidate.ruleChangeNote.trim() ? { ruleChangeNote: candidate.ruleChangeNote } : {}), historyCount: candidate.historyCount as number, windowDays: candidate.windowDays as number }];
  });
  return { generatedAt: payload.generatedAt, exercises };
}

export async function searchExerciseCatalogPage(accessToken: string, query: string, cursor = '', signal?: AbortSignal, filters: ExerciseCatalogFilters = {}): Promise<ExerciseCatalogPage> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(`${baseUrl}/v1/training/exercises/search?query=${encodeURIComponent(query.trim())}&cursor=${encodeURIComponent(cursor)}` + (filters.category ? '&category=' + encodeURIComponent(filters.category) : '') + (filters.muscleGroup ? '&muscleGroup=' + encodeURIComponent(filters.muscleGroup) : '') + (filters.equipment?.length ? '&equipment=' + encodeURIComponent(filters.equipment[0]) : '') , { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }, signal });
  const payload = await response.json().catch(() => null) as { exercises?: unknown; nextCursor?: unknown; total?: unknown; facets?: unknown; source?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'EXERCISE_CATALOG_SEARCH_FAILED');
  if (!Array.isArray(payload?.exercises)) throw new Error('EXERCISE_CATALOG_RESPONSE_INVALID');
  const exercises = payload.exercises.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.muscleGroup !== 'string' || typeof candidate.equipment !== 'string') return [];
    const optionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
    const primaryMuscles = Array.isArray(candidate.primaryMuscles) ? candidate.primaryMuscles.flatMap((value) => { const text = optionalText(value); return text ? [text] : []; }).slice(0, 8) : undefined;
    const sourceUrl = typeof candidate.sourceUrl === 'string' && /^https?:\/\//i.test(candidate.sourceUrl.trim()) ? candidate.sourceUrl.trim().slice(0, 500) : undefined;
    return [{ id: candidate.id, name: candidate.name, muscleGroup: candidate.muscleGroup, equipment: candidate.equipment,
      ...(optionalText(candidate.category) ? { category: optionalText(candidate.category) } : {}),
      ...(primaryMuscles?.length ? { primaryMuscles } : {}),
      ...(optionalText(candidate.instructions) ? { instructions: optionalText(candidate.instructions) } : {}),
      ...(optionalText(candidate.sourceName) ? { sourceName: optionalText(candidate.sourceName) } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(optionalText(candidate.license) ? { license: optionalText(candidate.license) } : {}),
    }];
  });
  const facetList = (value: unknown) => Array.isArray(value) ? value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : []) : [];
  const facets = payload.facets && typeof payload.facets === 'object' ? payload.facets as Record<string, unknown> : null;
  return { exercises, nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null, ...(Number.isInteger(payload.total) && Number(payload.total) >= 0 ? { total: Number(payload.total) } : {}), ...(facets ? { facets: { categories: facetList(facets.categories), muscleGroups: facetList(facets.muscleGroups), equipment: facetList(facets.equipment) } } : {}), ...(typeof payload.source === 'string' ? { source: payload.source } : {}) };
}

export async function searchExerciseCatalog(accessToken: string, query: string, signal?: AbortSignal): Promise<ExerciseCatalogItem[]> {
  return (await searchExerciseCatalogPage(accessToken, query, '', signal)).exercises;
}
export async function getForgeSnapshot(accessToken: string, signal?: AbortSignal): Promise<CloudSnapshotResult> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('AUTH_SERVICE_UNCONFIGURED');
  if (!accessToken) throw new Error('AUTH_REQUIRED');
  const response = await fetch(`${baseUrl}/v1/sync/snapshot`, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }, signal });
  const payload = await response.json().catch(() => null) as { revision?: unknown; snapshot?: unknown; updatedAt?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || 'SYNC_READ_FAILED');
  const revision = payload && typeof payload.revision === 'number' && Number.isInteger(payload.revision) && payload.revision >= 0 ? payload.revision : null;
  const snapshot = payload?.snapshot === null ? null : payload?.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot as ForgeSnapshot : null;
  if (revision === null || (payload?.snapshot !== null && snapshot === null) || (payload?.updatedAt !== null && typeof payload?.updatedAt !== 'string')) throw new Error('SYNC_READ_RESPONSE_INVALID');
  return { revision, snapshot, updatedAt: payload.updatedAt as string | null };
}
