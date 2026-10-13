import Constants from 'expo-constants';
import type { CoachCommandDraft, CoachPlanDraft, DailyPlan, DailyNutrition, UserProfile } from '@/types/domain';

// Complex Coach requests include real training, nutrition and history context.
// Keep the client alive long enough for the provider to finish instead of
// converting a slow-but-valid response into a misleading connection error.
const DEFAULT_TIMEOUT_MS = 240_000;

type CoachAiConfig = {
  baseUrl: string;
  timeoutMs: number;
};

type CoachAiContext = {
  profile: UserProfile;
  dailyPlan: DailyPlan;
  nutrition: DailyNutrition;
  availableFoods: string[];
  todayEntries: string[];
  recentMealPlan: string;
  conversationSummary?: string;
};

export type CoachActionHint =
  | { type: 'none' }
  | { type: 'add_food'; foodName: string }
  | { type: 'apply_workout_insight'; exercise?: string }
  | { type: 'apply_plan'; plan: CoachPlanDraft }
  | { type: 'apply_commands'; commands: CoachCommandDraft[] };

export type CoachAiResult = { text: string; actionHint?: CoachActionHint; plan?: CoachPlanDraft; commands?: CoachCommandDraft[]; messageId?: string; createdAt?: string };
export type CoachRequestStatus = {
  requestId: string;
  status: 'pending' | 'completed' | 'failed';
  updatedAt: string;
  errorCode?: string;
  message?: { text: string; messageId?: string; createdAt?: string };
};

type CoachConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatCompletionResponse = {
  text?: string;
  actionHint?: CoachActionHint;
  messageId?: string;
  createdAt?: string;
  choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[];
};

const DEFAULT_FORGE_API_URL = 'https://forge.iamwudi.ltd';

function readEnv(name: string): string {
  return typeof process !== 'undefined' && process.env ? String(process.env[name as keyof NodeJS.ProcessEnv] ?? '').trim() : '';
}

function coachApiBaseUrl(): string {
  const configuredUrl = readEnv('EXPO_PUBLIC_FORGE_API_URL');
  const runtimeUrl = typeof Constants.expoConfig?.extra?.forgeApiUrl === 'string' ? Constants.expoConfig.extra.forgeApiUrl : '';
  return (configuredUrl || runtimeUrl || DEFAULT_FORGE_API_URL).trim().replace(/\/$/, '');
}

export function getCoachAiConfig(): CoachAiConfig | null {
  const baseUrl = coachApiBaseUrl();
  if (!baseUrl) return null;
  const configuredTimeout = Number.parseInt(readEnv('EXPO_PUBLIC_COACH_AI_TIMEOUT_MS'), 10);
  return {
    baseUrl,
    timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout >= 5_000 ? configuredTimeout : DEFAULT_TIMEOUT_MS,
  };
}

export function isCoachAiConfigured(): boolean {
  return Boolean(getCoachAiConfig());
}

function proxyUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/v1/coach/messages') ? normalized : `${normalized}/v1/coach/messages`;
}

export async function requestCoachStatus({ accessToken, requestId, signal }: { accessToken: string; requestId: string; signal?: AbortSignal }): Promise<CoachRequestStatus> {
  const config = getCoachAiConfig();
  if (!config) throw new Error('Coach AI proxy is not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  const abortRequest = () => controller.abort();
  signal?.addEventListener('abort', abortRequest, { once: true });
  try {
    const response = await fetch(proxyUrl(config.baseUrl) + '/../requests/' + encodeURIComponent(requestId), {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken },
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = JSON.parse(text) as { requestId?: unknown; status?: unknown; updatedAt?: unknown; errorCode?: unknown; message?: { text?: unknown; messageId?: unknown; createdAt?: unknown } };
    if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : 'Coach request status failed');
    if (typeof payload.requestId !== 'string' || typeof payload.updatedAt !== 'string' || (payload.status !== 'pending' && payload.status !== 'completed' && payload.status !== 'failed')) throw new Error('Coach request status is invalid');
    const message = payload.message && typeof payload.message.text === 'string' ? { text: payload.message.text, messageId: typeof payload.message.messageId === 'string' ? payload.message.messageId : undefined, createdAt: typeof payload.message.createdAt === 'string' ? payload.message.createdAt : undefined } : undefined;
    return { requestId: payload.requestId, status: payload.status, updatedAt: payload.updatedAt, errorCode: typeof payload.errorCode === 'string' ? payload.errorCode : undefined, message };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortRequest);
  }
}

