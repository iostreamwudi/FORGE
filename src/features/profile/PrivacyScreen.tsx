import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ForgeButton, ForgeCard, ForgeIconButton, ForgeScreen, ForgeText, colors, radius, spacing } from '@/design-system';
import { requestAccountDeletion, requestAccountSessions, requestCoachAudit, requestDataExport, requestDataExportHistory, requestDataExportStatus, requestEmailChange, requestEmailVerification, requestPrivacyPolicy, revokeAccountSession, revokeDataExport, revokeOtherAccountSessions, type AccountSession, type CoachAuditEvent, type DataExportJob, type DataExportResult, type PrivacyPolicy } from '@/data/authClient';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';
import { formatLocalizedDateTime, formatRelativeTime } from '@/utils/date';

type Action = 'export' | 'export-status' | 'delete' | 'email-verification' | 'email-change' | null;
function auditDate(value: string) { return formatRelativeTime(value, '时间未知'); }
function auditAccessibilityDate(value: string) { return formatLocalizedDateTime(value, '时间未知'); }
function auditLabel(event: CoachAuditEvent) { if (event.eventType === 'consent_granted') return '已允许 Coach 使用数据'; if (event.eventType === 'consent_revoked') return '已撤销 Coach 数据授权'; if (event.eventType === 'request_started') return '已发起 Coach 请求'; if (event.eventType === 'context_sent') return '已向服务端发送授权上下文'; if (event.eventType === 'history_deleted') return '已清除全部 Coach 历史'; if (event.eventType === 'history_message_deleted') return '已删除单条 Coach 对话'; return 'Coach 数据事件：' + event.eventType; }
function exportDate(value?: string) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
function policyDate(value?: string) {
  if (!value) return '未记录';
  const raw = value.trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T00:00:00' : raw);
  if (Number.isNaN(date.getTime())) return '未记录';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}
function exportStatusLabel(job: DataExportJob) { if (job.downloadedAt) return '已下载'; if (job.status === 'ready') return '可下载'; if (job.status === 'failed') return '生成失败'; if (job.status === 'revoked') return '已撤销'; if (job.status === 'expired') return '已过期'; return '处理中'; }
function retryAfterSeconds(error: unknown) { const value = error instanceof Error ? (error as Error & { retryAfterSeconds?: unknown }).retryAfterSeconds : undefined; return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : null; }

