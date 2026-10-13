import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ForgeButton, ForgeCard, ForgeIconButton, ForgeScreen, ForgeText, colors, radius, spacing } from '@/design-system';
import { restoreAuthSession, verifyEmail } from '@/data/authClient';
import { useForgeApp } from '@/state/ForgeAppContext';

type VerifyState = 'loading' | 'success' | 'missing' | 'error';

export default function VerifyEmailRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const app = useForgeApp();
  const [state, setState] = useState<VerifyState>(() => typeof token === 'string' && token.trim() ? 'loading' : 'missing');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const tokenValue = typeof token === 'string' ? token.trim() : '';
    if (!tokenValue) return;
    let cancelled = false;
    void verifyEmail(tokenValue).then(async () => {
      if (cancelled) return;
      if (app.authSession) {
        try {
          const session = await restoreAuthSession(app.authSession.accessToken);
          if (!cancelled) app.setAuthSession(session);
        } catch {
          // Verification succeeded; an expired local session should not turn it into a false failure.
        }
      }
      if (!cancelled) {
        setState('success');
        app.showToast('邮箱已验证');
      }
    }).catch((requestError: unknown) => {
      if (cancelled) return;
      const code = requestError instanceof Error ? requestError.message : 'EMAIL_VERIFICATION_FAILED';
      setError(code === 'AUTH_SERVICE_UNCONFIGURED' ? '账号服务尚未连接，验证没有完成。' : code === 'EMAIL_VERIFICATION_INVALID' ? '验证链接无效或已过期，请重新发送验证邮件。' : '验证链接无法使用，可能已过期或已经使用，请重新发送验证邮件。');
      setState('error');
    });
    return () => { cancelled = true; };
  }, [app, token]);

  const destination = app.authSession ? '/privacy' : '/login';
  const goNext = () => router.replace(destination);

  return (
    <ForgeScreen contentStyle={styles.content}>
      <ForgeIconButton icon="chevron-back" label="返回" onPress={() => router.back()} variant="ghost" />
      <View style={styles.hero}>
        <View style={styles.mark}><ForgeText variant="h2" tone="accent">✓</ForgeText></View>
        <ForgeText variant="title">邮箱验证</ForgeText>
        <ForgeText tone="secondary">验证邮箱后，你可以更安全地管理账户、导出数据并接收账户服务通知。</ForgeText>
      </View>
      <ForgeCard style={styles.card} accessibilityLabel="邮箱验证状态">
        {state === 'loading' ? <><ForgeText variant="h2">正在验证</ForgeText><ForgeText tone="secondary" accessibilityLiveRegion="polite">正在向 FORGE 账号服务确认这条一次性链接，请不要重复点击。</ForgeText></> : null}
        {state === 'success' ? <><ForgeText variant="h2">邮箱已验证</ForgeText><ForgeText tone="secondary" accessibilityLiveRegion="assertive">验证已由服务端完成。现在可以返回继续使用 FORGE。</ForgeText><ForgeButton label={app.authSession ? '查看账户与隐私' : '返回登录'} onPress={goNext} /></> : null}
        {state === 'missing' ? <><ForgeText variant="h2">缺少验证链接</ForgeText><ForgeText tone="secondary" accessibilityLiveRegion="assertive">请从邮箱中的验证按钮打开 FORGE，或在账户与隐私中重新发送验证邮件。</ForgeText><ForgeButton label="返回登录" variant="secondary" onPress={() => router.replace('/login')} /></> : null}
        {state === 'error' ? <><ForgeText variant="h2">验证没有完成</ForgeText><ForgeText tone="danger" accessibilityLiveRegion="assertive">{error ?? '验证链接无法使用。'}</ForgeText><ForgeButton label={app.authSession ? '返回账户与隐私' : '返回登录'} variant="secondary" onPress={goNext} /></> : null}
      </ForgeCard>
      <ForgeText variant="caption" tone="tertiary" style={styles.note}>FORGE 不会在未收到服务端确认时显示验证成功。</ForgeText>
    </ForgeScreen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.md },
  hero: { gap: spacing.xs, paddingTop: spacing.xl, paddingBottom: spacing.md },
  mark: { width: 52, height: 52, borderRadius: radius.medium, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  card: { gap: spacing.md },
  note: { textAlign: 'center', paddingTop: spacing.sm },
});