async function recoverCoachRequest(requestId: string, accessToken: string, signal?: AbortSignal): Promise<CoachAiResult | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (signal?.aborted) return null;
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
    try {
      const status = await requestCoachStatus({ accessToken, requestId, signal });
      if (status.status === 'completed' && status.message?.text) {
        const parsed = parseStructuredResponse(status.message.text);
        return { ...parsed, messageId: status.message.messageId, createdAt: status.message.createdAt };
      }
      if (status.status === 'failed') return null;
    } catch {
      // A transient status lookup failure is retried without fabricating a Coach answer.
    }
  }
  return null;
}

export { recoverCoachRequest };

function contextPrompt(context: CoachAiContext): string {
  const { profile, dailyPlan, nutrition, availableFoods, todayEntries, recentMealPlan, conversationSummary } = context;
  return [
    `用户目标：${profile.goal.label}`,
    `今日训练：${dailyPlan.workout.title}；${dailyPlan.workout.focus}；${dailyPlan.workout.setCount} 组；约 ${dailyPlan.workout.estimatedMinutes} 分钟`,
    `今日状态：${dailyPlan.bodyState.readinessScore} 分（${dailyPlan.bodyState.readinessLabel}）；睡眠 ${dailyPlan.bodyState.sleep}；疲劳 ${dailyPlan.bodyState.fatigue}；酸痛 ${dailyPlan.bodyState.soreness}`,
    `今日营养目标：${nutrition.calories} kcal；蛋白质 ${nutrition.protein} g；碳水 ${nutrition.carbs} g；脂肪 ${nutrition.fat} g；已摄入 ${nutrition.consumedCalories} kcal`,
    `今日已记录饮食（已扣除到剩余营养）：${todayEntries.length ? todayEntries.join(', ') : '暂无'}`,
    `最近一次明确饮食计划（仅用于识别用户说吃完哪一餐）：${recentMealPlan || '暂无'}`,
    `当前食物池（名称；每100g营养；每次参考份量）：${availableFoods.length ? availableFoods.join(', ') : '暂未设置'}`,
  ].join('\n');
}

function extractContent(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => part.text ?? '').join('').trim();
  return '';
}

