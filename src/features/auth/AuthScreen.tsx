import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ForgeButton, ForgeIconButton, ForgeScreen, ForgeText, colors, radius, spacing } from '@/design-system';
import { checkAuthService, requestAuth, verifyMfaLogin, type AuthChallenge } from '@/data/authClient';
import { useForgeAppActions } from '@/state/ForgeAppContext';

type AuthMode = 'login' | 'register';
type ServiceState = 'checking' | 'online' | 'offline';

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const actions = useForgeAppActions();
  const isLogin = mode === 'login';
  const emailDraftKey = `forge.login.email.${mode}`;
  const [email, setEmail] = useState(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
    try { return window.sessionStorage.getItem(emailDraftKey) ?? ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mfaChallenge, setMfaChallenge] = useState<AuthChallenge | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [serviceState, setServiceState] = useState<ServiceState>(Platform.OS === 'web' ? 'online' : 'checking');
  const [serviceReloadKey, setServiceReloadKey] = useState(0);
  const [touched, setTouched] = useState({ email: false, password: false, confirmPassword: false });

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      if (email.trim()) window.sessionStorage.setItem(emailDraftKey, email);
      else window.sessionStorage.removeItem(emailDraftKey);
    } catch {
      // Session storage can be unavailable in privacy-restricted browser contexts.
    }
  }, [email, emailDraftKey]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    void checkAuthService(controller.signal)
      .then(() => { if (active) setServiceState('online'); })
      .catch(() => { if (active) setServiceState('offline'); })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [serviceReloadKey]);

  const retryService = () => { setServiceState('checking'); setServiceReloadKey((current) => current + 1); };

  const submit = async () => {
    setTouched({ email: true, password: true, confirmPassword: true });
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !normalizedEmail.includes('@') || password.length < 6 || (!isLogin && password !== confirmPassword)) {
      setSubmitError('请填写有效的邮箱和密码后再继续。');
      return;
    }
    if (serviceState !== 'online') { setSubmitError(serviceState === 'checking' ? '正在连接账号服务，请稍候。' : '账号服务暂时不可用，请先重试连接。'); return; }
    setBusy(true); setSubmitError(null);
    try {
      const result = await requestAuth(mode, { email: normalizedEmail, password, confirmPassword: isLogin ? undefined : confirmPassword });
      if ('mfaRequired' in result) {
        setMfaChallenge(result);
        setMfaCode('');
        setMfaError(null);
        return;
      }
      actions.setAuthSession(result);
      actions.showToast(isLogin ? '登录成功' : '账户创建成功');
    } catch (error: unknown) {
      const message = authErrorMessage(error);
      setSubmitError(message); actions.showToast(message);
    } finally { setBusy(false); }
  };

  const verifyChallenge = async () => {
    if (!mfaChallenge || (!/^\d{6}$/.test(mfaCode.trim()) && !/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(mfaCode.trim()))) { setMfaError('请输入 6 位验证器代码或恢复码。'); return; }
    setMfaBusy(true); setMfaError(null);
    try {
      const session = await verifyMfaLogin(mfaChallenge.challengeToken, mfaCode.trim());
      actions.setAuthSession(session);
      actions.showToast('登录成功');
    } catch (error: unknown) {
      setMfaError(authErrorMessage(error, '验证码不正确或登录挑战已过期，请重新登录。'));
    } finally { setMfaBusy(false); }
  };

  if (mfaChallenge) {
    return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ForgeScreen contentStyle={styles.content}>
        <ForgeIconButton icon="chevron-back" label="返回登录" onPress={() => setMfaChallenge(null)} variant="ghost" />
        <View style={styles.hero}>
          <Image source={require("../../../assets/forge-logo.png")} style={styles.logoImage} accessibilityLabel="FORGE 标志" />
          <ForgeText variant="title">需要双重验证</ForgeText>
          <ForgeText tone="secondary">密码已确认。打开你的验证器应用输入 6 位代码；如果无法使用验证器，也可以输入一个尚未使用的恢复码。</ForgeText>
        </View>
        <View style={styles.form}>
          <Field label="验证器代码或恢复码" value={mfaCode} onChangeText={setMfaCode} placeholder="000000 或 XXXX-XXXX" keyboardType="default" autoCapitalize="characters" error={mfaError} />
          <ForgeButton label="完成登录" onPress={() => void verifyChallenge()} loading={mfaBusy} disabled={mfaBusy} />
        </View>
        <ForgeText variant="caption" tone="tertiary" style={styles.note}>挑战有效期 5 分钟；验证码不会被保存到设备。</ForgeText>
      </ForgeScreen>
    </KeyboardAvoidingView>;
  }

  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ForgeScreen contentStyle={styles.content}>
      <ForgeIconButton icon="chevron-back" label="返回" onPress={() => router.back()} variant="ghost" />
      <View style={styles.hero}>
        <Image source={require("../../../assets/forge-logo.png")} style={styles.logoImage} accessibilityLabel="FORGE 标志" />
        <ForgeText variant="title">{isLogin ? '欢迎回来' : '创建你的 FORGE 账户'}</ForgeText>
        <ForgeText tone="secondary">{isLogin ? '继续完成今天的训练决定。' : '保存你的目标，让每一天都更贴近你。'}</ForgeText>
      </View>
      <View style={styles.form}>
        <Field label="邮箱" value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={touched.email && !email.includes('@') ? '请输入有效的邮箱地址。' : null} onBlur={() => setTouched((current) => ({ ...current, email: true }))} />
        <Field label="密码" value={password} onChangeText={setPassword} placeholder="至少 6 位" autoComplete={isLogin ? 'current-password' : 'new-password'} secureTextEntry showToggle isVisible={showPassword} onToggleVisibility={() => setShowPassword((current) => !current)} error={touched.password && password.length < 6 ? '密码至少需要 6 位。' : null} onBlur={() => setTouched((current) => ({ ...current, password: true }))} />
        {!isLogin ? <Field label="确认密码" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="再次输入密码" autoComplete="new-password" secureTextEntry showToggle isVisible={showPassword} onToggleVisibility={() => setShowPassword((current) => !current)} error={touched.confirmPassword && password !== confirmPassword ? '两次输入的密码不一致。' : null} onBlur={() => setTouched((current) => ({ ...current, confirmPassword: true }))} /> : <Pressable accessibilityRole="button" accessibilityLabel="忘记密码" onPress={() => router.push('/forgot-password')} style={styles.forgot}><ForgeText variant="caption" tone="accent">忘记密码？</ForgeText></Pressable>}
        {submitError ? <ForgeText variant="caption" tone="danger" accessibilityLiveRegion="assertive">{submitError}</ForgeText> : null}
        <ServiceStatus state={serviceState} onRetry={retryService} />
        <ForgeButton label={isLogin ? '登录 FORGE' : '创建账户'} onPress={() => void submit()} loading={busy} disabled={busy || serviceState !== 'online'} />
      </View>
      <View style={styles.switchRow}><ForgeText variant="caption" tone="secondary">{isLogin ? '还没有账户？' : '已经有账户？'}</ForgeText><Pressable accessibilityRole="button" accessibilityLabel={isLogin ? '注册新账户' : '返回登录'} onPress={() => router.replace(isLogin ? '/register' : '/login')} hitSlop={8}><ForgeText variant="caption" tone="accent">{isLogin ? '注册' : '登录'}</ForgeText></Pressable></View>
      <ForgeText variant="caption" tone="tertiary" style={styles.note}>{serviceState === 'online' ? '账号数据将安全保存到云端。' : '未连接账号服务时不会在本地伪造登录或注册结果。'}</ForgeText>
    </ForgeScreen>
  </KeyboardAvoidingView>;
}