export function PrivacyScreen() {
  const appState = useForgeAppState();
  const actions = useForgeAppActions();
  const [action, setAction] = useState<Action>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<'success' | 'error'>('error');
  const [exportResult, setExportResult] = useState<DataExportResult | null>(null);
  const [exportHistory, setExportHistory] = useState<DataExportJob[]>([]);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [auditEvents, setAuditEvents] = useState<CoachAuditEvent[]>([]);
  const [auditState, setAuditState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionState, setSessionState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [failedAction, setFailedAction] = useState<Exclude<Action, null> | null>(null);
  const [privacyPolicy, setPrivacyPolicy] = useState<PrivacyPolicy | null>(null);
  const [policyState, setPolicyState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [emailVerificationBlockedUntil, setEmailVerificationBlockedUntil] = useState<number | null>(null);
  const [failedExportOpenUrl, setFailedExportOpenUrl] = useState<string | null>(null);
  const [policyExpanded, setPolicyExpanded] = useState(false);
  const [emailChangeOpen, setEmailChangeOpen] = useState(false);
  const [emailChangeEmail, setEmailChangeEmail] = useState('');
  const [emailChangePassword, setEmailChangePassword] = useState('');
  const [emailChangeTouched, setEmailChangeTouched] = useState(false);
  const [showEmailChangePassword, setShowEmailChangePassword] = useState(false);
  const [emailChangeFocusedField, setEmailChangeFocusedField] = useState<'email' | 'password' | null>(null);
  const emailChangePasswordInputRef = useRef<TextInput>(null);
  const refreshHistory = useCallback(async () => {
    if (!appState.authSession) { setExportHistory([]); setHistoryState('idle'); return; }
    setHistoryState('loading');
    try { setExportHistory(await requestDataExportHistory(appState.authSession.accessToken)); setHistoryState('ready'); } catch { setHistoryState('error'); }
  }, [appState.authSession]);
  useEffect(() => {
    if (emailVerificationBlockedUntil === null) return undefined;
    const remaining = Math.max(0, emailVerificationBlockedUntil - Date.now());
    const timer = setTimeout(() => setEmailVerificationBlockedUntil(null), remaining);
    return () => clearTimeout(timer);
  }, [emailVerificationBlockedUntil]);

  useEffect(() => { const timer = setTimeout(() => { void refreshHistory(); }, 0); return () => clearTimeout(timer); }, [refreshHistory]);
  const refreshPrivacyPolicy = useCallback(async () => {
    if (!appState.authSession) { setPolicyState('idle'); return; }
    setPolicyState('loading');
    try {
      setPrivacyPolicy(await requestPrivacyPolicy(appState.authSession.accessToken));
      setPolicyState('ready');
    } catch {
      setPolicyState('error');
    }
  }, [appState.authSession]);
  useEffect(() => { const timer = setTimeout(() => { void refreshPrivacyPolicy(); }, 0); return () => clearTimeout(timer); }, [refreshPrivacyPolicy]);
  const refreshAudit = useCallback(async (cursor?: string) => {
    if (!appState.authSession) { setAuditEvents([]); setAuditCursor(null); setAuditState('idle'); return; }
    setAuditState('loading');
    try {
      const result = await requestCoachAudit(appState.authSession.accessToken, { cursor, limit: 50 });
      setAuditEvents((current) => cursor ? [...current, ...result.events] : result.events);
      setAuditCursor(result.nextCursor);
      setAuditState('ready');
    } catch { setAuditState('error'); }
  }, [appState.authSession]);
  useEffect(() => { const timer = setTimeout(() => { void refreshAudit(); }, 0); return () => clearTimeout(timer); }, [refreshAudit]);
  const refreshSessions = useCallback(async () => {
    if (!appState.authSession) { setSessions([]); setSessionState('idle'); return; }
    setSessionState('loading');
    try { setSessions(await requestAccountSessions(appState.authSession.accessToken)); setSessionState('ready'); } catch { setSessionState('error'); }
  }, [appState.authSession]);
  useEffect(() => { const timer = setTimeout(() => { void refreshSessions(); }, 0); return () => clearTimeout(timer); }, [refreshSessions]);
  const revokeSession = (session: AccountSession) => {
    if (!appState.authSession || session.current || sessionState === 'loading') return;
    Alert.alert('撤销登录会话？', '撤销后该设备需要重新登录才能访问 FORGE。', [{ text: '取消', style: 'cancel' }, { text: '撤销会话', style: 'destructive', onPress: () => { setSessionState('loading'); void revokeAccountSession(appState.authSession?.accessToken ?? '', session.id).then(() => { setSessions((current) => current.filter((item) => item.id !== session.id)); actions.showToast('登录会话已撤销'); }).catch(() => actions.showToast('会话撤销失败，请稍后重试')).finally(() => setSessionState('ready')); } }]);
  };
  const revokeOtherSessions = () => {
    if (!appState.authSession || sessionState === 'loading') return;
    Alert.alert('撤销其他所有设备？', '当前设备会保留登录，其他设备会立即失效并需要重新登录。这个操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      { text: '继续撤销', style: 'destructive', onPress: () => {
        setSessionState('loading');
        void revokeOtherAccountSessions(appState.authSession?.accessToken ?? '').then((result) => {
          setSessions((current) => current.filter((item) => item.current));
          if (result.revokedCount > 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          actions.showToast(result.revokedCount > 0 ? '已撤销其他设备的登录会话' : '没有其他活跃设备会话');
          setSessionState('ready');
        }).catch(() => {
          setSessionState('error');
          actions.showToast('其他设备会话撤销失败，请重试');
        });
      } },
    ]);
  };

  const resendEmailVerification = async () => {
    if (!appState.authSession || appState.profile.emailVerified || (emailVerificationBlockedUntil !== null)) return;
    setAction('email-verification'); setFeedback(null); setFeedbackKind('error'); setFailedAction(null);
    try {
      await requestEmailVerification(appState.authSession.accessToken);
      setFeedbackKind('success');
      setFeedback('验证邮件已提交到服务端，请检查收件箱；链接 24 小时内有效。');
      actions.showToast('验证邮件已提交');
    } catch (error: unknown) {
      const retryAfter = retryAfterSeconds(error);
      if (retryAfter !== null) setEmailVerificationBlockedUntil(Date.now() + retryAfter * 1000);
      const message = retryAfter !== null ? '验证邮件请求过于频繁，请稍后再试。' : error instanceof Error && error.message === 'AUTH_SERVICE_UNCONFIGURED' ? '账号服务尚未连接，未伪造验证邮件。' : error instanceof Error && error.message === 'EMAIL_VERIFICATION_DELIVERY_UNCONFIGURED' ? '邮箱验证服务尚未配置邮件投递。' : '验证邮件发送失败，请稍后重试。';
      setFeedback(message); setFeedbackKind('error');
    } finally { setAction(null); }
  };

  const requestEmailChangeAction = async () => {
    if (!appState.authSession) return;
    const newEmail = emailChangeEmail.trim().toLowerCase();
    setEmailChangeTouched(true);
    if (!newEmail || !newEmail.includes('@') || !newEmail.includes('.') || emailChangePassword.length < 6) {
      setFeedback('请输入有效的新邮箱和当前密码。'); setFeedbackKind('error'); return;
    }
    Keyboard.dismiss(); setAction('email-change'); setFeedback(null); setFeedbackKind('error'); setFailedAction(null);
    try {
      const result = await requestEmailChange(appState.authSession.accessToken, newEmail, emailChangePassword);
      setEmailChangeOpen(false); setEmailChangePassword(''); setFeedbackKind('success'); setFeedback('验证邮件已发送到 ' + result.email + '，请完成验证后新邮箱才会生效；验证链接 24 小时内有效。'); actions.showToast('更换邮箱验证邮件已发送');
    } catch (error: unknown) {
      const retryAfter = retryAfterSeconds(error);
      const message = retryAfter !== null ? '更换邮箱请求过于频繁，请稍后再试。' : error instanceof Error && error.message === 'CURRENT_PASSWORD_INVALID' ? '当前密码不正确，请重新输入。' : error instanceof Error && error.message === 'EMAIL_ALREADY_IN_USE' ? '该邮箱已经被其他账户使用。' : error instanceof Error && error.message === 'EMAIL_VERIFICATION_DELIVERY_UNCONFIGURED' ? '邮箱验证服务尚未配置邮件投递。' : '更换邮箱验证邮件发送失败，请稍后重试。';
      setFeedback(message); setFeedbackKind('error');
    } finally { setAction(null); }
  };

  const runExport = async () => {
    if (!appState.authSession) { setFeedback('请先登录，FORGE 不会伪造导出结果。'); setFeedbackKind('error'); setFailedAction(null); return; }
    setAction('export'); setFeedback(null); setFeedbackKind('error'); setExportResult(null); setFailedAction(null);
    try {
      const result = await requestDataExport(appState.authSession.accessToken);
      setExportResult(result);
      void refreshHistory();
      if (result.status === 'failed') { setFeedbackKind('error'); setFeedback('服务端生成导出文件失败，请重试。'); setFailedAction('export'); actions.showToast('导出失败'); return; }
      setFeedbackKind('success');
      const readyWithoutDelivery = result.status === 'ready' && !result.downloadUrl;
      setFeedback(result.downloadUrl ? '服务端已准备好导出文件，可在下方打开。' : readyWithoutDelivery ? '导出文件已生成，但服务端尚未配置 HTTPS 下载地址，请联系管理员完成发布配置。' : result.jobId ? `导出请求已排队，任务号：${result.jobId}` : '导出请求已提交，请等待服务端处理。');
      actions.showToast(result.downloadUrl ? '导出文件已准备好' : readyWithoutDelivery ? '导出文件已生成' : '导出请求已提交');
    } catch (error: unknown) { setFeedback(error instanceof Error && error.message === 'AUTH_SERVICE_UNCONFIGURED' ? '账号服务尚未连接，未伪造导出结果。' : error instanceof Error && error.message === 'DATA_EXPORT_RESPONSE_INVALID' ? '服务端返回的导出信息无效，未显示或打开不可信地址。' : '数据导出请求失败，请稍后重试。'); setFeedbackKind('error'); setFailedAction('export'); } finally { setAction(null); }
  };
  const runDelete = async () => {
    if (!appState.authSession) { setFeedback('请先登录，FORGE 不会伪造删除结果。'); setFailedAction(null); return; }
    setDeleteOpen(false); setAction('delete'); setFeedback(null); setFeedbackKind('error'); setExportResult(null); setFailedAction(null);
    try { await requestAccountDeletion(appState.authSession.accessToken); actions.signOut(); } catch (error: unknown) { setFeedback(error instanceof Error && error.message === 'AUTH_SERVICE_UNCONFIGURED' ? '账号服务尚未连接，未伪造删除结果。' : '账号删除失败，账户仍然保留。'); setFailedAction('delete'); } finally { setAction(null); }
  };
  const checkExport = async () => {
    if (!appState.authSession || !exportResult?.jobId) return;
    setAction('export-status'); setFeedback(null); setFeedbackKind('error'); setFailedAction(null);
    try {
      const result = await requestDataExportStatus(appState.authSession.accessToken, exportResult.jobId);
      setExportResult((current) => ({ ...current, ...result }));
      void refreshHistory();
      if (result.status === 'ready' && result.downloadUrl) { setFeedbackKind('success'); setFeedback('服务端已准备好导出文件，可在下方打开。'); actions.showToast('导出文件已准备好'); }
      else if (result.status === 'failed') { setFeedback('服务端处理导出失败，请重新发起导出请求。'); setFailedAction('export'); }
      else if (result.status === 'ready') { setFeedbackKind('success'); setFeedback('导出文件已生成，但服务端尚未配置 HTTPS 下载地址，请联系管理员完成发布配置。'); }
      else { setFeedbackKind('success'); setFeedback('导出仍在服务端处理中，请稍后再次查询。'); }
    } catch (error: unknown) { setFeedback(error instanceof Error && error.message === 'DATA_EXPORT_RESPONSE_INVALID' ? '服务端返回的导出状态无效，未打开不可信地址。' : '查询导出状态失败，请稍后重试。'); setFeedbackKind('error'); setFailedAction('export-status'); } finally { setAction(null); }
  };
  const retry = () => { if (failedAction === 'export') void runExport(); else if (failedAction === 'export-status') void checkExport(); else if (failedAction === 'delete') setDeleteOpen(true); };
  const revokeExport = (job: DataExportJob) => {
    if (!appState.authSession || job.status !== 'ready' || job.downloadedAt) return;
    Alert.alert('撤销导出文件？', '撤销后该导出文件将被删除，之后不能再下载。', [{ text: '取消', style: 'cancel' }, { text: '撤销并删除', style: 'destructive', onPress: () => { setAction('export-status'); void revokeDataExport(appState.authSession?.accessToken ?? '', job.jobId).then(() => { setFeedbackKind('success'); setFeedback('导出文件已撤销并删除。'); void refreshHistory(); }).catch(() => { setFeedbackKind('error'); setFeedback('撤销导出失败，请稍后重试。'); }).finally(() => setAction(null)); } }]);
  };
  const openExport = async () => {
    if (!exportResult?.downloadUrl) return;
    try { setFailedExportOpenUrl(null); await Linking.openURL(exportResult.downloadUrl); } catch { setFailedExportOpenUrl(exportResult.downloadUrl); setFeedback('设备无法打开导出文件地址，请稍后重试；导出请求本身仍已提交。'); setFeedbackKind('error'); }
  };
  return <ForgeScreen contentStyle={styles.content}>
    <View style={styles.header}><ForgeIconButton icon="chevron-back" label="返回我的" onPress={() => router.back()} variant="ghost" /><View style={styles.headerCopy}><ForgeText variant="title">数据与隐私</ForgeText><ForgeText tone="secondary">了解数据在哪里，并保留控制权。</ForgeText></View></View>
    <ForgeCard style={styles.card}><ForgeText variant="h3">当前设备数据</ForgeText><ForgeText tone="secondary">本地记录：{appState.completedSessions.length} 次训练、{appState.foodEntries.length} 条饮食、{appState.foods.length} 项食物。</ForgeText><ForgeText variant="caption" tone="tertiary">导出和删除账号需要已登录并连接 FORGE 服务端；服务未配置时不会显示虚假的成功结果。</ForgeText></ForgeCard>
    {appState.authSession && policyState === 'loading' ? <ForgeCard style={styles.card}><ForgeText variant="h3">隐私说明</ForgeText><ForgeText tone="secondary">正在读取服务端隐私策略…</ForgeText></ForgeCard> : null}
    {appState.authSession && policyState === 'error' ? <ForgeCard style={styles.card}><ForgeText variant="h3">隐私说明暂时不可用</ForgeText><ForgeText variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="assertive">服务端隐私策略暂时无法读取，未显示未经确认的保留期限或数据范围。</ForgeText><ForgeButton label="重试读取隐私策略" variant="secondary" onPress={() => void refreshPrivacyPolicy()} /></ForgeCard> : null}
    {appState.authSession && privacyPolicy ? <ForgeCard style={styles.card}><ForgeText variant="h3">隐私说明</ForgeText><ForgeText variant="caption" tone="tertiary">政策版本 {privacyPolicy.version} · 生效日期 {policyDate(privacyPolicy.effectiveAt)}</ForgeText><ForgeText variant="caption" tone="secondary">安全活动记录保留 {privacyPolicy.securityAuditRetentionDays} 天，之后由服务端自动清理。你的数据导出包含安全活动记录；成功删除账户时会一并删除安全活动、MFA、邮箱验证、Coach 和导出文件等关联数据。</ForgeText><ForgeText variant="caption" tone="tertiary">{privacyPolicy.healthDataStoredServerSide ? '健康数据会存储在服务端。' : '健康数据不会由 FORGE 服务端保存；App 只在获得系统权限后读取本机健康数据。'}</ForgeText><Pressable accessibilityRole="button" accessibilityState={{ expanded: policyExpanded }} accessibilityLabel="查看完整隐私政策" onPress={() => setPolicyExpanded((current) => !current)} style={({ pressed }) => [styles.policyToggle, pressed && { opacity: 0.72 }]}><ForgeText variant="label" tone="accent">{policyExpanded ? '收起完整政策' : '查看完整政策'}</ForgeText></Pressable>{policyExpanded ? <View style={styles.policySections}>{privacyPolicy.sections.map((section) => <View key={section.id} style={styles.policySection}><ForgeText variant="label" accessibilityRole="header">{section.title}</ForgeText><ForgeText variant="caption" tone="secondary">{section.body}</ForgeText></View>)}</View> : null}</ForgeCard> : null}
    <ForgeCard style={styles.card}><ForgeText variant="h3">账户数据控制</ForgeText><ForgeButton label="请求导出我的数据" variant="secondary" loading={action === 'export'} disabled={action !== null} onPress={runExport} /><ForgeText variant="caption" tone="secondary">服务端会按账户权限处理导出请求；客户端只会打开服务端返回的 HTTPS 文件地址。</ForgeText><ForgeText variant="caption" tone={appState.profile.emailVerified ? 'secondary' : 'danger'}>{appState.profile.emailVerified ? '邮箱已验证。' : '邮箱尚未验证，验证邮件由真实账号服务投递。'}</ForgeText>{appState.authSession && !appState.profile.emailVerified ? <ForgeButton label={action === 'email-verification' ? '发送中…' : emailVerificationBlockedUntil !== null ? '暂时无法重发' : '重新发送验证邮件'} variant="secondary" loading={action === 'email-verification'} disabled={action !== null || (emailVerificationBlockedUntil !== null)} onPress={() => void resendEmailVerification()} /> : null}{feedback ? <View style={styles.feedback}><ForgeText variant="caption" tone={feedbackKind === 'success' ? 'secondary' : 'danger'} accessibilityLiveRegion="assertive">{feedback}</ForgeText>{exportResult?.jobId && !exportResult.downloadUrl && exportResult.status !== 'ready' ? <Pressable accessibilityRole="button" accessibilityLabel="查询导出任务状态" disabled={action !== null} onPress={() => void checkExport()} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">{action === 'export-status' ? '查询中…' : '查询导出状态'}</ForgeText></Pressable> : null}{exportResult?.downloadUrl ? <Pressable accessibilityRole="button" accessibilityLabel="打开导出文件" onPress={() => void openExport()} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">打开导出文件</ForgeText></Pressable> : null}{failedAction ? <Pressable accessibilityRole="button" accessibilityLabel={failedAction === 'export' ? '重试导出请求' : failedAction === 'export-status' ? '重试查询导出状态' : '再次确认并重试删除'} onPress={retry} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">{failedAction === 'export' ? '重试导出请求' : failedAction === 'export-status' ? '重试查询导出状态' : '再次确认并重试删除'}</ForgeText></Pressable> : null}{failedExportOpenUrl ? <Pressable accessibilityRole="button" accessibilityLabel="重试打开导出文件" onPress={() => { const url = failedExportOpenUrl; setFailedExportOpenUrl(null); void Linking.openURL(url).catch(() => { setFailedExportOpenUrl(url); setFeedback('设备仍无法打开这份导出文件，请稍后重试。'); setFeedbackKind('error'); }); }} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">重试打开导出文件</ForgeText></Pressable> : null}</View> : null}{appState.authSession ? <><Pressable accessibilityRole="button" accessibilityLabel="删除我的账户" disabled={action !== null} onPress={() => setDeleteOpen(true)} style={styles.deleteButton}><ForgeText variant="label" tone="danger">删除我的账户</ForgeText></Pressable><ForgeText variant="caption" tone="tertiary">删除前会再次确认；成功后会清理此设备上的本地账户数据。</ForgeText></> : null}</ForgeCard>
    {appState.authSession ? <ForgeCard style={styles.card}><ForgeText variant="h3">更换登录邮箱</ForgeText><ForgeText variant="caption" tone="secondary">输入当前密码后，FORGE 会向新邮箱发送真实验证链接。验证完成前，当前邮箱仍保持有效。</ForgeText><ForgeButton label="更换登录邮箱" variant="secondary" disabled={action !== null} onPress={() => { setEmailChangeEmail(''); setEmailChangePassword(''); setEmailChangeTouched(false); setShowEmailChangePassword(false); setEmailChangeFocusedField('email'); setEmailChangeOpen(true); }} /></ForgeCard> : null}
    {appState.authSession ? <ForgeCard style={styles.card}><View style={styles.historyHeader}><ForgeText variant="h3">导出历史</ForgeText><Pressable accessibilityRole="button" accessibilityLabel="刷新导出历史" disabled={historyState === 'loading'} onPress={() => void refreshHistory()} style={({ pressed }) => [styles.historyRefresh, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">{historyState === 'loading' ? '刷新中…' : '刷新'}</ForgeText></Pressable></View>{historyState === 'error' ? <ForgeText variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="assertive">导出历史暂时无法读取，请稍后重试。</ForgeText> : exportHistory.length ? exportHistory.map((job) => <View key={job.jobId} style={styles.historyItem}><View style={styles.historyCopy}><ForgeText variant="label">{exportStatusLabel(job)}</ForgeText><ForgeText variant="caption" tone="secondary">创建于 {exportDate(job.createdAt)} · {job.expiresAt ? `有效至 ${exportDate(job.expiresAt)}` : '有效期未记录'}</ForgeText></View>{job.downloadUrl ? <Pressable accessibilityRole="button" accessibilityLabel={`打开 ${job.jobId} 导出文件`} onPress={() => { const url = job.downloadUrl as string; setFailedExportOpenUrl(null); void Linking.openURL(url).catch(() => { setFailedExportOpenUrl(url); setFeedback('设备无法打开这份导出文件，请稍后重试；导出任务本身仍保持原状态。'); setFeedbackKind('error'); }); }} style={({ pressed }) => [styles.historyOpen, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">打开</ForgeText></Pressable> : null}{job.status === 'ready' && !job.downloadedAt ? <Pressable accessibilityRole="button" accessibilityLabel={`撤销 ${job.jobId} 导出文件`} onPress={() => revokeExport(job)} style={({ pressed }) => [styles.historyOpen, pressed && styles.pressed]}><ForgeText variant="label" tone="danger">撤销</ForgeText></Pressable> : null}</View>) : historyState === 'loading' ? <ForgeText tone="secondary">正在读取导出历史…</ForgeText> : <ForgeText tone="secondary">暂无导出记录。</ForgeText>}</ForgeCard> : null}
    {appState.authSession ? <ForgeCard style={styles.card}><View style={styles.historyHeader}><ForgeText variant="h3">登录设备与会话</ForgeText><Pressable accessibilityRole="button" accessibilityLabel="刷新登录会话" disabled={sessionState === 'loading'} onPress={() => void refreshSessions()} style={({ pressed }) => [styles.historyRefresh, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">{sessionState === 'loading' ? '刷新中…' : '刷新'}</ForgeText></Pressable></View><ForgeText variant="caption" tone="secondary">只显示当前账户的活跃登录会话；撤销其他设备后，该设备需要重新登录。</ForgeText><ForgeButton label={sessionState === 'loading' ? '撤销中…' : '撤销其他所有设备'} variant="secondary" disabled={sessionState === 'loading' || sessions.every((item) => item.current)} onPress={revokeOtherSessions} />{sessionState === 'error' ? <ForgeText variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="assertive">登录会话暂时无法读取，请稍后重试。</ForgeText> : sessions.length ? sessions.map((session) => <View key={session.id} style={styles.historyItem}><View style={styles.historyCopy}><ForgeText variant="label">{session.deviceLabel}</ForgeText><ForgeText variant="caption" tone="secondary">{session.current ? '当前设备' : '已登录设备'} · 登录于 {exportDate(session.createdAt)} · 最近活跃 {exportDate(session.lastSeenAt)} · 有效至 {exportDate(session.expiresAt)}</ForgeText></View>{session.current ? <ForgeText variant="caption" tone="accent">当前</ForgeText> : <Pressable accessibilityRole="button" accessibilityLabel="撤销该登录会话" disabled={sessionState === 'loading'} onPress={() => revokeSession(session)} style={({ pressed }) => [styles.historyOpen, pressed && styles.pressed]}><ForgeText variant="label" tone="danger">撤销</ForgeText></Pressable>}</View>) : sessionState === 'loading' ? <ForgeText tone="secondary">正在读取登录会话…</ForgeText> : <ForgeText tone="secondary">暂无活跃登录会话。</ForgeText>}</ForgeCard> : null}
    {appState.authSession ? <ForgeCard style={styles.card}><View style={styles.historyHeader}><ForgeText variant="h3">Coach 数据使用记录</ForgeText><Pressable accessibilityRole="button" accessibilityLabel="刷新 Coach 数据使用记录" disabled={auditState === 'loading'} onPress={() => void refreshAudit()} style={({ pressed }) => [styles.historyRefresh, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">{auditState === 'loading' ? '刷新中…' : '刷新'}</ForgeText></Pressable></View><ForgeText variant="caption" tone="secondary">这里显示你的授权、请求和历史删除事件；不会展示问题正文或个人训练内容。</ForgeText>{auditState === 'error' ? <ForgeText variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="assertive">Coach 数据使用记录暂时无法读取，请稍后重试。</ForgeText> : auditEvents.length ? auditEvents.map((event, index) => <View key={event.createdAt + '-' + event.eventType + '-' + index} style={styles.historyItem}><View style={styles.historyCopy}><ForgeText variant="label">{auditLabel(event)}</ForgeText><ForgeText variant="caption" tone="secondary" accessibilityLabel={'时间：' + auditAccessibilityDate(event.createdAt) + (event.contextSent ? '。已发送授权上下文' : '')}>{auditDate(event.createdAt)}{event.contextSent ? ' · 已发送授权上下文' : ''}</ForgeText></View></View>) : auditState === 'loading' ? <ForgeText tone="secondary">正在读取 Coach 数据使用记录…</ForgeText> : <ForgeText tone="secondary">暂无 Coach 数据使用记录。</ForgeText>}{auditCursor ? <Pressable accessibilityRole="button" accessibilityLabel="加载更多 Coach 数据使用记录" accessibilityState={{ busy: auditState === 'loading' }} disabled={auditState === 'loading'} onPress={() => void refreshAudit(auditCursor)} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">{auditState === 'loading' ? '加载中…' : '加载更多记录'}</ForgeText></Pressable> : null}</ForgeCard> : null}
    <Modal visible={emailChangeOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => { if (action !== 'email-change') setEmailChangeOpen(false); }} statusBarTranslucent><KeyboardAvoidingView style={styles.keyboardAvoiding} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><Pressable style={styles.scrim} onPress={() => { if (action !== 'email-change') setEmailChangeOpen(false); }}><Pressable style={styles.confirmSheet} onPress={(event) => event.stopPropagation()}><ForgeText variant="h3">更换登录邮箱</ForgeText><ForgeText tone="secondary">新邮箱需要点击真实邮件中的验证链接后才会生效，验证成功后所有已登录设备都会退出。</ForgeText><View style={styles.inputField}><TextInput accessibilityLabel="新邮箱" autoFocus returnKeyType="next" onSubmitEditing={() => emailChangePasswordInputRef.current?.focus()} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={emailChangeEmail} onChangeText={setEmailChangeEmail} onFocus={() => setEmailChangeFocusedField('email')} onBlur={() => { setEmailChangeTouched(true); setEmailChangeFocusedField(null); }} placeholder="name@example.com" placeholderTextColor={colors.textTertiary} style={[styles.modalInput, emailChangeFocusedField === 'email' && styles.inputFocused]} />{emailChangeTouched && (!emailChangeEmail.trim() || !emailChangeEmail.includes('@') || !emailChangeEmail.includes('.')) ? <ForgeText variant="caption" tone="danger" accessibilityRole="alert">请输入有效的新邮箱地址。</ForgeText> : null}</View><View style={styles.inputField}><View style={styles.inputRow}><TextInput ref={emailChangePasswordInputRef} accessibilityLabel="当前密码" returnKeyType="done" onSubmitEditing={() => void requestEmailChangeAction()} secureTextEntry={!showEmailChangePassword} autoCapitalize="none" value={emailChangePassword} onChangeText={setEmailChangePassword} onFocus={() => setEmailChangeFocusedField('password')} onBlur={() => { setEmailChangeTouched(true); setEmailChangeFocusedField(null); }} placeholder="当前密码" placeholderTextColor={colors.textTertiary} style={[styles.modalInput, styles.passwordInput, emailChangeFocusedField === 'password' && styles.inputFocused]} /><Pressable accessibilityRole="button" accessibilityLabel={showEmailChangePassword ? '隐藏当前密码' : '显示当前密码'} accessibilityState={{ checked: showEmailChangePassword }} onPress={() => setShowEmailChangePassword((current) => !current)} style={({ pressed }) => [styles.passwordToggle, pressed && styles.pressed]}><ForgeText variant="label" tone="accent">{showEmailChangePassword ? '隐藏' : '显示'}</ForgeText></Pressable></View>{emailChangeTouched && emailChangePassword.length < 6 ? <ForgeText variant="caption" tone="danger" accessibilityRole="alert">当前密码至少需要 6 个字符。</ForgeText> : null}</View><View style={styles.actions}><ForgeButton label="取消" variant="secondary" disabled={action === 'email-change'} onPress={() => setEmailChangeOpen(false)} /><ForgeButton label={action === 'email-change' ? '发送中…' : '发送验证邮件'} loading={action === 'email-change'} disabled={action === 'email-change'} onPress={() => void requestEmailChangeAction()} /></View></Pressable></Pressable></KeyboardAvoidingView></Modal>
    <Modal visible={deleteOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setDeleteOpen(false)} statusBarTranslucent><Pressable style={styles.scrim} onPress={() => setDeleteOpen(false)}><Pressable style={styles.confirmSheet} onPress={(event) => event.stopPropagation()}><ForgeText variant="h3">永久删除账户？</ForgeText><ForgeText tone="secondary">此操作会请求服务端删除账户数据，成功后无法恢复；本机数据也会清理。</ForgeText><View style={styles.actions}><ForgeButton label="取消" variant="secondary" onPress={() => setDeleteOpen(false)} /><Pressable accessibilityRole="button" accessibilityLabel="确认永久删除账户" onPress={runDelete} style={styles.deleteConfirm}><ForgeText variant="label" tone="danger">确认删除</ForgeText></Pressable></View></Pressable></Pressable></Modal>
  </ForgeScreen>;
}

const styles = StyleSheet.create({ content: { gap: spacing.lg }, keyboardAvoiding: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, headerCopy: { flex: 1, gap: spacing.xxs }, card: { gap: spacing.md, backgroundColor: colors.surface2 }, pressed: { opacity: 0.72 }, feedback: { gap: spacing.sm }, retry: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' }, historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, historyRefresh: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' }, historyItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, historyCopy: { flex: 1, gap: spacing.xxs }, historyOpen: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' }, deleteButton: { minHeight: 48, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' }, scrim: { flex: 1, justifyContent: 'center', backgroundColor: colors.scrim }, confirmSheet: { margin: spacing.lg, padding: spacing.lg, gap: spacing.md, borderRadius: radius.medium, backgroundColor: colors.elevated }, modalInput: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.small, paddingHorizontal: spacing.sm, color: colors.textPrimary, backgroundColor: colors.surface1 }, actions: { flexDirection: 'row', gap: spacing.sm }, deleteConfirm: { minHeight: 48, flex: 1, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' }, inputField: { gap: spacing.xs }, inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, passwordInput: { flex: 1 }, passwordToggle: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center' }, inputFocused: { borderColor: colors.accent, borderWidth: 1 }, policyToggle: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' }, policySections: { gap: spacing.md }, policySection: { gap: spacing.xs } });
