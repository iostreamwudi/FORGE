import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { ForgeCard, ForgeStatusPill, ForgeText, colors, control, radius, spacing } from '@/design-system';
import { useForgeAppActions, useForgeAppState, type ApplyCoachPlanResult } from '@/state/ForgeAppContext';
import { clearCoachHistory, createCoachConversation, deleteCoachConversation, deleteCoachMessage, requestCoachConversations, requestCoachHistory, requestCoachProviderHealth, submitCoachFeedback, transcribeCoachVoice, updateCoachConversation, type CoachConversation, type CoachProviderHealth } from '@/data/authClient';
import { type CoachActionHint, isCoachAiConfigured, recoverCoachRequest, requestCoachAnswer } from './coachAi';
import type { CoachCommandDraft, CoachPlanDraft, MealType, StoredCoachMessage } from '@/types/domain';
import { getFoodPortionGrams } from '@/types/domain';
import { formatLocalizedDate, formatLocalizedDateTime } from '@/utils/date';

type FoodProposal = Extract<CoachCommandDraft, { type: 'add_food' }>;
type CoachAction = { label: string; route?: '/active-workout' | '/nutrition' | '/nutrition/foods' | '/progress' | '/coach-consent'; kind?: 'add-food' | 'confirm-food' | 'edit-food' | 'cancel-food' | 'apply-insight' | 'apply-meal' | 'retry' | 'cancel' | 'done'; foodId?: string; foodName?: string; foodDraft?: FoodProposal; mealPlan?: CoachPlanDraft['mealPlan']; exercise?: string; retryQuestion?: string };
type CoachPlan = { workoutTitle: string; workoutMeta: string; nutritionCalories: string; nutritionMeta: string; readiness: string; hasWorkout?: boolean; mealPlan?: { meal: string; foodName: string; serving: string }[] };
type ChatMessage = StoredCoachMessage & { action?: CoachAction; actions?: CoachAction[]; plan?: CoachPlan; foodProposal?: FoodProposal; dateDivider?: string; streaming?: boolean };
type FoodEditState = { messageId: string; name: string; serving: string; portion: string; calories: string; protein: string; carbs: string; fat: string; draft: FoodProposal };
type ReplyPhase = 'idle' | 'sending' | 'recovering';

const suggestedPrompts = ['我今天该怎么安排训练？', '我今天该怎么安排饮食？', '帮我解释今天的训练计划'];

function coachDateKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}
function coachStorageKey(profileId: string) {
  return 'forge.coach.activeConversation.' + profileId;
}