function authErrorMessage(error: unknown, fallback = '账号请求失败，请稍后重试。'): string {
  if (!(error instanceof Error)) return fallback;
  if (error.message === 'AUTH_SERVICE_UNCONFIGURED') return '账号服务配置缺失，请联系管理员。';
  if (error.message === 'AUTH_SERVICE_UNAVAILABLE' || error.name === 'AbortError' || error.name === 'TypeError') return '账号服务暂时不可用，请检查网络后重试。';
  return error.message || fallback;
}

function ServiceStatus({ state, onRetry }: { state: ServiceState; onRetry: () => void }) {
  const label = state === 'checking' ? '正在连接账号服务…' : state === 'online' ? '账号服务已连接' : '账号服务暂时不可用';
  return <View style={styles.serviceStatus} accessibilityLiveRegion="polite">
    <View style={[styles.statusDot, state === 'online' ? styles.statusDotOnline : state === 'offline' ? styles.statusDotOffline : styles.statusDotChecking]} />
    <ForgeText variant="caption" tone={state === 'offline' ? 'danger' : state === 'online' ? 'secondary' : 'tertiary'}>{label}</ForgeText>
    {state === 'offline' ? <Pressable accessibilityRole="button" accessibilityLabel="重新连接账号服务" onPress={onRetry} hitSlop={8}><ForgeText variant="caption" tone="accent">重新连接</ForgeText></Pressable> : null}
  </View>;
}

