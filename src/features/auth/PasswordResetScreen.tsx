import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { ForgeButton, ForgeIconButton, ForgeScreen, ForgeText, colors, spacing } from '@/design-system';
import { requestPasswordReset } from '@/data/authClient';

export function PasswordResetScreen() {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [sent, setSent] = useState(false);
  const submit = async () => {
    if (!email.includes('@')) { setError('请输入有效的邮箱地址。'); return; }
    setBusy(true); setError(null);
    try { await requestPasswordReset(email.trim()); setSent(true); } catch (requestError: unknown) { setError(requestError instanceof Error && requestError.message === 'AUTH_SERVICE_UNCONFIGURED' ? '账号服务尚未连接，未伪造邮件已发送。' : '密码找回请求失败，请稍后重试。'); } finally { setBusy(false); }
  };
  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ForgeScreen contentStyle={styles.content}><ForgeIconButton icon="chevron-back" label="返回登录" onPress={() => router.back()} variant="ghost" /><View style={styles.hero}><ForgeText variant="title">找回密码</ForgeText><ForgeText tone="secondary">输入注册邮箱，FORGE 会通过真实账号服务发送重置链接。</ForgeText></View>{sent ? <View style={styles.success}><ForgeText variant="h2">请求已提交</ForgeText><ForgeText tone="secondary">如果账号服务返回成功，请检查 {email.trim()} 的收件箱。若服务未部署，页面不会伪造发送结果。</ForgeText><ForgeButton label="返回登录" onPress={() => router.replace('/login')} /></View> : <View style={styles.form}><View style={styles.field}><ForgeText variant="caption" tone="secondary">注册邮箱</ForgeText><TextInput accessibilityLabel="注册邮箱" value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor={colors.textTertiary} keyboardType="email-address" autoCapitalize="none" style={styles.input} /></View>{error ? <ForgeText variant="caption" tone="danger" accessibilityLiveRegion="assertive">{error}</ForgeText> : null}<ForgeButton label="发送重置链接" onPress={submit} loading={busy} disabled={busy} /></View>}</ForgeScreen></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ keyboard: { flex: 1 }, content: { gap: spacing.lg }, hero: { gap: spacing.xs, paddingTop: spacing.xl }, form: { gap: spacing.md }, field: { gap: spacing.xs }, input: { minHeight: 52, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, fontSize: 16 }, success: { gap: spacing.md, padding: spacing.md, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.success, backgroundColor: colors.surface2 } });
