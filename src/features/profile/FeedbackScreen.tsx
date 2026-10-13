import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ForgeButton, ForgeCard, ForgeIconButton, ForgeScreen, ForgeSectionHeader, ForgeText, colors, radius, spacing } from '@/design-system';
import { submitUserFeedback } from '@/data/authClient';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';

const categories = ['功能建议', '问题反馈', '训练体验', '营养体验'];

export function FeedbackScreen() {
  const state = useForgeAppState();
  const actions = useForgeAppActions();
  const [category, setCategory] = useState(categories[0]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!state.authSession) { setError('请先登录后再提交反馈，FORGE 不会伪造提交成功。'); return; }
    if (message.trim().length < 5) { setError('请至少填写 5 个字，方便我们定位问题。'); return; }
    setError(null); setSubmitting(true);
    try {
      await submitUserFeedback(state.authSession.accessToken, { category, message: message.trim() });
      actions.showToast('反馈已提交');
      if (router.canGoBack()) router.back(); else router.replace('/');
    } catch (requestError: unknown) {
      setError(requestError instanceof Error && requestError.message === 'AUTH_SERVICE_UNCONFIGURED' ? '反馈服务尚未连接，请配置 FORGE 服务端后重试。' : '反馈提交失败，请检查网络后重试。');
    } finally { setSubmitting(false); }
  };

  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ForgeScreen contentStyle={styles.content}>
    <View style={styles.header}><ForgeIconButton icon="chevron-back" label="返回我的" variant="ghost" onPress={() => router.back()} /><View style={styles.headerCopy}><ForgeText variant="h2">帮助与反馈</ForgeText><ForgeText variant="caption" tone="secondary">反馈会发送到 FORGE 服务端，不会伪造本地提交结果。</ForgeText></View><View style={styles.headerSpacer} /></View>
    <ForgeCard style={styles.card}><ForgeSectionHeader title="反馈类型" /><View style={styles.categories}>{categories.map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityLabel={item} accessibilityState={{ selected: category === item }} onPress={() => setCategory(item)} style={({ pressed }) => [styles.category, category === item && styles.selected, pressed && styles.pressed]}><ForgeText variant="caption" tone={category === item ? 'accent' : 'secondary'}>{item}</ForgeText></Pressable>)}</View><View style={styles.field}><ForgeText variant="label">具体内容</ForgeText><TextInput accessibilityLabel="具体内容" accessibilityHint="描述你遇到的问题或建议" value={message} onChangeText={setMessage} multiline maxLength={1000} placeholder="请描述发生了什么，或你希望 FORGE 如何改进" placeholderTextColor={colors.textTertiary} style={styles.input} /></View>{error ? <ForgeText variant="caption" tone="danger" accessibilityLiveRegion="assertive">{error}</ForgeText> : null}<ForgeButton label="提交反馈" loading={submitting} disabled={submitting} onPress={submit} /></ForgeCard>
  </ForgeScreen></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ keyboard: { flex: 1 }, content: { gap: spacing.lg }, header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, headerCopy: { flex: 1, gap: spacing.xxs }, headerSpacer: { width: 44 }, card: { gap: spacing.md }, categories: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, category: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.round, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, selected: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent, backgroundColor: colors.accentMuted }, field: { gap: spacing.xs }, input: { minHeight: 150, padding: spacing.md, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, fontSize: 16, lineHeight: 24, textAlignVertical: 'top' }, pressed: { opacity: 0.7 } });