function Field({ label, value, onChangeText, placeholder, secureTextEntry = false, keyboardType = 'default', autoCapitalize = 'sentences', error, onBlur, autoComplete, showToggle = false, isVisible = false, onToggleVisibility }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; secureTextEntry?: boolean; keyboardType?: 'default' | 'email-address' | 'numeric'; autoCapitalize?: 'none' | 'sentences' | 'characters'; error?: string | null; onBlur?: () => void; autoComplete?: 'email' | 'current-password' | 'new-password'; showToggle?: boolean; isVisible?: boolean; onToggleVisibility?: () => void }) {
  return <View style={styles.field}><ForgeText variant="caption" tone="secondary">{label}</ForgeText><View style={styles.inputWrap}><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} onBlur={onBlur} placeholder={placeholder} placeholderTextColor={colors.textTertiary} secureTextEntry={secureTextEntry && !isVisible} keyboardType={keyboardType} autoCapitalize={autoCapitalize} autoComplete={autoComplete} style={[styles.input, showToggle && styles.inputWithToggle]} />{showToggle && onToggleVisibility ? <Pressable accessibilityRole="button" accessibilityLabel={isVisible ? '隐藏' + label : '显示' + label} onPress={onToggleVisibility} hitSlop={8} style={styles.toggle}><Ionicons name={isVisible ? 'eye-off-outline' : 'eye-outline'} size={19} color={colors.textSecondary} /></Pressable> : null}</View>{error ? <ForgeText variant="caption" tone="danger" accessibilityLiveRegion="polite">{error}</ForgeText> : null}</View>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  content: { gap: spacing.lg, paddingTop: spacing.md },
  hero: { alignItems: 'flex-start', gap: spacing.xs, paddingTop: spacing.xl, paddingBottom: spacing.md },
  logoImage: { width: 160, height: 160, marginBottom: spacing.sm },
  form: { gap: spacing.md },
  serviceStatus: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  statusDot: { width: 7, height: 7, borderRadius: radius.round },
  statusDotOnline: { backgroundColor: colors.success },
  statusDotOffline: { backgroundColor: colors.danger },
  statusDotChecking: { backgroundColor: colors.warning },
  field: { gap: spacing.xs },
  inputWrap: { position: 'relative' },
  input: { minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, fontSize: 15 },
  inputWithToggle: { paddingRight: 48 },
  toggle: { position: 'absolute', right: spacing.sm, top: 0, width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  forgot: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  note: { textAlign: 'center', paddingTop: spacing.sm },
});