function parseCoachCommands(value: unknown): CoachCommandDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<CoachCommandDraft>((item): CoachCommandDraft[] => {
    if (!item || typeof item !== 'object') return [];
    const command = item as Record<string, unknown>;
    const commandType = typeof command.type === 'string' ? command.type : typeof command.command === 'string' ? command.command : typeof command.action === 'string' ? command.action : undefined;
    if (commandType === 'log_food' && Array.isArray(command.foods)) {
      const meal = command.meal === 'breakfast' || command.meal === 'lunch' || command.meal === 'dinner' || command.meal === 'snack' ? command.meal : undefined;
      return command.foods.flatMap((food): CoachCommandDraft[] => {
        if (!food || typeof food !== 'object') return [];
        const item = food as Record<string, unknown>;
        const foodName = typeof item.foodName === 'string' ? item.foodName.trim() : typeof item.name === 'string' ? item.name.trim() : '';
        const grams = Number(item.grams ?? item.servingGrams ?? item.portionGrams);
        const serving = typeof item.serving === 'string' && item.serving.trim() ? item.serving.trim() : Number.isFinite(grams) && grams > 0 ? Math.round(grams * 10) / 10 + ' g' : undefined;
        return foodName ? [{ type: 'log_food', foodName, serving, meal }] : [];
      });
    }
    if (commandType === 'log_food' && typeof command.foodName === 'string' && command.foodName.trim()) {
      const meal = command.meal === 'breakfast' || command.meal === 'lunch' || command.meal === 'dinner' || command.meal === 'snack' ? command.meal : undefined;
      const rawServing = typeof command.serving === 'string' ? command.serving.trim() : Number.isFinite(Number(command.serving)) ? Math.round(Number(command.serving) * 10) / 10 + ' g' : undefined;
      return [{ type: 'log_food', foodName: command.foodName.trim(), serving: rawServing, meal }];
    }
    if (commandType === 'adjust_workout') {
      const exerciseName = typeof command.exerciseName === 'string' ? command.exerciseName.trim() : '';
      const addSets = Number(command.addSets);
      const reps = Number(command.reps);
      const kg = Number(command.kg);
      if (!exerciseName || (![addSets, reps, kg].some(Number.isFinite))) return [];
      return [{ type: 'adjust_workout', exerciseName, ...(Number.isFinite(addSets) ? { addSets: Math.max(1, Math.min(4, Math.round(addSets))) } : {}), ...(Number.isFinite(reps) && reps >= 1 && reps <= 100 ? { reps: Math.round(reps) } : {}), ...(Number.isFinite(kg) && kg >= 0 && kg <= 500 ? { kg } : {}) }];
    }
    if (commandType === 'add_food') {
      const foodName = typeof command.foodName === 'string' ? command.foodName.trim() : '';
      const serving = '100 g';
      const caloriesPer100g = Number(command.caloriesPer100g ?? command.calories);
      const protein = Number(command.protein);
      const carbs = Number(command.carbs);
      const fat = Number(command.fat);
      const typicalServingGrams = Number(command.typicalServingGrams ?? command.portionGrams ?? command.defaultServingGrams);
      if (!foodName || !serving || [caloriesPer100g, protein, carbs, fat].some((value) => !Number.isFinite(value) || value < 0)) return [];
      const confidence = command.confidence === 'high' || command.confidence === 'medium' || command.confidence === 'low' ? command.confidence : undefined;
      const basis = typeof command.basis === 'string' && command.basis.trim() ? command.basis.trim().slice(0, 180) : undefined;
      return [{ type: 'add_food', foodName, serving, caloriesPer100g, protein, carbs, fat, ...(Number.isFinite(typicalServingGrams) && typicalServingGrams > 0 ? { typicalServingGrams: Math.round(typicalServingGrams * 10) / 10 } : {}), unit: typeof command.unit === 'string' && command.unit.trim() ? command.unit.trim().slice(0, 20) : undefined, basis, confidence }];
    }
    if (commandType === 'set_food_preference') {
      const foodName = typeof command.foodName === 'string' ? command.foodName.trim() : '';
      if (!foodName) return [];
      const rawPreference = typeof command.preference === 'string' ? command.preference : typeof command.action === 'string' ? command.action : 'available';
      const preference = rawPreference === 'preferred' || rawPreference === 'like' || rawPreference === '喜欢' ? 'preferred' : rawPreference === 'avoided' || rawPreference === 'avoid' || rawPreference === '避开' ? 'avoided' : rawPreference === 'unavailable' || rawPreference === 'remove' || rawPreference === '删除' ? 'unavailable' : 'available';
      return [{ type: 'set_food_preference', foodName, preference }];
    }
    if (commandType === 'complete_workout') return [{ type: 'complete_workout' }];
    if (commandType === 'set_weekly_workout_goal') {
      const count = Number(command.count);
      return Number.isFinite(count) ? [{ type: 'set_weekly_workout_goal', count }] : [];
    }
    if (commandType === 'set_training_preferences' && typeof command === 'object') {
      const trainingDays = Array.isArray(command.trainingDays) ? command.trainingDays.filter((day): day is number => Number.isFinite(Number(day))).map(Number) : undefined;
      const defaultRestSeconds = Number(command.defaultRestSeconds);
      const weightUnit = command.weightUnit === 'kg' || command.weightUnit === 'lb' ? command.weightUnit : undefined;
      if (!trainingDays && !Number.isFinite(defaultRestSeconds) && !weightUnit) return [];
      return [{ type: 'set_training_preferences', trainingDays, defaultRestSeconds: Number.isFinite(defaultRestSeconds) ? defaultRestSeconds : undefined, weightUnit }];
    }
    return [];
  });
}

