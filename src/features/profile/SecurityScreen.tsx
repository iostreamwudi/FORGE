import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { ForgeButton, ForgeCard, ForgeIconButton, ForgeScreen, ForgeText, colors, radius, spacing } from '@/design-system';
import { disableMfa, enableMfa, regenerateRecoveryCodes, requestMfaSetup, requestMfaStatus, requestRecoveryCodeStatus, requestSecurityAudit, revokeRecoveryCodes, type MfaSetup, type RecoveryCodeStatus, type SecurityAuditEvent } from '@/data/authClient';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';
import { formatLocalizedDateTime, formatRelativeTime } from '@/utils/date';

export function SecurityScreen() {
  const appState = useForgeAppState();
  const actions = useForgeAppActions();
  const [enabled, setEnabled] = useState(false);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryCodeStatus | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => appState.authSession ? 'loading' : 'ready');
  const [action, setAction] = useState<'setup' | 'enable' | 'disable' | null>(null);
  const [recoveryAction, setRecoveryAction] = useState<'regenerate' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<SecurityAuditEvent[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(() => Boolean(appState.authSession));
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    const session = appState.authSession;
    if (!session) {
      setAuditLoading(false);
      setState('ready');
      return;
    }
    let active = true;
    setState('loading');
    setAuditLoading(true);
    setAuditError(null);
    setError(null);
    void Promise.allSettled([
      requestMfaStatus(session.accessToken),
      requestRecoveryCodeStatus(session.accessToken),
      requestSecurityAudit(session.accessToken, { limit: 20 }),
    ]).then(([mfaResult, recoveryResult, auditResult]) => {
      if (!active) return;
      let coreError = false;
      if (mfaResult.status === 'fulfilled') setEnabled(mfaResult.value.enabled);
      else coreError = true;
      if (recoveryResult.status === 'fulfilled') setRecoveryStatus(recoveryResult.value);
      else coreError = true;
      if (auditResult.status === 'fulfilled') {
        setAuditEvents(auditResult.value.events);
        setAuditCursor(auditResult.value.nextCursor);
        setAuditError(null);
      } else {
        setAuditEvents([]);
        setAuditCursor(null);
        setAuditError('安全活动暂时无法读取，请稍后重试。');
      }
      setAuditLoading(false);
      setState(coreError ? 'error' : 'ready');
      if (coreError) setError('双重验证状态暂时无法读取，请稍后重试。');
    });
    return () => { active = false; };
  }, [appState.authSession?.accessToken]);

  const beginSetup = async () => {
    if (!appState.authSession) return;
    setAction('setup'); setError(null);
    try {
      setSetup(await requestMfaSetup(appState.authSession.accessToken));
      setCode('');
    } catch (requestError: unknown) {
      setError(requestError instanceof Error && requestError.message === 'MFA_ALREADY_ENABLED' ? '双重验证已经启用。' : '无法开始双重验证设置，请稍后重试。');
    } finally { setAction(null); }
  };

  const copyOtpAuthUri = async () => {
    if (!setup?.otpauthUri) return;
    await Clipboard.setStringAsync(setup.otpauthUri);
    actions.showToast('系统验证器导入链接已复制');
  };

  const confirmSetup = async () => {
    if (!appState.authSession || !setup) return;
    if (!/^\d{6}$/.test(code.trim())) { setError('请输入验证器中的 6 位验证码。'); return; }
    setAction('enable'); setError(null);
    try {
      const result = await enableMfa(appState.authSession.accessToken, code.trim());
      setEnabled(true);
      setSetup(null);
      setCode('');
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryStatus({ total: result.recoveryCodes.length, remaining: result.recoveryCodes.length });
      actions.showToast('双重验证已启用');
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message === 'MFA_SETUP_EXPIRED' ? '设置已过期，请重新开始。' : '验证码不正确，请检查验证器时间后重试。' : '双重验证启用失败，请稍后重试。');
    } finally { setAction(null); }
  };

  const refreshAudit = async () => {
    if (!appState.authSession || auditLoading) return;
    setAuditLoading(true);
    setAuditError(null);
    try {
      const result = await requestSecurityAudit(appState.authSession.accessToken, { limit: 20 });
      setAuditEvents(result.events);
      setAuditCursor(result.nextCursor);
    } catch {
      setAuditError('安全活动暂时无法读取，请稍后重试。');
    } finally {
      setAuditLoading(false);
    }
  };

  const loadMoreAudit = async () => {
    if (!appState.authSession || !auditCursor || auditLoading) return;
    setAuditLoading(true);
    setAuditError(null);
    try {
      const result = await requestSecurityAudit(appState.authSession.accessToken, { cursor: auditCursor, limit: 20 });
      setAuditEvents((current) => [...current, ...result.events]);
      setAuditCursor(result.nextCursor);
    } catch {
      setAuditError('更多安全活动暂时无法读取，请稍后重试。');
    } finally {
      setAuditLoading(false);
    }
  };

  const performRegenerateRecoveryCodes = async () => {
    if (!appState.authSession) return;
    if (!/^\d{6}$/.test(recoveryCode.trim())) { setError('请输入当前验证器中的 6 位验证码。'); return; }
    setRecoveryAction('regenerate'); setError(null);
    try {
      const nextCodes = await regenerateRecoveryCodes(appState.authSession.accessToken, recoveryCode.trim());
      setRecoveryCodes(nextCodes);
      setRecoveryStatus({ total: nextCodes.length, remaining: nextCodes.length });
      setRecoveryCode('');
      actions.showToast('恢复码已重新生成，旧恢复码已失效');
    } catch {
      setError('验证码不正确，恢复码未更新。');
    } finally { setRecoveryAction(null); }
  };

  const confirmRevokeRecoveryCodes = () => {
    if (!appState.authSession || !recoveryStatus?.remaining) return;
    Alert.alert('撤销全部恢复码？', '撤销后，所有未使用恢复码都会立即失效。你仍可使用验证器代码登录。请输入当前验证器代码确认。', [
      { text: '取消', style: 'cancel' },
      { text: '继续撤销', style: 'destructive', onPress: () => void performRevokeRecoveryCodes() },
    ]);
  };

  const performRevokeRecoveryCodes = async () => {
    if (!appState.authSession) return;
    if (!/^\d{6}$/.test(recoveryCode.trim())) { setError('请输入当前验证器中的 6 位验证码。'); return; }
    setRecoveryAction('revoke'); setError(null);
    try {
      await revokeRecoveryCodes(appState.authSession.accessToken, recoveryCode.trim());
      setRecoveryCodes([]);
      setRecoveryStatus((current) => current ? { ...current, remaining: 0 } : current);
      setRecoveryCode('');
      actions.showToast('恢复码已全部撤销');
    } catch {
      setError('验证码不正确，恢复码仍保持有效。');
    } finally { setRecoveryAction(null); }
  };

  const confirmDisable = () => {
    if (!appState.authSession || !enabled) return;
    Alert.alert('关闭双重验证？', '关闭后，账户登录只需要密码。请输入当前验证器代码确认。', [
      { text: '取消', style: 'cancel' },
      { text: '继续关闭', style: 'destructive', onPress: () => void performDisable() },
    ]);
  };

  const performDisable = async () => {
    if (!appState.authSession) return;
    if (!/^\d{6}$/.test(code.trim())) { setError('请输入当前验证器中的 6 位验证码。'); return; }
    setAction('disable'); setError(null);
    try {
      await disableMfa(appState.authSession.accessToken, code.trim());
      setEnabled(false);
      setCode('');
      setRecoveryCodes([]);
      setRecoveryStatus(null);
      actions.showToast('双重验证已关闭');
    } catch {
      setError('验证码不正确，双重验证仍保持开启。');
    } finally { setAction(null); }
  };

  if (!appState.authSession) {
    return <ForgeScreen contentStyle={styles.content}><ForgeIconButton icon="chevron-back" label="返回" onPress={() => router.back()} variant="ghost" /><ForgeCard style={styles.card}><ForgeText variant="h2">需要登录</ForgeText><ForgeText tone="secondary">登录后才能管理双重验证。FORGE 不会在未连接账号服务时伪造安全设置。</ForgeText><ForgeButton label="去登录" onPress={() => router.replace('/login')} /></ForgeCard></ForgeScreen>;
  }

  return <ForgeScreen contentStyle={styles.content}>
    <ForgeIconButton icon="chevron-back" label="返回账户" onPress={() => router.back()} variant="ghost" />
    <View style={styles.hero}><ForgeText variant="title">双重验证</ForgeText><ForgeText tone="secondary">使用验证器应用保护登录。密钥只在设置阶段显示，恢复码只显示一次。</ForgeText></View>
    <ForgeCard style={styles.card}>
      <ForgeText variant="h2">{enabled ? '已开启' : '尚未开启'}</ForgeText>
      <ForgeText tone="secondary">{enabled ? '每次新设备登录时，除了密码还需要验证器代码。' : '开启后，FORGE 登录会要求密码和 6 位验证器代码。'}</ForgeText>
      {state === 'loading' ? <ForgeText tone="secondary">正在读取安全设置…</ForgeText> : null}
      {state === 'error' ? <ForgeText variant="caption" tone="danger" accessibilityLiveRegion="assertive">{error}</ForgeText> : null}
      {!enabled && !setup ? <ForgeButton label={action === 'setup' ? '准备中…' : '开始设置双重验证'} loading={action === 'setup'} disabled={action !== null} onPress={() => void beginSetup()} /> : null}
      {setup ? <View style={styles.setupBlock}><ForgeText variant="h3">在验证器中添加 FORGE</ForgeText><ForgeText variant="caption" tone="secondary">使用验证器扫描二维码，或使用系统验证器导入链接；二维码和链接都来自本次真实设置。</ForgeText><View style={styles.qrWrap} accessible accessibilityLabel="FORGE 双重验证导入二维码"><QRCode value={setup.otpauthUri} size={184} color={colors.textPrimary} backgroundColor={colors.surface1} quietZone={12} /></View><ForgeButton label="复制系统导入链接" variant="secondary" onPress={() => void copyOtpAuthUri()} /><ForgeText variant="caption" tone="secondary">无法扫描时，再手动输入密钥：</ForgeText><ForgeText selectable style={styles.secret}>{setup.secret}</ForgeText><ForgeText selectable variant="caption" tone="tertiary">{setup.otpauthUri}</ForgeText><CodeInput value={code} onChangeText={setCode} /><ForgeButton label={action === 'enable' ? '确认中…' : '确认并启用'} loading={action === 'enable'} disabled={action !== null} onPress={() => void confirmSetup()} /></View> : null}
      {enabled ? <View style={styles.setupBlock}><CodeInput value={code} onChangeText={setCode} /><ForgeButton label={action === 'disable' ? '关闭中…' : '关闭双重验证'} variant="secondary" loading={action === 'disable'} disabled={action !== null} onPress={confirmDisable} /></View> : null}
      {error && state !== 'error' ? <ForgeText variant="caption" tone="danger" accessibilityLiveRegion="assertive">{error}</ForgeText> : null}
    </ForgeCard>
    {recoveryCodes.length ? <ForgeCard style={styles.card}><ForgeText variant="h3">保存恢复码</ForgeText><ForgeText tone="secondary">每个恢复码只能使用一次，可在无法使用验证器时完成登录。请把它们保存到密码管理器；离开此页后 FORGE 不会再次显示完整恢复码。</ForgeText><View style={styles.codes}>{recoveryCodes.map((item) => <ForgeText key={item} selectable variant="label" style={styles.code}>{item}</ForgeText>)}</View></ForgeCard> : null}
    {enabled ? <ForgeCard style={styles.card}><ForgeText variant="h3">恢复码管理</ForgeText><ForgeText tone="secondary">{recoveryStatus ? '还剩 ' + recoveryStatus.remaining + ' 个未使用恢复码，共 ' + recoveryStatus.total + ' 个。重新生成会立即使旧恢复码失效。' : '正在读取恢复码状态…'}</ForgeText><CodeInput label="用于确认的验证器代码" value={recoveryCode} onChangeText={setRecoveryCode} /><ForgeButton label={recoveryAction === 'regenerate' ? '重新生成中…' : '重新生成恢复码'} variant="secondary" loading={recoveryAction === 'regenerate'} disabled={action !== null || recoveryAction !== null || !recoveryStatus} onPress={() => void performRegenerateRecoveryCodes()} /><ForgeButton label={recoveryAction === 'revoke' ? '撤销中…' : '撤销全部恢复码'} variant="secondary" loading={recoveryAction === 'revoke'} disabled={action !== null || recoveryAction !== null || !recoveryStatus?.remaining} onPress={confirmRevokeRecoveryCodes} /></ForgeCard> : null}
    <ForgeCard style={styles.card}>
      <ForgeText variant="h3">安全活动</ForgeText>
      <ForgeText tone="secondary">这里只显示本账号的安全操作，不会显示验证器密钥、验证码或恢复码。</ForgeText>
      {auditError ? <View style={styles.auditNotice}><ForgeText variant="caption" tone="danger" accessibilityLiveRegion="polite">{auditError}</ForgeText><ForgeButton label="重试读取" variant="secondary" disabled={auditLoading} loading={auditLoading} onPress={() => void refreshAudit()} /></View> : null}
      {!auditEvents.length && auditLoading ? <ForgeText tone="secondary">正在读取安全活动…</ForgeText> : null}
      {!auditEvents.length && !auditLoading && !auditError ? <View style={styles.auditNotice}><ForgeText tone="secondary">暂时没有安全活动记录。</ForgeText><ForgeButton label="重新加载" variant="secondary" onPress={() => void refreshAudit()} /></View> : null}
      {auditEvents.map((event, index) => <View key={event.eventType + event.createdAt + index} style={styles.auditRow}><ForgeText variant="label">{securityEventLabel(event.eventType)}</ForgeText><ForgeText variant="caption" tone="tertiary" accessibilityLabel={'时间：' + formatAuditAccessibilityDate(event.createdAt)}>{formatAuditDate(event.createdAt)}</ForgeText></View>)}
      {auditCursor ? <ForgeButton label={auditLoading ? '加载中…' : '加载更多安全活动'} variant="secondary" loading={auditLoading} disabled={auditLoading} onPress={() => void loadMoreAudit()} /> : null}
    </ForgeCard>
    <ForgeText variant="caption" tone="tertiary" style={styles.note}>双重验证由真实账号服务执行；未启用时不会显示“已保护”。</ForgeText>
  </ForgeScreen>;
}

function securityEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    mfa_setup_started: '开始设置双重验证',
    mfa_enabled: '已启用双重验证',
    mfa_disabled: '已关闭双重验证',
    mfa_challenge_created: '发起双重验证登录',
    mfa_login_succeeded: '双重验证登录成功',
    mfa_login_failed: '双重验证登录失败',
  };
  return labels[eventType] ?? '安全设置已更新';
}

function formatAuditDate(value: string) {
  return formatRelativeTime(value, value);
}

function formatAuditAccessibilityDate(value: string) {
  return formatLocalizedDateTime(value, value);
}

function CodeInput({ label = '6 位验证器代码', value, onChangeText }: { label?: string; value: string; onChangeText: (value: string) => void }) {
  return <View style={styles.codeField}><ForgeText variant="caption" tone="secondary">{label}</ForgeText><TextInput accessibilityLabel="6 位验证器代码" value={value} onChangeText={onChangeText} placeholder="000000" placeholderTextColor={colors.textTertiary} keyboardType="numeric" autoCapitalize="none" maxLength={6} style={styles.input} /></View>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.md },
  hero: { gap: spacing.xs, paddingTop: spacing.xl, paddingBottom: spacing.md },
  card: { gap: spacing.md },
  setupBlock: { gap: spacing.sm },
  secret: { color: colors.accent, backgroundColor: colors.accentMuted, borderRadius: radius.small, padding: spacing.md, fontSize: 17, letterSpacing: 1 },
  qrWrap: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface1, borderRadius: radius.medium, padding: spacing.md },
  codeField: { gap: spacing.xs },
  input: { minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, fontSize: 18, letterSpacing: 4 },
  codes: { gap: spacing.xs, backgroundColor: colors.surface2, borderRadius: radius.small, padding: spacing.md },
  code: { letterSpacing: 1 },
  auditRow: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  auditNotice: { gap: spacing.sm },
  note: { textAlign: 'center', paddingTop: spacing.sm },
});