export function CoachHomeScreen() {
  const appState = useForgeAppState();
  const actions = useForgeAppActions();
  const setCoachMessages = actions.setCoachMessages;
  const [providerHealth, setProviderHealth] = useState<'checking' | 'ready' | 'unconfigured' | 'degraded' | 'unavailable'>('checking');
  const [providerDetails, setProviderDetails] = useState<CoachProviderHealth | null>(null);
  const aiConfigured = providerHealth === 'ready' && Boolean(appState.authSession) && appState.profile.coachDataConsent === true;
  const aiNeedsConsent = providerHealth === 'ready' && Boolean(appState.authSession) && appState.profile.coachDataConsent !== true;
  const effectiveProviderHealth = !appState.authSession ? 'unconfigured' : providerHealth;
  const providerStatusBaseLabel = effectiveProviderHealth === 'checking' ? '检查 AI 服务' : effectiveProviderHealth === 'ready' ? 'AI 已连接' : effectiveProviderHealth === 'unconfigured' ? 'AI 未配置' : effectiveProviderHealth === 'degraded' ? 'AI 服务异常' : 'AI 服务不可用';
  const providerDisplayModel = providerDetails?.model === 'ark-code-latest' ? 'Auto' : providerDetails?.model ?? 'provider';
  const providerStatusLabel = providerDetails && effectiveProviderHealth !== 'unconfigured'
    ? `${providerStatusBaseLabel} · ${providerDisplayModel}${providerDetails.latencyMs ? ` · ${providerDetails.latencyMs}ms` : ''}`
    : providerStatusBaseLabel;
  const hasCoachContext = Boolean(appState.dailyPlan.workout.id || appState.dailyPlan.bodyState.quality !== 'unknown' || appState.nutrition.calories > 0 || appState.profile.goal.label !== '未设置');
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<FlatList<ChatMessage>>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollPendingRef = useRef(false);
  const atBottomRef = useRef(true);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyController = useRef<AbortController | null>(null);
  const recoveryController = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const requestPrefix = useRef('coach-session');
  const pendingFoodProposalRef = useRef<{ messageId: string; proposal: FoodProposal } | null>(null);
  useEffect(() => {
    requestPrefix.current = 'coach-' + String(Date.now()) + '-' + String(Math.random()).slice(2);
  }, []);
  const checkProviderHealth = useCallback((signal?: AbortSignal) => {
    const accessToken = appState.authSession?.accessToken;
    if (!accessToken) {
      setProviderHealth('unconfigured');
      setProviderDetails(null);
      return Promise.resolve();
    }
    setProviderHealth('checking');
    return requestCoachProviderHealth(accessToken, signal).then((result) => {
      if (signal?.aborted) return;
      setProviderHealth(result.status);
      setProviderDetails(result);
    }).catch((error: unknown) => {
      if (signal?.aborted) return;
      setProviderHealth('unavailable');
      setProviderDetails({ status: 'unavailable', checkedAt: new Date().toISOString(), model: null, message: error instanceof Error ? error.message : '无法读取 AI 服务状态。' });
    });
  }, [appState.authSession?.accessToken]);

  useEffect(() => {
    if (!appState.authSession?.accessToken) {
      setProviderHealth('unconfigured');
      setProviderDetails(null);
      return;
    }
    const controller = new AbortController();
    void checkProviderHealth(controller.signal);
    return () => controller.abort();
  }, [appState.authSession?.accessToken, checkProviderHealth]);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [draft, setDraft] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(true);
  const [hasNewReply, setHasNewReply] = useState(false);
  const [replyPhase, setReplyPhase] = useState<ReplyPhase>('idle');
  const isReplying = replyPhase !== 'idle';
  const isRecovering = replyPhase === 'recovering';
  const [inputFocused, setInputFocused] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationPickerOpen, setConversationPickerOpen] = useState(false);
  const [conversationActionBusy, setConversationActionBusy] = useState(false);
  const [renameConversationId, setRenameConversationId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [conversationDeleteTarget, setConversationDeleteTarget] = useState<CoachConversation | null>(null);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [deleteMessageId, setDeleteMessageId] = useState<string | null>(null);
  const [foodEdit, setFoodEdit] = useState<FoodEditState | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'recording' | 'transcribing' | 'error'>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [{ id: 'welcome', role: 'coach', text: '你好，' + (appState.profile.name || '训练者') + '。今天想先聊训练、状态，还是饮食？', detail: hasCoachContext ? '我会结合你已授权的目标、近期训练、今日状态和饮食记录来回答。' : '填写目标、创建训练计划或记录饮食后，Coach 才有真实上下文可参考。', createdAt: new Date().toISOString() }]);

  const scrollToLatest = useCallback((animated = true) => {
    setShowScrollToBottom(false);
    setHasNewReply(false);
    atBottomRef.current = true;
    scrollPendingRef.current = true;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    let attempts = 0;
    const run = () => {
      if (!scrollPendingRef.current) return;
      attempts += 1;
      scrollRef.current?.scrollToEnd({ animated: animated && attempts === 1 });
      if (attempts < 8) {
        scrollTimer.current = setTimeout(run, 80);
      } else {
        scrollTimer.current = null;
        scrollPendingRef.current = false;
      }
    };
    scrollTimer.current = setTimeout(run, 0);
  }, []);

  const handleContentSizeChange = useCallback(() => {
    if (scrollPendingRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const atBottom = distanceFromBottom <= 120;
    atBottomRef.current = atBottom;
    setShowScrollToBottom(!atBottom);
    if (atBottom) setHasNewReply(false);
  }, []);

  const handleScrollBeginDrag = useCallback(() => {
    setShowScrollToBottom(true);
  }, []);

  const keepReadingPosition = useCallback((animated = true) => {
    if (atBottomRef.current) scrollToLatest(animated);
    else setShowScrollToBottom(true);
  }, [scrollToLatest]);

  useEffect(() => () => {
    if (replyTimer.current) clearTimeout(replyTimer.current);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollPendingRef.current = false;
    replyController.current?.abort();
    recoveryController.current?.abort();
  }, []);

  const loadConversations = useCallback(async () => {
    const accessToken = appState.authSession?.accessToken;
    const profileId = appState.profile.id;
    if (!accessToken || appState.profile.coachDataConsent !== true || !isCoachAiConfigured() || !profileId) {
      setConversations([]);
      setActiveConversationId(null);
      return;
    }
    setConversationActionBusy(true);
    try {
      const result = await requestCoachConversations(accessToken);
      let next = result.conversations;
      const today = coachDateKey();
      let selectedId: string | null = null;
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        const storedId = localStorage.getItem(coachStorageKey(profileId));
        const storedConversation = storedId ? next.find((item) => item.id === storedId) : undefined;
        if (storedConversation?.dateKey === today) selectedId = storedConversation.id;
      }
      if (!selectedId) selectedId = next.find((item) => item.dateKey === today)?.id ?? null;
      if (!selectedId) {
        const created = await createCoachConversation(accessToken, { dateKey: today, title: '今天的教练' });
        next = [created, ...next];
        selectedId = created.id;
      }
      setConversations(next);
      setActiveConversationId(selectedId);
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(coachStorageKey(profileId), selectedId);
    } catch {
      setConversations([]);
      setActiveConversationId(null);
      actions.showToast('Coach 会话列表加载失败，请重试');
    } finally {
      setConversationActionBusy(false);
    }
  }, [actions, appState.authSession?.accessToken, appState.profile.coachDataConsent, appState.profile.id]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const selectConversation = useCallback((conversation: CoachConversation) => {
    setActiveConversationId(conversation.id);
    setConversationPickerOpen(false);
    setHistoryCursor(null);
    setHistoryQuery('');
    setSearchDraft('');
    setMessages([{ id: 'welcome', role: 'coach', text: '已切换到“' + conversation.title + '”。你可以继续这次对话。', createdAt: new Date().toISOString() }]);
    pendingFoodProposalRef.current = null;
    const profileId = appState.profile.id;
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined' && profileId) localStorage.setItem(coachStorageKey(profileId), conversation.id);
  }, [appState.profile.id]);

  const createNewConversation = useCallback(async () => {
    const accessToken = appState.authSession?.accessToken;
    if (!accessToken) return;
    setConversationActionBusy(true);
    try {
      const created = await createCoachConversation(accessToken, { dateKey: coachDateKey(), title: '新对话' });
      setConversations((current) => [created, ...current]);
      selectConversation(created);
      actions.showToast('已创建新的 Coach 对话');
    } catch {
      actions.showToast('新建 Coach 对话失败，请重试');
    } finally {
      setConversationActionBusy(false);
    }
  }, [actions, appState.authSession?.accessToken, selectConversation]);

  const beginRenameConversation = useCallback((conversation: CoachConversation) => {
    setRenameConversationId(conversation.id);
    setRenameDraft(conversation.title);
  }, []);

  const saveConversationRename = useCallback(async () => {
    const accessToken = appState.authSession?.accessToken;
    const id = renameConversationId;
    const title = renameDraft.trim();
    if (!accessToken || !id || !title || conversationActionBusy) return;
    setConversationActionBusy(true);
    try {
      await updateCoachConversation(accessToken, id, { title });
      setConversations((current) => current.map((item) => item.id === id ? { ...item, title } : item));
      setRenameConversationId(null);
      setRenameDraft('');
    } catch {
      actions.showToast('会话重命名失败，请重试');
    } finally {
      setConversationActionBusy(false);
    }
  }, [actions, appState.authSession?.accessToken, conversationActionBusy, renameConversationId, renameDraft]);

  const archiveConversation = useCallback(async (conversation: CoachConversation) => {
    const accessToken = appState.authSession?.accessToken;
    if (!accessToken || conversationActionBusy) return;
    setConversationActionBusy(true);
    try {
      await updateCoachConversation(accessToken, conversation.id, { archived: true });
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      if (activeConversationId === conversation.id) {
        if (remaining[0]) selectConversation(remaining[0]);
        else await createNewConversation();
      }
      actions.showToast('会话已归档');
    } catch {
      actions.showToast('会话归档失败，请重试');
    } finally {
      setConversationActionBusy(false);
    }
  }, [actions, activeConversationId, conversationActionBusy, conversations, createNewConversation, selectConversation]);

  const removeConversation = useCallback(async (conversation: CoachConversation) => {
    const accessToken = appState.authSession?.accessToken;
    if (!accessToken || conversationActionBusy) return;
    setConversationActionBusy(true);
    try {
      await deleteCoachConversation(accessToken, conversation.id);
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      if (activeConversationId === conversation.id) {
        if (remaining[0]) selectConversation(remaining[0]);
        else await createNewConversation();
      }
      actions.showToast('会话及其消息已删除');
    } catch {
      actions.showToast('会话删除失败，请重试');
    } finally {
      setConversationActionBusy(false);
    }
  }, [actions, activeConversationId, conversationActionBusy, conversations, createNewConversation, selectConversation]);

  const loadHistory = useCallback((cursor?: string) => {
    const accessToken = appState.authSession?.accessToken;
    if (!accessToken || !activeConversationId || appState.profile.coachDataConsent !== true || !isCoachAiConfigured()) return;
    let active = true;
    setHistoryStatus('loading');
    void requestCoachHistory(accessToken, { conversationId: activeConversationId, cursor, limit: 100, query: historyQuery }).then((result) => {
      if (!active) return;
      const remoteMessages: ChatMessage[] = result.messages.map((message, index) => {
        const adjacentUserQuestion = message.role === 'assistant'
          ? (message.sourceQuestion ?? (result.messages[index - 1]?.role === 'user' ? result.messages[index - 1].text : result.messages[index + 1]?.role === 'user' ? result.messages[index + 1].text : undefined))
          : undefined;
        const recoveredFoodProposal = message.role === 'assistant' ? recoverPendingFoodProposal(adjacentUserQuestion, message.text) : null;
        const alreadyConfirmed = /(?:已确认|已加入食物池|已经加入食物池|写入你的账户食物池)/u.test(message.text);
        return {
          id: message.id,
          role: message.role === 'assistant' ? 'coach' : 'user',
          text: message.text,
          sourceQuestion: adjacentUserQuestion,
          feedback: message.feedback,
          createdAt: message.createdAt,
          ...(recoveredFoodProposal && !alreadyConfirmed ? { foodProposal: recoveredFoodProposal, actions: foodProposalActions(recoveredFoodProposal) } : {}),
        };
      });
      setMessages((current) => {
        let nextMessages: ChatMessage[];
        if (cursor) {
          const existing = new Set(current.map((message) => message.id));
          nextMessages = [...current, ...remoteMessages.filter((message) => !existing.has(message.id))];
        } else {
          const welcome = current.find((message) => message.id === 'welcome');
          const local = current.filter((message) => message.id !== 'welcome' && !remoteMessages.some((remote) => remote.id === message.id));
          nextMessages = [welcome ?? { id: 'welcome', role: 'coach', text: '你好。今天想先聊训练、状态，还是饮食？', createdAt: new Date().toISOString() }, ...remoteMessages, ...local].slice(-101);
        }
        const activePending = findActivePendingFoodProposal(nextMessages);
        pendingFoodProposalRef.current = activePending;
        return nextMessages;
      });
      setHistoryCursor(result.nextCursor);
      setHistoryStatus('ready');
    }).catch(() => { if (active) setHistoryStatus('error'); });
    return () => { active = false; };
  }, [activeConversationId, appState.authSession?.accessToken, appState.profile.coachDataConsent, historyQuery]);

  useEffect(() => {
    const timer = setTimeout(() => { void loadHistory(); }, 0);
    return () => clearTimeout(timer);
  }, [loadHistory]);

  const runHistorySearch = () => {
    setHistoryQuery(searchDraft.trim());
    setHistoryCursor(null);
  };

  const requestDeleteMessage = (messageId: string) => {
    setDeleteMessageId(messageId);
  };

  const confirmDeleteMessage = () => {
    const accessToken = appState.authSession?.accessToken;
    const targetId = deleteMessageId;
    const target = targetId ? messages.find((message) => message.id === targetId) : undefined;
    if (!accessToken || !targetId || !target || historyStatus === 'loading') return;
    setHistoryStatus('loading');
    void deleteCoachMessage(accessToken, targetId).then(() => {
      setMessages((current) => current.filter((message) => message.id !== targetId && !(target.role === 'coach' && message.role === 'user' && target.sourceQuestion && message.text === target.sourceQuestion && message.createdAt === target.createdAt)));
      setDeleteMessageId(null);
      setHistoryStatus('ready');
      actions.showToast('这条 Coach 对话已删除');
    }).catch(() => {
      setHistoryStatus('error');
      actions.showToast('Coach 对话删除失败，请重试');
    });
  };

  const confirmClearHistory = () => {
    const accessToken = appState.authSession?.accessToken;
    if (!accessToken || historyStatus === 'loading') return;
    setHistoryStatus('loading');
    void clearCoachHistory(accessToken).then(() => {
      setMessages((current) => current.filter((message) => message.id === 'welcome'));
      setHistoryCursor(null);
      setHistoryQuery('');
      setSearchDraft('');
      setClearHistoryOpen(false);
      setHistoryStatus('ready');
      actions.showToast('Coach 历史已清除');
    }).catch(() => {
      setHistoryStatus('error');
      actions.showToast('Coach 历史清除失败，请重试');
    });
  };

  useEffect(() => {
    const persisted = messages.filter((message) => message.id !== 'welcome' && !message.streaming).map((message) => ({ id: message.id, role: message.role, text: message.text, detail: message.detail, sourceQuestion: message.sourceQuestion, error: message.error, feedback: message.feedback, createdAt: message.createdAt || new Date().toISOString() }));
    setCoachMessages(persisted);
  }, [messages, setCoachMessages]);

  const effectiveMessages = messages;
  const displayMessages = effectiveMessages.map((message, index, list) => { const date = formatChatDate(message.createdAt); const previousDate = formatChatDate(list[index - 1]?.createdAt); return { ...message, dateDivider: date && (index === 0 || date !== previousDate) ? date : undefined }; });

  const applyCoachResult = (result: { plan?: CoachPlanDraft; commands?: CoachCommandDraft[] }, sourceQuestion?: string): ApplyCoachPlanResult | null => {
    const isFoodPoolRequest = Boolean(sourceQuestion?.includes('食物池') && /(加入|添加|放入)/u.test(sourceQuestion));
    if (isFoodPoolRequest) return null;
    const allCommands = [...(result.plan?.commands ?? []), ...(result.commands ?? [])];
    const safeCommands = allCommands.filter((command) => command.type !== 'add_food');
    const uniqueCommands = safeCommands.filter((command, index, list) => list.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(command)) === index);
    if (hasExecutableCoachPlan(result.plan) || uniqueCommands.length) return actions.applyCoachPlan({ ...(result.plan ?? {}), commands: uniqueCommands });
    return null;
  };

  const confirmFoodProposal = (messageId: string, foodDraft: FoodProposal): ApplyCoachPlanResult | null => {
    const portion = Number(foodDraft.typicalServingGrams);
    if (!Number.isFinite(portion) || portion <= 0) {
      setFoodEdit({ messageId, draft: foodDraft, name: foodDraft.foodName, serving: '100 g', portion: '', calories: String(foodDraft.caloriesPer100g), protein: String(foodDraft.protein), carbs: String(foodDraft.carbs), fat: String(foodDraft.fat) });
      actions.showToast('请先确认每次参考份量，再加入食物池');
      return null;
    }
    const result = actions.applyCoachPlan({ commands: [foodDraft] });
    if (!result.changed) {
      actions.showToast('食物没有写入食物池：' + (result.results[0]?.reason || '请检查分析数据。'));
      return result;
    }
    actions.showToast(foodDraft.foodName + '已加入食物池');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, detail: '已确认并写入你的账户食物池，正在同步云端。', actions: (message.actions ?? []).map((item) => item.kind === 'confirm-food' ? { ...item, label: '已加入食物池', kind: 'done' } : item) } : message));
    return result;
  };

  const appendFoodConfirmation = (question: string, pending: { messageId: string; proposal: FoodProposal }) => {
    const result = confirmFoodProposal(pending.messageId, pending.proposal);
    if (result) pendingFoodProposalRef.current = null;
    const now = new Date().toISOString();
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', text: question, createdAt: now };
    const assistantMessage: ChatMessage = result?.changed
      ? { id: `coach-food-confirmed-${Date.now()}`, role: 'coach', sourceQuestion: question, text: `已确认，${pending.proposal.foodName}已加入你的食物池。`, detail: `已保存每100g营养基准和每次参考份量${pending.proposal.typicalServingGrams}g，正在同步云端。`, createdAt: now }
      : { id: `coach-food-confirmation-${Date.now()}`, role: 'coach', sourceQuestion: question, text: result ? `这次没有加入${pending.proposal.foodName}。` : '还需要确认每次参考份量后才能加入食物池。', detail: result ? (result.results.map((item) => item.reason || item.detail).filter(Boolean).join('；') || '请修改分析结果后重试。') : '请在弹出的分析编辑框中补充每次参考份量，然后点击确认加入食物池。', createdAt: now };
    setMessages((current) => [...current, userMessage, assistantMessage]);
  };

  const sendMessage = (value = draft, replaceMessageId?: string, appendUser = true) => {
    const question = value.trim();
    if (!question || isReplying) return;
    const statePatch = parseMorningState(question, appState);
    if (statePatch) actions.updateDailyState(statePatch);
    if (appendUser) setDraft('');
    const pendingFoodConfirmation = isFoodConfirmationQuestion(question) ? (pendingFoodProposalRef.current ?? findPendingFoodProposal(effectiveMessages)) : null;
    if (pendingFoodConfirmation) {
      appendFoodConfirmation(question, pendingFoodConfirmation);
      keepReadingPosition(true);
      return;
    }
    if (isFoodConfirmationQuestion(question)) {
      const now = new Date().toISOString();
      setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user' as const, text: question, createdAt: now }, { id: `coach-food-confirmation-${Date.now()}`, role: 'coach' as const, text: '当前没有找到待确认的食物分析。请先告诉我“把某种食物加入食物池”，等我展示每100g营养分析后再确认。', detail: '为了避免误写数据，本次没有调用模型或修改食物池。', createdAt: now }]);
      keepReadingPosition(true);
      return;
    }
    requestSequence.current += 1;
    const requestId = requestPrefix.current + '-' + requestSequence.current;
    const isFoodPoolRequest = question.includes('食物池') && /(加入|添加|放入)/u.test(question);
    const history = effectiveMessages.filter((message) => message.id !== replaceMessageId && !message.error && (message.role !== 'user' || message.text.trim())).filter((message) => !isFoodPoolRequest || (!message.text.includes('食物池') && !message.sourceQuestion?.includes('食物池'))).map((message) => ({ role: message.role === 'coach' ? 'assistant' as const : 'user' as const, content: message.text }));
    setMessages(() => [...effectiveMessages.filter((message) => message.id !== replaceMessageId), ...(appendUser ? [{ id: `user-${Date.now()}`, role: 'user' as const, text: question, createdAt: new Date().toISOString() }] : [])]);
    keepReadingPosition(false);
    if (aiNeedsConsent) { setMessages((current) => [...current, { id: `coach-consent-${Date.now()}`, role: 'coach' as const, text: '发送前需要你的数据授权。', createdAt: new Date().toISOString(), detail: 'Coach 只有在你明确允许后，才会把训练、状态和饮食上下文发送到 FORGE 服务端。', actions: [{ label: '管理数据授权', route: '/coach-consent' }] }]); return; }
    setReplyPhase('sending');
    const controller = new AbortController();
    replyController.current = controller;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const finish = () => {
      setReplyPhase('idle');
      if (replyController.current === controller) replyController.current = null;
    };
    void requestCoachAnswer({
      question,
      history,
      context: {
        profile: appState.profile,
        dailyPlan: projectedDailyPlan(appState.dailyPlan, statePatch),
        nutrition: appState.nutrition,
        availableFoods: appState.foods.filter((food) => food.available && !food.avoided).map((food) => food.name + '（每次参考 ' + getFoodPortionGrams(food) + 'g；每100g ' + food.caloriesPer100g + ' kcal，P ' + food.protein + 'g，C ' + food.carbs + 'g，F ' + food.fat + 'g）'),
        todayEntries: appState.foodEntries.filter((entry) => { const timestamp = entry.consumedAt || entry.createdAt; return Boolean(timestamp) && new Date(timestamp as string).toDateString() === new Date().toDateString(); }).map((entry) => { const mealLabel = entry.meal === 'breakfast' ? '早餐' : entry.meal === 'lunch' ? '午餐' : entry.meal === 'dinner' ? '晚餐' : entry.meal === 'snack' ? '加餐' : '未分类'; return mealLabel + '：' + entry.name + ' ' + entry.serving; }),
        recentMealPlan: [...effectiveMessages].reverse().find((message) => message.role === 'coach' && message.text.includes('早餐') && (message.text.includes('午餐') || message.text.includes('晚餐')))?.text.slice(0, 1800) ?? '',
        conversationSummary: conversations.find((item) => item.id === activeConversationId)?.summary || '',
      },
      accessToken: appState.authSession?.accessToken,
      conversationId: activeConversationId ?? undefined,
      requestId,
      stream: true,
      signal: controller.signal,
    }).then((result) => {
      const textMealPlan = result.commands?.length || hasExecutableCoachPlan(result.plan) ? null : parseMealPlanFromText(question, result.text, appState.foods);
      const explicitCommands = textMealPlan || result.commands?.length || hasExecutableCoachPlan(result.plan) ? [] : parseExplicitCoachCommand(question);
      const effectiveResult = textMealPlan
        ? { ...result, plan: textMealPlan, actionHint: { type: 'apply_plan' as const, plan: textMealPlan } }
        : explicitCommands.length
          ? { ...result, commands: explicitCommands, actionHint: { type: 'apply_commands' as const, commands: explicitCommands } }
          : result;
      const execution = applyCoachResult(effectiveResult, question);
        const answer = createAnswer(appState, effectiveResult.text, effectiveResult.actionHint, effectiveResult.plan, effectiveResult.commands, question, execution);
        const assistantId = result.messageId ?? ('coach-' + Date.now());
        if (answer.foodProposal && answer.actions?.some((item) => item.kind === 'confirm-food')) pendingFoodProposalRef.current = { messageId: assistantId, proposal: answer.foodProposal };
        setMessages((current) => [...current.filter((message) => message.id !== 'coach-streaming'), { id: assistantId, role: 'coach', sourceQuestion: question, createdAt: result.createdAt ?? new Date().toISOString(), ...answer }]);
      keepReadingPosition(true);
      if (!atBottomRef.current) setHasNewReply(true);
      finish();

    }).catch(async (error: unknown) => {
      if (controller.signal.aborted && replyController.current !== controller) return;
      const recovery = new AbortController();
      recoveryController.current = recovery;
      setReplyPhase('recovering');
      const recovered = appState.authSession?.accessToken ? await recoverCoachRequest(requestId, appState.authSession.accessToken, recovery.signal) : null;
      setReplyPhase('idle');
      if (recoveryController.current === recovery) recoveryController.current = null;
      if (recovered) {
        const textMealPlan = recovered.commands?.length || hasExecutableCoachPlan(recovered.plan) ? null : parseMealPlanFromText(question, recovered.text, appState.foods);
        const explicitCommands = textMealPlan || recovered.commands?.length || hasExecutableCoachPlan(recovered.plan) ? [] : parseExplicitCoachCommand(question);
        const effectiveRecovered = textMealPlan
          ? { ...recovered, plan: textMealPlan, actionHint: { type: 'apply_plan' as const, plan: textMealPlan } }
          : explicitCommands.length
            ? { ...recovered, commands: explicitCommands, actionHint: { type: 'apply_commands' as const, commands: explicitCommands } }
            : recovered;
        const execution = applyCoachResult(effectiveRecovered, question);
        const answer = createAnswer(appState, effectiveRecovered.text, effectiveRecovered.actionHint, effectiveRecovered.plan, effectiveRecovered.commands, question, execution);
        const assistantId = recovered.messageId ?? ('coach-' + Date.now());
        if (answer.foodProposal && answer.actions?.some((item) => item.kind === 'confirm-food')) pendingFoodProposalRef.current = { messageId: assistantId, proposal: answer.foodProposal };
        actions.showToast('已恢复 Coach 回答');
        setMessages((current) => [...current.filter((message) => message.id !== 'coach-streaming'), { id: assistantId, role: 'coach' as const, sourceQuestion: question, createdAt: recovered.createdAt ?? new Date().toISOString(), ...answer, detail: '已从服务端恢复这次真实回答。' }]);
        keepReadingPosition(true);
        if (!atBottomRef.current) setHasNewReply(true);
        finish();
        return;
      }
      finish();
      const localCommands = parseExplicitCoachCommand(question);
      if (localCommands.length) {
        const effectiveLocal = { text: '模型响应超时，FORGE 正在按你的明确训练指令校验并写入真实训练计划。', commands: localCommands, actionHint: { type: 'apply_commands' as const, commands: localCommands } };
        const execution = applyCoachResult(effectiveLocal, question);
        const answer = createAnswer(appState, effectiveLocal.text, effectiveLocal.actionHint, undefined, effectiveLocal.commands, question, execution);
        setMessages((current) => [...current.filter((message) => message.id !== 'coach-streaming'), { id: 'coach-local-command-' + Date.now(), role: 'coach' as const, sourceQuestion: question, createdAt: new Date().toISOString(), ...answer, detail: execution?.changed ? '已按你的明确指令写入训练计划，正在同步云端。' : '模型请求超时；没有找到可修改的训练动作，本次没有写入。' }]);
        actions.showToast(execution?.changed ? '训练计划已更新' : '训练计划未修改');
        keepReadingPosition(true);
        if (!atBottomRef.current) setHasNewReply(true);
        return;
      }
      const localMealPlan = buildLocalMealPlan(question, appState.foods, appState.nutrition);
      if (localMealPlan) {
        const fallbackText = '模型响应超时，FORGE 已根据你账户食物池中的真实营养数据生成一份待确认的逐餐方案。请检查后点击“应用饮食方案”，确认后才会写入系统。';
        const fallbackAnswer = createAnswer(appState, fallbackText, { type: 'apply_plan', plan: localMealPlan }, localMealPlan, undefined, question, null);
        setMessages((current) => [...current.filter((message) => message.id !== 'coach-streaming'), { id: 'coach-local-meal-plan-' + Date.now(), role: 'coach' as const, sourceQuestion: question, createdAt: new Date().toISOString(), ...fallbackAnswer, detail: '模型请求超时；方案仅使用当前食物池的真实营养数据，尚未写入。' }]);
        actions.showToast('已生成待确认的真实食物池方案');
        keepReadingPosition(true);
        if (!atBottomRef.current) setHasNewReply(true);
        return;
      }
      const reason = error instanceof Error && error.name === 'AbortError' ? '请求超时，已尝试恢复；请检查网络后重试。' : '暂时没有拿到回答，已确认服务端没有可恢复结果。';
      setMessages((current) => [...current.filter((message) => message.id !== 'coach-streaming'), { id: 'coach-error-' + Date.now(), role: 'coach', text: '这次没有成功连接到 FORGE。', createdAt: new Date().toISOString(), detail: reason, error: true, actions: [{ label: '重试', kind: 'retry', retryQuestion: question }, { label: '取消', kind: 'cancel' }] }]);
      keepReadingPosition(true);
      if (!atBottomRef.current) setHasNewReply(true);
    });
  };

  const cancelReply = () => {
    replyController.current?.abort();
    recoveryController.current?.abort();
    setReplyPhase('idle');
    if (replyTimer.current) clearTimeout(replyTimer.current);
    replyTimer.current = null;
    replyController.current = null;
    setReplyPhase('idle');
    setMessages((current) => [...current.filter((message) => message.id !== 'coach-streaming'), { id: `coach-cancelled-${Date.now()}`, role: 'coach', text: '已取消这次请求。', detail: '你可以继续输入新的问题。' }]);
  };

  const openVoiceMode = async () => {
    if (isReplying) return;
    if (Platform.OS === 'web') {
      actions.showToast('Web 暂不支持语音记录，请使用 FORGE App 或 Dev Client。');
      return;
    }
    setVoiceError('');
    setVoiceOpen(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setVoiceStatus('error');
        setVoiceError('没有获得麦克风权限。请在系统设置中允许后重试。');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setVoiceStatus('recording');
    } catch {
      setVoiceStatus('error');
      setVoiceError('录音启动失败，请检查麦克风权限后重试。');
    }
  };

  const stopVoiceMode = async () => {
    if (voiceStatus !== 'recording') return;
    setVoiceStatus('transcribing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('AUDIO_REQUIRED');
      const text = await transcribeCoachVoice(appState.authSession?.accessToken ?? '', uri);
      setDraft((current) => current.trim() ? current.trim() + ' ' + text : text);
      setVoiceOpen(false);
      setVoiceStatus('idle');
      actions.showToast('已将真实语音转写到输入框，请确认后发送');
    } catch (error: unknown) {
      setVoiceStatus('error');
      setVoiceError(error instanceof Error && error.message.includes('尚未配置') ? error.message : '语音转写失败，原录音没有被当作文字发送，请重试。');
    } finally {
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    }
  };

  const cancelVoiceMode = () => {
    if (recorderState.isRecording) void recorder.stop().catch(() => undefined);
    setVoiceOpen(false);
    setVoiceStatus('idle');
    setVoiceError('');
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  };

  const handleAction = (messageId: string, action: CoachAction) => {
    if (action.kind === 'retry' && action.retryQuestion) {
      sendMessage(action.retryQuestion, messageId);
      return;
    }
    if (action.kind === 'cancel') {
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, actions: [], detail: `${message.detail ?? ''}${message.detail ? ' ' : ''}已取消，可重新发送。` } : message));
      return;
    }
    if (action.kind === 'apply-insight') {
      const result = actions.applyCoachInsight(action.exercise);
      if (!result.changed) {
        actions.showToast('训练建议没有成功写入训练计划，请重新生成更具体的建议。');
        return;
      }
      actions.showToast('训练建议已写入今日训练计划');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, detail: result.results.map((item) => item.detail || item.reason).filter(Boolean).join('；'), actions: (message.actions ?? []).map((item) => item === action ? { ...item, label: '已应用到今日训练', kind: 'done' } : item) } : message));
      return;
    }
    if (action.kind === 'apply-meal') {
      const result = actions.applyMealPlan(action.mealPlan);
      if (!result.changed) {
        actions.showToast('饮食方案没有成功写入，请确认方案中的食物都在食物池。');
        return;
      }
      actions.showToast('逐餐饮食方案已写入系统');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, detail: '已写入逐餐饮食计划，今日饮食模块会实时更新。', actions: (message.actions ?? []).map((item) => item === action ? { ...item, label: '已采用饮食方案', kind: 'done' } : item) } : message));
      return;
    }
    if (action.kind === 'confirm-food' && action.foodDraft) {
      confirmFoodProposal(messageId, action.foodDraft);
      return;
    }
    if (action.kind === 'edit-food' && action.foodDraft) {
      setFoodEdit({ messageId, draft: action.foodDraft, name: action.foodDraft.foodName, serving: '100 g', portion: String(action.foodDraft.typicalServingGrams ?? 100), calories: String(action.foodDraft.caloriesPer100g), protein: String(action.foodDraft.protein), carbs: String(action.foodDraft.carbs), fat: String(action.foodDraft.fat) });
      return;
    }
    if (action.kind === 'cancel-food') {
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, detail: '已取消，这个食物还没有写入食物池。', actions: [] } : message));
      return;
    }
    if (action.kind === 'add-food' && action.foodId) {
      const previousAvailable = appState.foods.find((food) => food.id === action.foodId)?.available ?? false;
      if (!previousAvailable) {
        actions.setFoodAvailable(action.foodId, true);
        actions.showToast(`${action.foodName ?? '食物'}已加入食物池`, { label: '撤销', onPress: () => actions.setFoodAvailable(action.foodId!, previousAvailable) });
      } else {
        actions.showToast(`${action.foodName ?? '食物'}已经在食物池`);
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, actions: (message.actions ?? []).map((item) => item === action ? { ...item, label: previousAvailable ? '已在食物池' : '已加入食物池', kind: 'done' } : item) } : message));
      return;
    }
    if (action.route) router.push(action.route);
  };

  const saveFoodEdit = () => {
    if (!foodEdit) return;
    const name = foodEdit.name.trim();
    const portion = Number(foodEdit.portion);
    const calories = Number(foodEdit.calories);
    const protein = Number(foodEdit.protein);
    const carbs = Number(foodEdit.carbs);
    const fat = Number(foodEdit.fat);
    if (!name || !Number.isFinite(portion) || portion <= 0 || portion > 5000 || [calories, protein, carbs, fat].some((value) => !Number.isFinite(value) || value < 0)) {
      actions.showToast('请填写有效的食物名称、每次参考份量和营养数据');
      return;
    }
    const next: FoodProposal = { ...foodEdit.draft, foodName: name, serving: '100 g', typicalServingGrams: Math.round(portion * 10) / 10, caloriesPer100g: calories, protein, carbs, fat };
    setMessages((current) => current.map((message) => message.id === foodEdit.messageId ? { ...message, foodProposal: next, actions: (message.actions ?? []).map((item) => item.foodDraft ? { ...item, foodDraft: next } : item) } : message));
    setFoodEdit(null);
    actions.showToast('分析结果已更新，请确认后加入食物池');
  };

  const handleFeedback = (messageId: string, feedback: 'up' | 'down') => {
    const currentMessage = messages.find((message) => message.id === messageId);
    const nextFeedback = currentMessage?.feedback === feedback ? null : feedback;
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, feedback: nextFeedback ?? undefined } : message));
    if (messageId.startsWith('coachmsg_') && appState.authSession?.accessToken) {
      void submitCoachFeedback(appState.authSession.accessToken, messageId, nextFeedback).catch(() => actions.showToast('反馈未能同步，请稍后重试'));
    }
    actions.showToast(nextFeedback === 'up' ? '已记录：这条回答有帮助' : nextFeedback === 'down' ? '已记录：这条回答需要改进' : '已取消这条反馈');
  };

  const handleRegenerate = (message: ChatMessage) => {
    if (message.sourceQuestion) sendMessage(message.sourceQuestion, message.id, false);
  };

  const confirmRemoveConversation = useCallback(() => {
    const target = conversationDeleteTarget;
    if (!target) return;
    setConversationDeleteTarget(null);
    void removeConversation(target);
  }, [conversationDeleteTarget, removeConversation]);

  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <FlatList ref={scrollRef} data={displayMessages} keyExtractor={(message) => message.id} renderItem={({ item }) => <ChatBubble message={item} onAction={(action) => handleAction(item.id, action)} onFeedback={handleFeedback} onRegenerate={handleRegenerate} onDelete={requestDeleteMessage} />} ItemSeparatorComponent={() => <View style={styles.messageSeparator} />} ListHeaderComponent={<View style={styles.listHeader}><View style={styles.header}><View style={styles.headerCopy}><View style={styles.brandRow}><Ionicons name="sparkles" size={16} color={colors.accent} /><ForgeText variant="label" tone="accent">FORGE · 智能教练</ForgeText></View><ForgeText variant="title">教练</ForgeText><ForgeText tone="secondary">把你的训练、状态和饮食，放进同一场对话。</ForgeText></View><View accessibilityLiveRegion={historyStatus === 'error' ? 'assertive' : 'polite'} accessibilityLabel={historyStatus === 'loading' ? '正在同步 Coach 历史' : historyStatus === 'error' ? 'Coach 历史同步失败，可重试' : aiNeedsConsent ? '需要数据授权' : providerStatusLabel}><ForgeStatusPill label={historyStatus === 'loading' ? '正在同步历史' : historyStatus === 'error' ? '历史同步失败' : aiNeedsConsent ? '需要数据授权' : providerStatusLabel} tone={aiConfigured ? 'accent' : 'neutral'} /></View></View><View style={styles.conversationBar}><Pressable accessibilityRole="button" accessibilityLabel="选择 Coach 会话" accessibilityState={{ expanded: conversationPickerOpen }} onPress={() => setConversationPickerOpen(true)} style={({ pressed }) => [styles.conversationSelector, pressed && styles.pressed]}><View style={styles.contextIcon}><Ionicons name="chatbubbles-outline" size={18} color={colors.accent} /></View><View style={styles.conversationSelectorCopy}><ForgeText variant="caption" tone="tertiary">当前会话</ForgeText><ForgeText variant="label" numberOfLines={1}>{conversations.find((item) => item.id === activeConversationId)?.title ?? '正在准备今天的教练'}</ForgeText></View><Ionicons name="chevron-down" size={16} color={colors.textTertiary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="新建 Coach 对话" disabled={conversationActionBusy} onPress={() => void createNewConversation()} style={({ pressed }) => [styles.newConversationButton, pressed && styles.pressed]}><Ionicons name="add" size={18} color={colors.background} /><ForgeText variant="caption">新对话</ForgeText></Pressable></View><Pressable accessibilityRole="button" accessibilityLabel="查看 FORGE 使用的个人上下文" accessibilityState={{ expanded: showContext }} onPress={() => setShowContext((current) => !current)} style={({ pressed }) => [styles.contextBar, pressed && styles.pressed]}><View style={styles.contextIcon}><Ionicons name="layers-outline" size={18} color={colors.accent} /></View><View style={styles.contextCopy}><ForgeText variant="label">{hasCoachContext ? '已连接你的训练上下文' : '尚未设置训练上下文'}</ForgeText><ForgeText variant="caption" tone="secondary">{hasCoachContext ? `${appState.dailyPlan.workout.title} · 状态 ${appState.dailyPlan.bodyState.readinessScore} · ${appState.nutrition.calories.toLocaleString()} kcal` : '创建计划或记录数据后，这里会显示真实上下文'}</ForgeText></View><Ionicons name={showContext ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} /></Pressable>{showContext ? <ForgeCard style={styles.contextDetail}><ForgeText variant="caption" tone="secondary">回答会参考以下信息</ForgeText><View style={styles.contextTags}><ContextTag icon="barbell-outline" label={appState.dailyPlan.workout.title} /><ContextTag icon="heart-outline" label={`状态 ${appState.dailyPlan.bodyState.readinessScore}`} /><ContextTag icon="restaurant-outline" label={`${appState.nutrition.calories.toLocaleString()} kcal 目标`} /><ContextTag icon="flag-outline" label={appState.profile.goal.label} /></View><View style={styles.backgroundRow}><View style={styles.backgroundCopy}><ForgeText variant="label">后台继续对话</ForgeText><ForgeText variant="caption" tone="tertiary">系统后台语音服务尚未连接。</ForgeText></View><View accessibilityLabel="后台继续对话未连接" style={styles.unavailablePill}><ForgeText variant="caption" tone="tertiary">未连接</ForgeText></View></View><ForgeText variant="caption" tone="tertiary">你始终可以在个人中心修改这些信息。</ForgeText></ForgeCard> : null}<View style={styles.historyTools}>
  <TextInput
    accessibilityLabel="搜索 Coach 历史"
    accessibilityHint="输入关键词后点击搜索"
    value={searchDraft}
    onChangeText={setSearchDraft}
    onSubmitEditing={runHistorySearch}
    returnKeyType="search"
    placeholder="搜索历史"
    placeholderTextColor={colors.textTertiary}
    maxLength={80}
    style={styles.historySearchInput}
  />
  <Pressable accessibilityRole="button" accessibilityLabel="搜索 Coach 历史" onPress={runHistorySearch} style={({ pressed }) => [styles.historyIconAction, pressed && styles.pressed]}>
    <Ionicons name="search-outline" size={18} color={colors.accent} />
  </Pressable>
  {appState.authSession && effectiveMessages.some((message) => message.id !== 'welcome') ? (
    <Pressable accessibilityRole="button" accessibilityLabel="清除 Coach 历史" onPress={() => setClearHistoryOpen(true)} style={({ pressed }) => [styles.historyIconAction, pressed && styles.pressed]}>
      <Ionicons name="trash-outline" size={18} color={colors.warning} />
    </Pressable>
  ) : null}
</View>
<ForgeText variant="caption" tone="tertiary" style={styles.dateLabel}>{historyQuery ? '搜索：' + historyQuery : '今天 · FORGE 随时在线'}</ForgeText></View>} ListFooterComponent={<View style={styles.listFooter}>{historyStatus === 'error' ? <Pressable accessibilityRole="button" accessibilityLabel="重试同步 Coach 历史" onPress={() => void loadHistory()} style={({ pressed }) => [styles.historyAction, pressed && styles.pressed]}><Ionicons name="refresh-outline" size={16} color={colors.accent} /><ForgeText variant="caption" tone="accent">重试同步历史</ForgeText></Pressable> : null}{historyCursor ? <Pressable accessibilityRole="button" accessibilityLabel="加载更多 Coach 历史" accessibilityState={{ busy: historyStatus === 'loading' }} disabled={historyStatus === 'loading'} onPress={() => void loadHistory(historyCursor)} style={({ pressed }) => [styles.historyAction, pressed && styles.pressed]}><ForgeText variant="caption" tone="accent">{historyStatus === 'loading' ? '加载中…' : '加载更多历史'}</ForgeText><Ionicons name="chevron-down" size={16} color={colors.accent} /></Pressable> : null}{isReplying ? <View accessibilityLiveRegion="polite" accessibilityLabel={isRecovering ? '网络已断开，正在从 FORGE 恢复已提交回答' : 'FORGE 正在整理你的信息'} style={styles.typing}><ActivityIndicator size="small" color={colors.accent} /><ForgeText variant="caption" tone="secondary">{isRecovering ? '网络已断开，正在恢复已提交回答…' : 'FORGE 正在整理你的信息…'}</ForgeText></View> : null}{effectiveMessages.length === 1 && !isReplying ? <View style={styles.suggestions}><ForgeText variant="caption" tone="tertiary">你可以这样问</ForgeText><View style={styles.suggestionList}>{suggestedPrompts.map((prompt) => <Pressable key={prompt} accessibilityRole="button" accessibilityLabel={`提问：${prompt}`} accessibilityState={{ disabled: isReplying }} disabled={isReplying} onPress={() => sendMessage(prompt)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}><ForgeText variant="caption" tone="secondary">{prompt}</ForgeText><Ionicons name="arrow-up" size={14} color={colors.textTertiary} /></Pressable>)}</View></View> : null}</View>} style={styles.scroll} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} onContentSizeChange={handleContentSizeChange} onScroll={handleScroll} onScrollBeginDrag={handleScrollBeginDrag} scrollEventThrottle={16} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xs, paddingBottom: spacing.lg }]} />
    {showScrollToBottom ? <Pressable accessibilityRole="button" accessibilityLabel={hasNewReply ? '有新回答，回到底部' : '回到底部'} accessibilityHint="跳转到最新消息" onPress={() => scrollToLatest(true)} style={({ pressed }) => [styles.scrollToBottomButton, { bottom: 112 + Math.max(insets.bottom, spacing.xs) }, pressed && styles.pressed]}><Ionicons name="arrow-down" size={18} color={colors.background} /></Pressable> : null}

    <Modal visible={conversationDeleteTarget !== null} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setConversationDeleteTarget(null)} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={() => setConversationDeleteTarget(null)}>
        <Pressable style={styles.confirmSheet} onPress={(event) => event.stopPropagation()}>
          <ForgeText variant="h3">删除 Coach 会话？</ForgeText>
          <ForgeText tone="secondary">“{conversationDeleteTarget?.title ?? ''}”及其中的所有消息都会从 FORGE 账户中永久删除，操作不可撤销。</ForgeText>
          <View style={styles.confirmActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="取消删除 Coach 会话" onPress={() => setConversationDeleteTarget(null)} style={({ pressed }) => [styles.secondaryConfirm, pressed && styles.pressed]}><ForgeText variant="label" tone="secondary">取消</ForgeText></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="确认删除 Coach 会话" disabled={conversationActionBusy} onPress={confirmRemoveConversation} style={({ pressed }) => [styles.dangerConfirm, pressed && styles.pressed]}><ForgeText variant="label" tone="danger">{conversationActionBusy ? '删除中…' : '确认删除'}</ForgeText></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    <Modal visible={conversationPickerOpen} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setConversationPickerOpen(false)} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={() => setConversationPickerOpen(false)}>
        <Pressable style={styles.conversationSheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.conversationSheetHeader}><View><ForgeText variant="h3">Coach 会话</ForgeText><ForgeText variant="caption" tone="secondary">每天自动进入当天会话，历史会话会保留。</ForgeText></View><Pressable accessibilityRole="button" accessibilityLabel="关闭 Coach 会话列表" onPress={() => setConversationPickerOpen(false)} style={styles.voiceClose}><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable></View>
          {renameConversationId ? <View style={styles.renameRow}><TextInput accessibilityLabel="会话名称" value={renameDraft} onChangeText={setRenameDraft} maxLength={80} autoFocus placeholder="会话名称" placeholderTextColor={colors.textTertiary} style={styles.renameInput} /><Pressable accessibilityRole="button" accessibilityLabel="保存会话名称" disabled={conversationActionBusy || !renameDraft.trim()} onPress={() => void saveConversationRename()} style={styles.renameSave}><ForgeText variant="caption">保存</ForgeText></Pressable><Pressable accessibilityRole="button" accessibilityLabel="取消重命名" onPress={() => setRenameConversationId(null)} style={styles.renameCancel}><ForgeText variant="caption" tone="secondary">取消</ForgeText></Pressable></View> : null}
          <FlatList data={conversations} keyExtractor={(item) => item.id} style={styles.conversationList} ListEmptyComponent={<ForgeText tone="secondary">暂无已保存会话</ForgeText>} renderItem={({ item }) => <View style={[styles.conversationRow, item.id === activeConversationId && styles.conversationRowActive]}><Pressable accessibilityRole="button" accessibilityLabel={'打开会话：' + item.title} onPress={() => selectConversation(item)} style={styles.conversationRowMain}><View style={styles.conversationRowCopy}><ForgeText variant="label" numberOfLines={1}>{item.title}</ForgeText><ForgeText variant="caption" tone="secondary" numberOfLines={1}>{item.dateKey + ' · ' + item.messageCount + ' 条消息'}</ForgeText><ForgeText variant="caption" tone="tertiary" numberOfLines={1}>{item.lastMessagePreview || '尚未开始对话'}</ForgeText></View>{item.id === activeConversationId ? <Ionicons name="checkmark-circle" size={20} color={colors.accent} /> : <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}</Pressable><View style={styles.conversationRowActions}><Pressable accessibilityRole="button" accessibilityLabel={'重命名会话：' + item.title} onPress={() => beginRenameConversation(item)} style={styles.conversationMiniAction}><Ionicons name="pencil-outline" size={16} color={colors.textSecondary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={'归档会话：' + item.title} disabled={conversationActionBusy} onPress={() => void archiveConversation(item)} style={styles.conversationMiniAction}><Ionicons name="archive-outline" size={16} color={colors.textSecondary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={'删除会话：' + item.title} disabled={conversationActionBusy} onPress={() => setConversationDeleteTarget(item)} style={styles.conversationMiniAction}><Ionicons name="trash-outline" size={16} color={colors.warning} /></Pressable></View></View>} />
        </Pressable>
      </Pressable>
    </Modal>
    <Modal visible={voiceOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={cancelVoiceMode} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={voiceStatus === 'transcribing' ? undefined : cancelVoiceMode}>
        <Pressable style={styles.voiceSheet} onPress={(event) => event.stopPropagation()}>
          <ForgeText variant="h3">语音提问</ForgeText>
          <ForgeText tone="secondary">{voiceStatus === 'recording' ? '正在录音。完成后会发送到已配置的真实转写服务，转写结果会先回到输入框供你确认。' : voiceStatus === 'transcribing' ? '正在请求真实语音转写服务…' : '录音不会在 FORGE 服务端保存。'}</ForgeText>
          {voiceError ? <ForgeText variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="assertive">{voiceError}</ForgeText> : null}
          {voiceStatus === 'recording' ? <ForgeText variant="h2" style={styles.voiceTimer}>{Math.max(0, Math.round(recorderState.durationMillis / 1000))} 秒</ForgeText> : null}
          {voiceStatus === 'recording' ? <Pressable accessibilityRole="button" accessibilityLabel="结束录音并转写" accessibilityState={{ busy: false }} onPress={() => { void stopVoiceMode(); }} style={({ pressed }) => [styles.voiceAction, pressed && styles.pressed]}><Ionicons name="stop-circle-outline" size={20} color={colors.background} /><ForgeText variant="label">结束录音并转写</ForgeText></Pressable> : voiceStatus === 'transcribing' ? <View style={styles.voiceAction}><ActivityIndicator color={colors.background} /><ForgeText variant="label">转写中…</ForgeText></View> : <Pressable accessibilityRole="button" accessibilityLabel="重新开始录音" onPress={() => { void openVoiceMode(); }} style={({ pressed }) => [styles.voiceAction, pressed && styles.pressed]}><Ionicons name="mic-outline" size={20} color={colors.background} /><ForgeText variant="label">重新开始录音</ForgeText></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="关闭语音提问" disabled={voiceStatus === 'transcribing'} onPress={cancelVoiceMode} style={({ pressed }) => [styles.voiceCancelAction, pressed && styles.pressed]}><ForgeText variant="label" tone="secondary">取消</ForgeText></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
    <Modal visible={clearHistoryOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setClearHistoryOpen(false)} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={() => setClearHistoryOpen(false)}>
        <Pressable style={styles.confirmSheet} onPress={(event) => event.stopPropagation()}>
          <ForgeText variant="h3">清除 Coach 历史？</ForgeText>
          <ForgeText tone="secondary">这会从 FORGE 服务端和当前设备移除你的 Coach 对话历史，操作不可撤销。</ForgeText>
          <View style={styles.confirmActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="取消清除 Coach 历史" onPress={() => setClearHistoryOpen(false)} style={({ pressed }) => [styles.secondaryConfirm, pressed && styles.pressed]}>
              <ForgeText variant="label" tone="secondary">取消</ForgeText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="确认清除 Coach 历史" disabled={historyStatus === 'loading'} onPress={confirmClearHistory} style={({ pressed }) => [styles.dangerConfirm, pressed && styles.pressed]}>
              <ForgeText variant="label" tone="danger">{historyStatus === 'loading' ? '清除中…' : '确认清除'}</ForgeText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    <Modal visible={deleteMessageId !== null} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setDeleteMessageId(null)} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={() => setDeleteMessageId(null)}>
        <Pressable style={styles.confirmSheet} onPress={(event) => event.stopPropagation()}>
          <ForgeText variant="h3">删除这条 Coach 对话？</ForgeText>
          <ForgeText tone="secondary">这会删除这条回答及其对应的问题，并同步从你的 FORGE 账户历史中移除，操作不可撤销。</ForgeText>
          <View style={styles.confirmActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="取消删除 Coach 对话" onPress={() => setDeleteMessageId(null)} style={({ pressed }) => [styles.secondaryConfirm, pressed && styles.pressed]}>
              <ForgeText variant="label" tone="secondary">取消</ForgeText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="确认删除 Coach 对话" disabled={historyStatus === 'loading'} onPress={confirmDeleteMessage} style={({ pressed }) => [styles.dangerConfirm, pressed && styles.pressed]}>
              <ForgeText variant="label" tone="danger">{historyStatus === 'loading' ? '删除中…' : '确认删除'}</ForgeText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    <Modal visible={Boolean(foodEdit)} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setFoodEdit(null)} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={() => setFoodEdit(null)}>
        <Pressable style={styles.foodEditSheet} onPress={(event) => event.stopPropagation()}>
          <ForgeText variant="h3">修改食物分析</ForgeText>
          <ForgeText variant="caption" tone="secondary">修改后仍需点击“确认加入食物池”才会写入账户。</ForgeText>
          <TextInput accessibilityLabel="食物名称" value={foodEdit?.name ?? ''} onChangeText={(value) => setFoodEdit((current) => current ? { ...current, name: value } : current)} placeholder="食物名称" placeholderTextColor={colors.textTertiary} style={styles.foodEditInput} />
          <ForgeText variant="caption" tone="secondary" style={{ paddingVertical: spacing.xs }}>食物池记录基准：每 100g；每次参考份量可单独设置</ForgeText>
          <View style={styles.foodEditField}><ForgeText variant="caption" tone="secondary">每次参考份量（g）</ForgeText><TextInput accessibilityLabel="每次参考份量（g）" keyboardType="decimal-pad" value={foodEdit?.portion ?? ''} onChangeText={(value) => setFoodEdit((current) => current ? { ...current, portion: value } : current)} placeholder="例如 140" placeholderTextColor={colors.textTertiary} style={styles.foodEditInput} /></View>
          <View style={styles.foodEditGrid}>
            {([['calories', '热量 / 100g'], ['protein', '蛋白质 / 100g'], ['carbs', '碳水 / 100g'], ['fat', '脂肪 / 100g']] as const).map(([key, label]) => <View key={key} style={styles.foodEditField}><ForgeText variant="caption" tone="secondary">{label}</ForgeText><TextInput accessibilityLabel={label} keyboardType="decimal-pad" value={foodEdit?.[key] ?? ''} onChangeText={(value) => setFoodEdit((current) => current ? { ...current, [key]: value } : current)} placeholder="0" placeholderTextColor={colors.textTertiary} style={styles.foodEditInput} /></View>)}
          </View>
          <View style={styles.foodEditActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="取消修改食物分析" onPress={() => setFoodEdit(null)} style={({ pressed }) => [styles.secondaryConfirm, pressed && styles.pressed]}><ForgeText variant="label" tone="secondary">取消</ForgeText></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="保存食物分析修改" onPress={saveFoodEdit} style={({ pressed }) => [styles.foodEditPrimary, pressed && styles.pressed]}><ForgeText variant="label">保存修改</ForgeText></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    {
      <View style={[styles.composerArea, { paddingBottom: Math.max(insets.bottom, spacing.xs) }]}>
        <ForgeText variant="label" tone="secondary" style={styles.composerLabel}>问问 FORGE</ForgeText>
        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="向 FORGE 提问"
            accessibilityHint="输入训练、状态或饮食问题"
            value={draft}
            onChangeText={setDraft}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
            blurOnSubmit
            placeholder="例如：我今天该怎么安排训练？"
            placeholderTextColor={colors.textTertiary}
            maxLength={240}
            style={[styles.input, { fontSize: 16, lineHeight: 24 }, inputFocused && { outlineStyle: 'solid' as never, outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 2 } as never]}
            editable={!isReplying}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Platform.OS === 'web' ? '语音记录，Web 不可用' : '开始语音对话'}
            accessibilityState={{ disabled: isReplying || Platform.OS === 'web' }}
            disabled={isReplying || Platform.OS === 'web'}
            onPress={() => { void openVoiceMode(); }}
            style={({ pressed }) => [styles.voiceButton, pressed && styles.pressed]}
          >
            <Ionicons name="mic-outline" size={19} color={Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isReplying ? '取消发送问题' : '发送问题'}
            accessibilityHint={isReplying ? '停止当前回答请求' : undefined}
            accessibilityState={{ disabled: !draft.trim() && !isReplying, busy: isReplying }}
            disabled={!draft.trim() && !isReplying}
            onPress={() => isReplying ? cancelReply() : sendMessage()}
            style={({ pressed }) => [styles.sendButton, !draft.trim() && !isReplying && styles.sendButtonDisabled, pressed && styles.pressed]}
          >
            {isReplying ? <View style={{ alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="small" color={colors.accent} /><View style={{ position: 'absolute' }}><Ionicons name="close" size={12} color={colors.accent} /></View></View> : <Ionicons name="arrow-up" size={20} color={draft.trim() ? colors.background : colors.textTertiary} />}
          </Pressable>
        </View>
        <ForgeText variant="caption" tone="tertiary" style={styles.disclaimer}>FORGE 会基于你的个人数据回答，不替代专业医疗建议。</ForgeText>
      </View>
    }
  </KeyboardAvoidingView>;
}

type MorningStatePatch = Pick<Parameters<ReturnType<typeof useForgeAppActions>['updateDailyState']>[0], 'sleep' | 'fatigue' | 'soreness'>;

function toChatMessage(message: StoredCoachMessage): ChatMessage { return { ...message }; }

function formatChatDate(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '刚刚创建';
  return formatLocalizedDate(value, '');
}

function formatChatTimestamp(value?: string): string {
  return formatLocalizedDateTime(value, '刚刚创建');
}

function isFoodConfirmationQuestion(question: string): boolean {
  const normalized = question.replace(/[\s，。！!、,.；;：:?？]+/gu, '');
  return /^(?:好|好的|可以|同意|确认)(?:加入|添加|放入)?(?:食物池|这个食物|该食物)?$/u.test(normalized)
    || /^(?:确认|可以|同意)(?:加入|添加|放入)(?:食物池|这个食物|该食物)$/u.test(normalized);
}

function findPendingFoodProposal(messages: ChatMessage[]): { messageId: string; proposal: FoodProposal } | null {
  const candidates = [...messages]
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || '');
      const rightTime = Date.parse(right.createdAt || '');
      return (Number.isFinite(rightTime) ? rightTime : -Infinity) - (Number.isFinite(leftTime) ? leftTime : -Infinity);
    });
  const pending = candidates.flatMap((message) => {
    const action = (message.actions ?? []).find((item) => item.kind === 'confirm-food' && item.foodDraft);
    if (action?.foodDraft) return [{ messageId: message.id, proposal: { ...action.foodDraft, typicalServingGrams: action.foodDraft.typicalServingGrams ?? 100 } }];
    if (message.foodProposal && !(message.actions ?? []).some((item) => item.label === '已加入食物池' || item.kind === 'done')) return [{ messageId: message.id, proposal: { ...message.foodProposal, typicalServingGrams: message.foodProposal.typicalServingGrams ?? 100 } }];
    return [];
  });
  return pending.find(({ proposal }) => Number.isFinite(Number(proposal.typicalServingGrams)) && Number(proposal.typicalServingGrams) > 0) ?? pending[0] ?? null;
}

function findActivePendingFoodProposal(messages: ChatMessage[]): { messageId: string; proposal: FoodProposal } | null {
  const latest = [...messages].reverse().find((message) => message.id !== 'welcome' && !message.streaming);
  if (!latest || latest.role !== 'coach') return null;
  return findPendingFoodProposal([latest]);
}

function foodProposalActions(proposal: FoodProposal): CoachAction[] {
  return [
    { label: '确认加入食物池', kind: 'confirm-food', foodDraft: proposal },
    { label: '修改分析结果', kind: 'edit-food', foodDraft: proposal },
    { label: '取消', kind: 'cancel-food', foodDraft: proposal },
  ];
}

function recoverPendingFoodProposal(sourceQuestion?: string, text?: string): FoodProposal | null {
  const foodName = extractFoodNameFromQuestion(sourceQuestion);
  if (!foodName || !text) return null;
  const proposal = parseFoodProposalFromText(foodName, text);
  return proposal ? { ...proposal, typicalServingGrams: proposal.typicalServingGrams ?? extractReferenceServingGrams(sourceQuestion) ?? 100 } : null;
}

function extractReferenceServingGrams(question?: string): number | undefined {
  const match = question?.match(/(\d+(?:\.\d+)?)\s*(?:g|克)\b/iu);
  if (!match) return undefined;
  const grams = Number(match[1]);
  return Number.isFinite(grams) && grams > 0 && grams <= 5000 ? grams : undefined;
}

function projectedDailyPlan(dailyPlan: ReturnType<typeof useForgeAppState>['dailyPlan'], statePatch: MorningStatePatch | null) {
  if (!statePatch) return dailyPlan;
  const readinessScore = estimateReadiness(statePatch);
  return {
    ...dailyPlan,
    bodyState: {
      ...dailyPlan.bodyState,
      ...statePatch,
      readinessScore,
      readinessLabel: readinessScore >= 75 ? 'GOOD' as const : readinessScore >= 55 ? 'FAIR' as const : 'LOW' as const,
    },
  };
}

function createAnswer(app: Pick<ReturnType<typeof useForgeAppState>, 'foods' | 'exercises' | 'nutrition' | 'dailyPlan'>, generatedText?: string, actionHint?: CoachActionHint, plan?: CoachPlanDraft, commands?: CoachCommandDraft[], sourceQuestion?: string, execution?: ApplyCoachPlanResult | null): Omit<ChatMessage, 'id' | 'role'> {
  const isFoodPoolRequest = Boolean(sourceQuestion?.includes('食物池') && /(加入|添加|放入)/u.test(sourceQuestion));
  const hasExecutionPayload = Boolean(hasExecutableCoachPlan(plan) || commands?.length || (actionHint && actionHint.type !== 'none'));
  const writeIntent = Boolean(sourceQuestion && !isFoodPoolRequest && !/(不要|无需|不用|不需要|不修改|不更新|不记录|只回复|仅回复)/u.test(sourceQuestion) && /(设置|设为|更新|修改|记录|完成|吃完|已吃|应用|采用|调整)/u.test(sourceQuestion));
  if (writeIntent && !hasExecutionPayload) return { text: '模型没有返回可执行的系统变更指令，本次没有修改任何数据。', detail: '为了避免误报成功，FORGE 只接受真实的 plan 或 command 写入结果。请重试或补充具体内容。' };
  const safeGeneratedText = generatedText && (execution?.changed || !/(已(?:经)?(?:加入|添加|采用|应用|更新|修改|记下|设置|设为|记录|写入|保存|同步|生成|完成)|(?:加入|添加|采用|应用|设置|记录|更新).*(?:成功|完成))/u.test(generatedText)) ? generatedText : undefined;
  if (!safeGeneratedText) return { text: '这次回答没有生成成功，请重新生成。', detail: '模型返回为空或无法安全使用，FORGE 没有用示例内容替代。' };
  const hintedFood = actionHint?.type === 'add_food' ? app.foods.find((food) => food.name.includes(actionHint.foodName) || actionHint.foodName.includes(food.name)) : undefined;
  const visiblePlan: CoachPlan | undefined = !isFoodPoolRequest && plan && hasExecutableCoachPlan(plan) ? {
    workoutTitle: plan.workout?.title || '今日训练未调整',
    workoutMeta: (Number.isFinite(Number(plan.workout?.estimatedMinutes)) ? Math.round(Number(plan.workout?.estimatedMinutes)) : 60) + ' 分钟 · ' + (plan.workout?.exercises?.length ?? 0) + ' 个动作',
    nutritionCalories: (Number.isFinite(Number(plan.nutrition?.calories)) ? Math.round(Number(plan.nutrition?.calories)) : app.nutrition.calories) + ' kcal',
    nutritionMeta: '蛋白质 ' + (plan.nutrition?.protein ?? app.nutrition.protein) + ' g · 碳水 ' + (plan.nutrition?.carbs ?? app.nutrition.carbs) + ' g · 脂肪 ' + (plan.nutrition?.fat ?? app.nutrition.fat) + ' g',
    readiness: app.dailyPlan.bodyState.readinessLabel,
    hasWorkout: Boolean(plan.workout?.exercises?.length),
    ...(plan.mealPlan?.length ? { mealPlan: plan.mealPlan.map((item) => ({ meal: item.meal === 'breakfast' ? '早餐' : item.meal === 'lunch' ? '午餐' : item.meal === 'dinner' ? '晚餐' : '加餐', foodName: item.foodName, serving: item.serving || '按食物池参考份量' })) } : {}),
  } : undefined;
  const answer: Omit<ChatMessage, 'id' | 'role'> = { text: safeGeneratedText, detail: '已结合你授权的训练、状态和饮食上下文生成。', ...(visiblePlan ? { plan: visiblePlan } : {}) };
  const requestedFoodName = actionHint?.type === 'add_food' ? actionHint.foodName : extractFoodNameFromQuestion(sourceQuestion) || safeGeneratedText.match(/[“"]([^”"]+)[”"]/u)?.[1]?.trim() || null;
  const rawFoodProposal = [...(commands ?? []), ...(plan?.commands ?? [])].find((command): command is FoodProposal => command.type === 'add_food');
  const proposalMatchesRequest = !rawFoodProposal || !requestedFoodName || rawFoodProposal.foodName.includes(requestedFoodName) || requestedFoodName.includes(rawFoodProposal.foodName);
  if (rawFoodProposal && !proposalMatchesRequest) {
    return { ...answer, text: '这次营养分析与当前请求的食物不一致，FORGE 没有写入任何食物数据。请重新发送这条食物请求。', detail: '为避免把上一条请求的结果写入当前食物，已阻止本次确认。', actions: sourceQuestion ? [{ label: '重新分析', kind: 'retry', retryQuestion: sourceQuestion }] : [] };
  }
  const foodProposal = rawFoodProposal ? { ...rawFoodProposal, serving: '100 g', typicalServingGrams: rawFoodProposal.typicalServingGrams ?? extractReferenceServingGrams(sourceQuestion) ?? 100 } : null;
  if (foodProposal) {
    return {
      ...answer,
      detail: '我先根据食物名称完成了每100g营养分析。请检查结果，可修改后再确认；确认前不会写入食物池。',
      foodProposal,
      actions: [
        { label: '确认加入食物池', kind: 'confirm-food', foodDraft: foodProposal },
        { label: '修改分析结果', kind: 'edit-food', foodDraft: foodProposal },
        { label: '取消', kind: 'cancel-food', foodDraft: foodProposal },
      ],
    };
  }
  const parsedFoodAnalysis = !foodProposal && requestedFoodName ? parseFoodProposalFromText(requestedFoodName, safeGeneratedText) : null;
  const parsedFoodProposal = parsedFoodAnalysis ? { ...parsedFoodAnalysis, foodName: extractFoodNameFromQuestion(sourceQuestion) || parsedFoodAnalysis.foodName, serving: '100 g', typicalServingGrams: parsedFoodAnalysis.typicalServingGrams ?? extractReferenceServingGrams(sourceQuestion) ?? 100 } : null;
  if (parsedFoodProposal) {
    return {
      ...answer,
      detail: '我先根据食物名称完成了每100g营养分析。请检查结果，可修改后再确认；确认前不会写入食物池。',
      foodProposal: parsedFoodProposal,
      actions: [
        { label: '确认加入食物池', kind: 'confirm-food', foodDraft: parsedFoodProposal },
        { label: '修改分析结果', kind: 'edit-food', foodDraft: parsedFoodProposal },
        { label: '取消', kind: 'cancel-food', foodDraft: parsedFoodProposal },
      ],
    };
  }
  if (actionHint?.type === 'apply_commands' && commands?.length) {
    const hasNutrition = commands.some((command) => command.type === 'log_food' || command.type === 'set_food_preference' || command.type === 'add_food');
    const hasWorkout = commands.some((command) => command.type === 'complete_workout' || command.type === 'set_training_preferences' || command.type === 'set_weekly_workout_goal');
    const missingFoods = commands.filter((command): command is Extract<CoachCommandDraft, { type: 'set_food_preference' }> => command.type === 'set_food_preference').filter((command) => !app.foods.some((food) => food.name.toLowerCase() === command.foodName.toLowerCase() || food.name.toLowerCase().includes(command.foodName.toLowerCase()) || command.foodName.toLowerCase().includes(food.name.toLowerCase()))).map((command) => command.foodName);
    if (missingFoods.length) return { text: '暂时没有加入：' + [...new Set(missingFoods)].join('、') + ' 不在你的食物池中，且缺少真实营养数据。', detail: '为了避免编造营养数据，请先在食物池录入真实营养信息；录入后 Coach 才会使用它规划饮食。', actions: [{ label: '去食物池补充真实数据', route: '/nutrition/foods' }] };
    const commandActions: CoachAction[] = [
      ...(hasWorkout ? [{ label: '查看今日训练', route: '/active-workout' as const }] : []),
      ...(hasNutrition ? [{ label: '查看今日饮食', route: '/nutrition' as const }] : []),
    ];
    const applied = execution?.results.filter((item) => item.status === 'applied') ?? [];
    const skipped = execution?.results.filter((item) => item.status === 'skipped') ?? [];
    const failed = execution?.results.filter((item) => item.status === 'failed') ?? [];
    const executionDetail = execution?.changed
      ? '已实际写入：' + applied.map((item) => item.detail).filter(Boolean).join('；') + (skipped.length ? '。已跳过：' + skipped.map((item) => item.reason).filter(Boolean).join('；') : '') + (failed.length ? '。未执行：' + failed.map((item) => item.reason).filter(Boolean).join('；') : '') + '。正在同步云端。'
      : '这次没有写入系统：' + (failed.concat(skipped).map((item) => item.reason).filter(Boolean).join('；') || '没有找到可执行的有效数据。');
    const executionText = execution?.changed && /(?:需要.*确认|不会直接声称|未(?:会)?直接.*(?:保存|更新)|客户端确认)/u.test(answer.text)
      ? '已根据你的指令更新 FORGE，下面是实际执行结果。'
      : answer.text;
    return { ...answer, text: executionText, detail: executionDetail, ...(execution?.changed && commandActions.length ? { actions: commandActions } : {}) };
  }
  if (actionHint?.type === 'apply_plan' && visiblePlan) {
    const planActions: CoachAction[] = [
      ...(visiblePlan.mealPlan?.length ? [{ label: '应用饮食方案', kind: 'apply-meal' as const, mealPlan: plan?.mealPlan }] : []),
      ...(plan?.workout?.exercises?.length ? [{ label: '查看今日训练', route: '/active-workout' as const }] : []),
      ...(visiblePlan.mealPlan?.length ? [{ label: '查看今日饮食', route: '/nutrition' as const }] : []),
    ];
    const detail = execution?.changed ? '已将真实目标、今日状态和训练计划写入 FORGE。' + (visiblePlan.mealPlan?.length ? '逐餐饮食方案待你确认后写入。' : '') : visiblePlan.mealPlan?.length ? '训练/目标没有产生可写入变更；逐餐饮食方案待你确认后写入。' : '这次方案没有写入 FORGE：' + (execution?.results.map((item) => item.reason).filter(Boolean).join('；') || '没有可执行的数据。');
    return { ...answer, detail, actions: planActions };
  }
  if (actionHint?.type === 'add_food') {
    if (!hintedFood) return { ...answer, detail: '模型建议的食物不在你的食物池中，FORGE 没有自动添加。' };
    return { ...answer, detail: '这是一次会影响后续推荐的变更，请确认后再同步到你的食物池。', actions: [{ label: '确认加入食物池', kind: 'add-food', foodId: hintedFood.id, foodName: hintedFood.name }] };
  }
  if (actionHint?.type === 'apply_workout_insight' && app.exercises.length > 0) return { ...answer, actions: [{ label: '应用训练建议（增加一组）', kind: 'apply-insight', exercise: actionHint.exercise }, { label: '开始今天训练', route: '/active-workout' }] };
  return answer;
}
function extractFoodNameFromQuestion(question?: string): string | null {
  if (!question || !question.includes('食物池') || !/(加入|添加|放入)/u.test(question)) return null;
  const match = question.match(/(?:把|将)\s*(.+?)\s*(?:加入|添加|放入)/u);
  const raw = match?.[1]?.replace(/[：:，,。.!！?？].*$/u, '').trim() || '';
  return raw.replace(/^\d+(?:\.\d+)?\s*(?:g|克|ml|毫升)\s*(?:的)?/iu, '').trim() || raw || null;
}

function parseExplicitCoachCommand(question: string): CoachCommandDraft[] {
  const weeklyMatch = question.match(/(?:每周|一周)[^\d]{0,12}(?:训练|锻炼)[^\d]{0,12}(\d{1,2})\s*次/u) ?? question.match(/(?:训练|锻炼)[^\d]{0,12}(\d{1,2})\s*次[^\n]{0,8}(?:每周|一周)/u);
  if (weeklyMatch) return [{ type: 'set_weekly_workout_goal', count: Number(weeklyMatch[1]) }];
  const addSetsMatch = question.match(/(?:把|将)\s*(.+?)\s*(?:增加|加|多加)\s*(\d{1,2})\s*组/u);
  if (addSetsMatch) return [{ type: 'adjust_workout', exerciseName: addSetsMatch[1].trim(), addSets: Number(addSetsMatch[2]) }];
  const repsMatch = question.match(/(?:把|将)\s*(.+?)\s*(?:每组次数|次数)\s*(?:改为|调整为|设为)\s*(\d{1,3})\s*(?:次)?/u);
  if (repsMatch) return [{ type: 'adjust_workout', exerciseName: repsMatch[1].trim(), reps: Number(repsMatch[2]) }];
  const kgMatch = question.match(/(?:把|将)\s*(.+?)\s*(?:重量|负重)\s*(?:改为|调整为|设为)?\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤)?/iu);
  if (kgMatch) return [{ type: 'adjust_workout', exerciseName: kgMatch[1].trim(), kg: Number(kgMatch[2]) }];
  return [];
}

function parseMealPlanFromText(question: string, text: string | undefined, foods: Array<{ name: string }>): CoachPlanDraft | null {
  if (!text || !/(饮食|餐单|餐食)/u.test(question) || !/(生成|安排|计划|规划)/u.test(question)) return null;
  const mealPattern = /(早餐|午餐|晚餐|加餐)\s*[:：]\s*([\s\S]*?)(?=；?\s*(?:早餐|午餐|晚餐|加餐)\s*[:：]|$)/gu;
  const mealMap: Record<string, MealType> = { 早餐: 'breakfast', 午餐: 'lunch', 晚餐: 'dinner', 加餐: 'snack' };
  const mealPlan: NonNullable<CoachPlanDraft['mealPlan']> = [];
  let mealMatch: RegExpExecArray | null;
  while ((mealMatch = mealPattern.exec(text)) !== null) {
    const meal = mealMap[mealMatch[1]];
    const segment = mealMatch[2];
    for (const food of foods) {
      const escapedName = food.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const servingMatch = segment.match(new RegExp(escapedName + '\\s*(\\d+(?:\\.\\d+)?)\\s*(?:g|克)', 'iu'));
      if (!servingMatch) continue;
      mealPlan.push({ meal, foodName: food.name, serving: Math.round(Number(servingMatch[1]) * 10) / 10 + ' g' });
    }
  }
  const distinctMeals = new Set(mealPlan.map((item) => item.meal));
  return mealPlan.length >= 2 && distinctMeals.size >= 2 ? { mealPlan } : null;
}

function buildLocalMealPlan(
  question: string,
  foods: Array<{ name: string; available: boolean; avoided: boolean; caloriesPer100g: number; defaultServing: string; typicalServingGrams?: number }>,
  nutrition: { calories: number; consumedCalories: number },
): CoachPlanDraft | null {
  if (!/(饮食|餐单|餐食)/u.test(question) || !/(生成|安排|计划|规划)/u.test(question)) return null;
  const availableFoods = foods.filter((food) => food.available && !food.avoided && food.caloriesPer100g > 0);
  if (!availableFoods.length || nutrition.calories <= 0) return null;
  const remainingCalories = Math.max(0, nutrition.calories - nutrition.consumedCalories);
  if (remainingCalories < 100) return null;
  const meals: { meal: MealType; ratio: number }[] = [
    { meal: 'breakfast', ratio: 0.25 },
    { meal: 'lunch', ratio: 0.3 },
    { meal: 'dinner', ratio: 0.3 },
    { meal: 'snack', ratio: 0.15 },
  ];
  return {
    mealPlan: meals.map(({ meal, ratio }, index) => {
      const food = availableFoods[index % availableFoods.length];
      const typical = Number(food.typicalServingGrams) > 0 ? Number(food.typicalServingGrams) : Number.parseFloat(food.defaultServing) || 100;
      const targetCalories = remainingCalories * ratio;
      const rawGrams = targetCalories / food.caloriesPer100g * 100;
      const grams = Math.max(20, Math.min(typical * 3, Math.max(typical * 0.5, rawGrams)));
      return { meal, foodName: food.name, serving: Math.max(5, Math.round(grams / 5) * 5) + ' g' };
    }),
  };
}

function hasExecutableCoachPlan(plan?: CoachPlanDraft | null): boolean {
  if (!plan) return false;
  return Boolean(
    plan.goal ||
    plan.nutrition ||
    plan.dailyState ||
    plan.workout?.exercises?.length ||
    plan.mealPlan?.length ||
    plan.commands?.length,
  );
}

function parseFoodProposalFromText(foodName: string, text: string): FoodProposal | null {
  const match = text.match(/每\s*100\s*g[^\d]{0,30}(\d+(?:\.\d+)?)\s*kcal[^\d]{0,20}蛋白质\s*(\d+(?:\.\d+)?)\s*g[^\d]{0,20}碳水\s*(\d+(?:\.\d+)?)\s*g[^\d]{0,20}脂肪\s*(\d+(?:\.\d+)?)\s*g/i);
  if (!match) return null;
  const analysisContext = text.slice(Math.max(0, (match.index ?? 0) - 100), (match.index ?? 0) + 20);
  if (!analysisContext.includes(foodName)) return null;
  return {
    type: 'add_food',
    foodName,
    serving: '100 g',
    caloriesPer100g: Number(match[1]),
    protein: Number(match[2]),
    carbs: Number(match[3]),
    fat: Number(match[4]),
    confidence: 'medium',
    basis: '从大模型返回的标准食物成分分析中提取；确认前不会写入食物池。',
  };
}

function parseMorningState(question: string, app: ReturnType<typeof useForgeAppState>): MorningStatePatch | null {
  const mentionsState = question.includes('睡') || question.includes('疲劳') || question.includes('累') || question.includes('酸');
  if (!mentionsState || (!question.includes('我') && !question.includes('今天') && !question.includes('昨晚'))) return null;
  const sleepMatch = question.match(/(\d+(?:\.\d+)?)\s*(?:小时|h)/i);
  return { sleep: sleepMatch ? `${sleepMatch[1]} 小时` : app.dailyPlan.bodyState.sleep, fatigue: question.includes('很累') || question.includes('特别累') ? '高' : question.includes('累') ? '中等' : app.dailyPlan.bodyState.fatigue, soreness: app.dailyPlan.bodyState.soreness };
}

function estimateReadiness(state: MorningStatePatch): number {
  const sleepHours = Number.parseFloat(state.sleep);
  const hasSleep = Number.isFinite(sleepHours);
  const hasFatigue = state.fatigue !== '未记录';
  const hasSoreness = state.soreness !== '未记录';
  const factorCount = Number(hasSleep) + Number(hasFatigue) + Number(hasSoreness);
  const fatigueScore = state.fatigue === '高' ? 2 : state.fatigue === '中等' ? 1 : 0;
  const sorenessScore = state.soreness.includes('高') ? 2 : state.soreness.includes('中等') ? 1 : 0;
  return factorCount === 0 ? 0 : Math.max(40, Math.min(98, Math.round(70 + (hasSleep ? (sleepHours - 7) * 5 : 0) - fatigueScore * 10 - sorenessScore * 7)));
}

function ChatBubble({ message, onAction, onFeedback, onRegenerate, onDelete }: { message: ChatMessage; onAction: (action: CoachAction) => void; onFeedback: (messageId: string, feedback: 'up' | 'down') => void; onRegenerate: (message: ChatMessage) => void; onDelete: (messageId: string) => void }) {
  const isUser = message.role === 'user';
  const actions = message.actions ?? (message.action ? [message.action] : []);
  return <View><ForgeText variant="caption" tone="tertiary" style={styles.dateDivider}>{message.dateDivider ?? ''}</ForgeText><View accessibilityLiveRegion={message.error ? 'assertive' : undefined} style={[styles.messageWrap, isUser && styles.messageWrapUser]}><View style={[styles.message, isUser ? styles.userMessage : styles.coachMessage, message.error && { borderLeftColor: colors.warning, backgroundColor: colors.elevated }]}>{!isUser ? <View style={styles.messageHeader}><View style={styles.messageBrand}><Ionicons name="sparkles" size={14} color={colors.accent} /><ForgeText variant="label" tone="accent">FORGE</ForgeText></View><View style={styles.messageHeaderActions}><ForgeText variant="caption" tone="tertiary">{formatChatTimestamp(message.createdAt)}</ForgeText>{message.id.startsWith('coachmsg_') ? <Pressable accessibilityRole="button" accessibilityLabel="删除这条 Coach 对话" onPress={() => onDelete(message.id)} style={({ pressed }) => [styles.messageDelete, pressed && styles.pressed]}><Ionicons name="trash-outline" size={15} color={colors.textTertiary} /></Pressable> : null}</View></View> : null}<ForgeText style={styles.messageText}>{message.text}</ForgeText>{message.detail ? <ForgeText variant="caption" tone="secondary" style={styles.messageDetail}>{message.detail}</ForgeText> : null}{message.plan ? <CoachPlanCard plan={message.plan} /> : null}{message.foodProposal ? <FoodProposalCard proposal={message.foodProposal} /> : null}{actions.length && !message.streaming ? <View style={styles.messageActions}>{actions.map((action) => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} accessibilityState={{ disabled: action.kind === 'done' }} disabled={action.kind === 'done'} onPress={() => onAction(action)} style={({ pressed }) => [styles.messageAction, action.kind === 'done' && styles.messageActionDone, pressed && styles.pressed]}><ForgeText variant="caption" tone={action.kind === 'done' ? 'success' : 'accent'}>{action.label}</ForgeText><Ionicons name={action.kind === 'done' ? 'checkmark' : 'arrow-forward'} size={15} color={action.kind === 'done' ? colors.success : colors.accent} /></Pressable>)}</View> : null}{!isUser && !message.error && !message.streaming && message.sourceQuestion ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xs }}><ForgeText variant="caption" tone="tertiary">这条回答有帮助吗？</ForgeText><View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}><Pressable accessibilityRole="button" accessibilityLabel={message.feedback === 'up' ? '已标记这条回答有帮助' : '标记这条回答有帮助'} accessibilityState={{ selected: message.feedback === 'up' }} onPress={() => onFeedback(message.id, 'up')} style={({ pressed }) => [{ minWidth: control.touch, minHeight: control.touch, alignItems: 'center', justifyContent: 'center', borderRadius: radius.small, backgroundColor: message.feedback === 'up' ? colors.activeSurface : colors.surface2 }, pressed && styles.pressed]}><Ionicons name={message.feedback === 'up' ? 'thumbs-up' : 'thumbs-up-outline'} size={16} color={message.feedback === 'up' ? colors.accent : colors.textSecondary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={message.feedback === 'down' ? '已标记这条回答需要改进' : '标记这条回答需要改进'} accessibilityState={{ selected: message.feedback === 'down' }} onPress={() => onFeedback(message.id, 'down')} style={({ pressed }) => [{ minWidth: control.touch, minHeight: control.touch, alignItems: 'center', justifyContent: 'center', borderRadius: radius.small, backgroundColor: message.feedback === 'down' ? colors.surfacePressed : colors.surface2 }, pressed && styles.pressed]}><Ionicons name={message.feedback === 'down' ? 'thumbs-down' : 'thumbs-down-outline'} size={16} color={message.feedback === 'down' ? colors.warning : colors.textSecondary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="重新生成这条回答" onPress={() => onRegenerate(message)} style={({ pressed }) => [{ minHeight: control.touch, paddingHorizontal: spacing.sm, borderRadius: radius.small, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface2 }, pressed && styles.pressed]}><Ionicons name="refresh-outline" size={15} color={colors.accent} /><ForgeText variant="caption" tone="accent">重新生成</ForgeText></Pressable></View></View> : null}</View></View></View>;
}