function parseStructuredResponse(raw: string): CoachAiResult {
  const cleaned = raw.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as { reply?: unknown; plan?: unknown; commands?: unknown; actions?: unknown; action?: { type?: unknown; foodName?: unknown; exercise?: unknown } };
    if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) return { text: raw };
    const plan = parsed.plan && typeof parsed.plan === 'object' ? parsed.plan as CoachPlanDraft : undefined;
    const commands = parseCoachCommands(parsed.commands ?? parsed.actions);
    if (plan || commands.length) {
      const normalizedPlan = plan ? { ...plan, commands: [...(plan.commands ?? []), ...commands] } : undefined;
      return {
        text: parsed.reply.trim(),
        actionHint: normalizedPlan ? { type: 'apply_plan', plan: normalizedPlan } : { type: 'apply_commands', commands },
        plan: normalizedPlan,
        commands,
      };
    }
    const action = parsed.action;
    if (!action || action.type === 'none') return { text: parsed.reply.trim(), actionHint: { type: 'none' } };
    if (action.type === 'add_food' && typeof action.foodName === 'string' && action.foodName.trim()) return { text: parsed.reply.trim(), actionHint: { type: 'add_food', foodName: action.foodName.trim() } };
    if (action.type === 'apply_workout_insight') return { text: parsed.reply.trim(), actionHint: { type: 'apply_workout_insight', exercise: typeof action.exercise === 'string' ? action.exercise : undefined } };
  } catch {
    // Older or non-compliant responses are still valid conversational text.
  }
  return { text: raw };
}

async function readCoachStream(response: Response, onDelta?: (text: string) => void): Promise<CoachAiResult> {
  if (!response.body?.getReader) throw new Error('Coach AI stream is not supported on this device');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let result: CoachAiResult | null = null;
  while (true) {
    const next = await reader.read();
    buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const value = line.trim();
      if (!value.startsWith('data:')) continue;
      const raw = value.slice(5).trim();
      if (!raw) continue;
      const payload = JSON.parse(raw) as Record<string, unknown>;
      if (payload.type === 'error') throw new Error(typeof payload.message === 'string' ? payload.message : 'Coach AI stream failed');
      if (payload.type === 'delta' && typeof payload.text === 'string') {
        text += payload.text;
        onDelta?.(payload.text);
      }
      if (payload.type === 'done' && typeof payload.text === 'string') {
        result = { text: payload.text.trim(), messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined, createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : undefined };
      }
    }
    if (next.done) break;
  }
  if (result?.text) {
    const parsed = parseStructuredResponse(result.text);
    return { ...parsed, messageId: result.messageId, createdAt: result.createdAt };
  }
  if (text.trim()) return parseStructuredResponse(text.trim());
  throw new Error('Coach AI returned an empty answer');
}

export async function requestCoachAnswer({
  question,
  history,
  context,
  accessToken,
  signal,
  onDelta,
  requestId,
  conversationId,
  stream = true,
}: {
  question: string;
  history: CoachConversationMessage[];
  context: CoachAiContext;
  accessToken?: string;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  requestId?: string;
  conversationId?: string;
  stream?: boolean;
}): Promise<CoachAiResult> {
  const config = getCoachAiConfig();
  if (!config) throw new Error('Coach AI proxy is not configured');
  if (!accessToken) throw new Error('Coach AI requires an authenticated session');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const abortRequest = () => controller.abort();
  signal?.addEventListener('abort', abortRequest, { once: true });
  try {
    const response = await fetch(proxyUrl(config.baseUrl) + (stream ? '?stream=1' : ''), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + accessToken,
        ...(requestId ? { 'X-FORGE-Request-Id': requestId } : {}),
      },
      body: JSON.stringify({
        question,
        conversationId,
        history: history.slice(-8).map((item) => ({ ...item, content: item.content.slice(-2400) })),
        context: { ...context, prompt: contextPrompt(context) },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let errorCode = '';
      let errorMessage = '';
      try {
        const payload = JSON.parse(errorText) as { code?: unknown; message?: unknown };
        errorCode = typeof payload.code === 'string' ? payload.code : '';
        errorMessage = typeof payload.message === 'string' ? payload.message : '';
      } catch {
        // Keep the raw response fallback for non-JSON infrastructure errors.
      }
      const error = new Error(errorMessage || ('Coach AI request failed (' + response.status + '): ' + errorText.slice(0, 160)));
      Object.assign(error, { code: errorCode || ('HTTP_' + response.status) });
      throw error;
    }
    if (response.headers.get('content-type')?.includes('text/event-stream')) return await readCoachStream(response, onDelta);
    const payload = await response.json() as ChatCompletionResponse;
    if (typeof payload.text === 'string' && payload.text.trim()) {
      const parsed = parseStructuredResponse(payload.text.trim());
      return { ...parsed, messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined, createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : undefined };
    }
    const answer = extractContent(payload);
    if (!answer) throw new Error('Coach AI returned an empty answer');
    return parseStructuredResponse(answer);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortRequest);
  }
}