function FoodProposalCard({ proposal }: { proposal: FoodProposal }) {
  const confidenceLabel = proposal.confidence === 'high' ? '较高' : proposal.confidence === 'low' ? '较低' : '中等';
  return <View style={styles.foodProposal}><View style={styles.foodProposalHeader}><ForgeText variant="label" tone="accent">食物营养分析 · 待确认</ForgeText><ForgeText variant="caption" tone="tertiary">可信度 {confidenceLabel}</ForgeText></View><ForgeText variant="h3">{proposal.foodName}</ForgeText><ForgeText variant="caption" tone="secondary">每 100g 营养基准 · 每次参考份量 {proposal.typicalServingGrams ? proposal.typicalServingGrams + 'g' : '待确认'}</ForgeText><View style={styles.foodMacroRow}><ForgeText variant="caption">热量 {proposal.caloriesPer100g} kcal / 100g</ForgeText><ForgeText variant="caption">P {proposal.protein}g</ForgeText><ForgeText variant="caption">C {proposal.carbs}g</ForgeText><ForgeText variant="caption">F {proposal.fat}g</ForgeText></View><ForgeText variant="caption" tone="tertiary">{proposal.basis || '基于大模型营养知识和常见食物组成分析；确认前不会写入食物池。'}</ForgeText></View>;
}

function CoachPlanCard({ plan }: { plan: CoachPlan }) {
  return <View style={styles.planCard}><View style={styles.planHeader}><ForgeText variant="label" tone="accent">{plan.hasWorkout ? '今日执行建议' : '今日饮食建议'}</ForgeText><ForgeText variant="caption" tone="tertiary">状态 {plan.readiness}</ForgeText></View>{plan.hasWorkout ? <View style={styles.planRow}><View style={styles.planIcon}><Ionicons name="barbell-outline" size={17} color={colors.textSecondary} /></View><View style={styles.planCopy}><ForgeText variant="h3">{plan.workoutTitle}</ForgeText><ForgeText variant="caption" tone="secondary">{plan.workoutMeta}</ForgeText></View></View> : null}<View style={styles.planRow}><View style={styles.planIcon}><Ionicons name="restaurant-outline" size={17} color={colors.textSecondary} /></View><View style={styles.planCopy}><ForgeText variant="h3">{plan.nutritionCalories}</ForgeText><ForgeText variant="caption" tone="secondary">{plan.nutritionMeta}</ForgeText></View></View>{plan.mealPlan?.length ? <View style={styles.mealPlanPreview}><ForgeText variant="label" tone="accent">逐餐饮食计划</ForgeText>{plan.mealPlan.map((item, index) => <ForgeText key={item.meal + item.foodName + index} variant="caption" tone="secondary">{item.meal} · {item.foodName} · {item.serving}</ForgeText>)}</View> : null}</View>;
}

function ContextTag({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) { return <View style={styles.contextTag}><Ionicons name={icon} size={14} color={colors.textSecondary} /><ForgeText variant="caption" tone="secondary" numberOfLines={1}>{label}</ForgeText></View>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, scroll: { flex: 1 }, scrollToBottomButton: { position: 'absolute', right: spacing.lg, width: 44, height: 44, borderRadius: radius.round, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4, zIndex: 10 }, content: { paddingHorizontal: spacing.lg, gap: spacing.md }, header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md }, headerCopy: { flex: 1, gap: spacing.xxs }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxs },
  contextBar: { minHeight: 64, padding: spacing.sm, borderRadius: radius.medium, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSubtle, backgroundColor: colors.surface1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, contextIcon: { width: 36, height: 36, borderRadius: radius.small, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' }, contextCopy: { flex: 1, gap: 2 }, contextDetail: { marginTop: -spacing.xs, gap: spacing.sm, backgroundColor: colors.surface1 }, contextTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, contextTag: { minHeight: 32, paddingHorizontal: spacing.sm, borderRadius: radius.round, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, backgroundRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, backgroundCopy: { flex: 1, gap: 2 }, unavailablePill: { minHeight: 32, paddingHorizontal: spacing.sm, borderRadius: radius.round, backgroundColor: colors.surface2, justifyContent: 'center' },
  conversationBar: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs }, conversationSelector: { flex: 1, minHeight: 56, padding: spacing.sm, borderRadius: radius.medium, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSubtle, backgroundColor: colors.surface1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, conversationSelectorCopy: { flex: 1, gap: 2 }, newConversationButton: { minHeight: 56, paddingHorizontal: spacing.sm, borderRadius: radius.medium, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }, conversationSheet: { margin: spacing.lg, marginTop: spacing.xl, maxHeight: '82%', padding: spacing.lg, borderRadius: radius.medium, backgroundColor: colors.elevated, gap: spacing.md }, conversationSheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm }, conversationList: { flexGrow: 0 }, conversationRow: { padding: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface1, marginBottom: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, conversationRowActive: { borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.activeSurface }, conversationRowMain: { flex: 1, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, conversationRowCopy: { flex: 1, gap: 2 }, conversationRowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, conversationMiniAction: { minWidth: control.touch, minHeight: control.touch, alignItems: 'center', justifyContent: 'center', borderRadius: radius.small }, renameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, renameInput: { flex: 1, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, fontSize: 15 }, renameSave: { minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.small, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, renameCancel: { minHeight: 44, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center' },
  listHeader: { gap: spacing.md }, listFooter: { gap: spacing.sm }, historyTools: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, historySearchInput: { flex: 1, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, fontSize: 14 }, historyIconAction: { minWidth: control.touch, minHeight: control.touch, borderRadius: radius.small, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, historyAction: { minHeight: control.touch, paddingHorizontal: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }, messageSeparator: { height: spacing.sm }, dateLabel: { alignSelf: 'center', marginVertical: spacing.xs }, dateDivider: { alignSelf: 'center', marginVertical: spacing.xs }, messageWrap: { alignItems: 'flex-start' }, messageWrapUser: { alignItems: 'flex-end' }, message: { maxWidth: '92%', padding: spacing.md, borderRadius: radius.medium, borderCurve: 'continuous', gap: spacing.xs }, coachMessage: { backgroundColor: colors.surface1, borderLeftWidth: 2, borderLeftColor: colors.accent }, userMessage: { backgroundColor: colors.accentMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent, maxWidth: '84%' }, messageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, messageHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, messageDelete: { minWidth: control.touch, minHeight: control.touch, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center' }, messageBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, messageText: { fontSize: 16, lineHeight: 24 }, messageDetail: { marginTop: spacing.xs }, messageActions: { gap: spacing.xs, marginTop: spacing.xs }, messageAction: { minHeight: control.touch, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2 }, messageActionDone: { backgroundColor: colors.activeSurface }, planCard: { marginTop: spacing.xs, padding: spacing.sm, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface2, gap: spacing.sm }, planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, planRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, planIcon: { width: 32, height: 32, borderRadius: radius.small, backgroundColor: colors.surface1, alignItems: 'center', justifyContent: 'center' }, planCopy: { flex: 1, gap: 2 }, mealPlanPreview: { gap: 3, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle }, typing: { minHeight: 44, alignSelf: 'flex-start', paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestions: { gap: spacing.xs, marginTop: spacing.xs }, suggestionList: { gap: spacing.xs }, suggestion: { minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scrim: { flex: 1, justifyContent: 'center', backgroundColor: colors.scrim },  foodProposal: { marginTop: spacing.xs, padding: spacing.sm, borderRadius: radius.small, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.activeSurface, gap: spacing.xs }, foodProposalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, foodMacroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, foodEditSheet: { margin: spacing.lg, padding: spacing.lg, gap: spacing.md, borderRadius: radius.medium, backgroundColor: colors.elevated }, foodEditInput: { minHeight: 46, paddingHorizontal: spacing.sm, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, fontSize: 15 }, foodEditGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, foodEditField: { width: '48%', gap: spacing.xs }, foodEditActions: { flexDirection: 'row', gap: spacing.sm }, foodEditPrimary: { minHeight: 48, flex: 1, borderRadius: radius.small, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, confirmSheet: { margin: spacing.lg, padding: spacing.lg, gap: spacing.md, borderRadius: radius.medium, backgroundColor: colors.elevated }, confirmActions: { flexDirection: 'row', gap: spacing.sm }, secondaryConfirm: { minHeight: 48, flex: 1, borderRadius: radius.small, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, dangerConfirm: { minHeight: 48, flex: 1, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' }, composerArea: { paddingTop: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle, gap: spacing.xs }, composerLabel: { paddingLeft: spacing.xs }, composer: { minHeight: 54, paddingLeft: spacing.md, paddingRight: spacing.xs, borderRadius: radius.large, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, input: { flex: 1, minHeight: 44, maxHeight: 88, paddingVertical: spacing.xs, color: colors.textPrimary, fontSize: 15, lineHeight: 21, outlineStyle: 'none' as never }, voiceButton: { width: 44, height: 44, borderRadius: radius.round, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, sendButton: { width: 44, height: 44, borderRadius: radius.round, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, sendButtonDisabled: { backgroundColor: colors.surface2 }, voiceArea: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surface1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: spacing.md }, voiceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, voiceClose: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, voiceUnavailable: { minHeight: 120, padding: spacing.md, borderRadius: radius.medium, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, voiceCancel: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm, alignSelf: 'center' }, voiceSheet: { margin: spacing.lg, padding: spacing.lg, gap: spacing.md, borderRadius: radius.medium, backgroundColor: colors.elevated }, voiceTimer: { textAlign: 'center', paddingVertical: spacing.md }, voiceAction: { minHeight: 52, borderRadius: radius.small, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, voiceCancelAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, disclaimer: { paddingHorizontal: spacing.xs }, pressed: { opacity: 0.68 },
});
