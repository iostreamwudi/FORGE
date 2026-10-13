import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ForgeButton, ForgeCard, ForgeScreen, ForgeText, colors, radius, spacing } from '@/design-system';
import { inspectHealthConnection, openHealthDataSettings, readLatestHealthSummary, requestHealthConnection, type HealthConnectionState, type HealthSummary } from '@/data/healthDataService';
import { deleteCloudHealthTrends, requestHealthTrends } from '@/data/authClient';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';
import { formatLocalizedDate, formatLocalizedDateTime } from '@/utils/date';

const initialState: HealthConnectionState = { provider: null, status: 'unavailable', detail: '正在读取系统健康数据状态…' };

export function HealthDataScreen() {
  const appState = useForgeAppState();
  const actions = useForgeAppActions();
  const cloudAccessToken = appState.authSession?.accessToken;
  const mergeHealthSnapshots = actions.mergeHealthSnapshots;
  const clearHealthSnapshots = actions.clearHealthSnapshots;
  const [state, setState] = useState<HealthConnectionState>(initialState);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const refresh = async () => { setLoading(true); setError(''); try { setState(await inspectHealthConnection()); } catch { setError('读取健康数据状态失败，请重试。'); } finally { setLoading(false); } };
  useEffect(() => {
    let active = true;
    const load = () => { inspectHealthConnection().then((nextState) => { if (active) setState(nextState); }).catch(() => { if (active) setError('读取健康数据状态失败，请重试。'); }).finally(() => { if (active) setLoading(false); }); };
    load();
    const subscription = AppState.addEventListener('change', (nextState) => { if (nextState === 'active') load(); });
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const accessToken = cloudAccessToken;
    if (!accessToken) return;
    let active = true;
    void requestHealthTrends(accessToken).then((result) => {
      if (active) mergeHealthSnapshots(result.snapshots);
    }).catch(() => {
      if (active) setError('云端健康趋势暂时无法读取，本机历史仍然保留。');
    });
    return () => { active = false; };
  }, [cloudAccessToken, mergeHealthSnapshots]);
  const connect = async () => { setLoading(true); setError(''); try { setState(await requestHealthConnection()); } catch { setError('请求健康数据权限失败，请检查系统设置后重试。'); } finally { setLoading(false); } };
  const manage = async () => { if (!state.provider) return; try { await openHealthDataSettings(state.provider); } catch { setError('当前平台无法打开系统健康数据设置。'); } };
  const readLatest = async () => { setReading(true); setApplied(false); setError(''); try { const nextSummary = await readLatestHealthSummary(); setSummary(nextSummary); if (nextSummary.observedAt) actions.recordHealthSnapshot({ source: nextSummary.source, observedAt: nextSummary.observedAt, weightKg: nextSummary.weightKg, sleepHours: nextSummary.sleepHours }); } catch { setError('读取健康数据失败，请确认已授权体重与睡眠权限后重试。'); } finally { setReading(false); } };
  const clearCloudHealth = () => { if (cloudAccessToken) setClearOpen(true); };
  const confirmClearCloudHealth = () => {
    if (!cloudAccessToken) return;
    setClearOpen(false);
    void deleteCloudHealthTrends(cloudAccessToken, appState.cloudRevision).then((result) => { clearHealthSnapshots(); actions.showToast(result.deletedCount ? '云端健康快照已清除' : '云端没有需要清除的健康快照'); }).catch((error: unknown) => setError(error instanceof Error ? error.message : '云端健康数据清除失败，请重试。'));
  };
  const applyLatest = () => { if (!summary?.observedAt) return; actions.applyHealthData({ weightKg: summary.weightKg, sleepHours: summary.sleepHours, source: summary.source, observedAt: summary.observedAt }); setApplied(true); };
  const unavailable = Platform.OS === 'web' || state.status === 'unavailable';
  return <ForgeScreen contentStyle={styles.content}>
    <View style={styles.header}><ForgeButton label="返回我的" variant="secondary" onPress={() => router.back()} /><View style={styles.headerCopy}><ForgeText variant="title">健康数据连接</ForgeText><ForgeText variant="caption" tone="secondary">只读取你在系统中明确授权的真实数据。</ForgeText></View></View>
    <ForgeCard style={styles.card}><ForgeText variant="h3">{state.provider === 'apple_health' ? 'Apple 健康' : state.provider === 'health_connect' ? 'Health Connect' : '系统健康数据'}</ForgeText><ForgeText variant="body" tone={state.status === 'connected' ? 'accent' : state.status === 'permission_denied' || state.status === 'error' ? 'danger' : 'secondary'} accessibilityLiveRegion="polite">{loading ? '正在读取权限状态…' : state.status === 'connected' ? '已连接' : state.status === 'permission_denied' ? '权限未完成' : state.status === 'error' ? '状态读取失败' : state.status === 'unavailable' ? '平台不可用' : '尚未连接'}</ForgeText><ForgeText variant="caption" tone="secondary">{state.detail}</ForgeText>{error ? <ForgeText variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</ForgeText> : null}<ForgeButton label={loading ? '处理中…' : unavailable ? '当前平台不可用' : state.status === 'connected' ? '重新检查权限' : '连接健康数据'} disabled={loading || unavailable} onPress={state.status === 'connected' ? refresh : connect} /><ForgeButton label={reading ? '读取中…' : '读取最近健康数据'} variant="secondary" disabled={loading || unavailable || state.status !== 'connected' || reading} onPress={() => { void readLatest(); }} /><ForgeButton label="打开系统健康权限" variant="secondary" disabled={loading || unavailable || !state.provider} onPress={() => { void manage(); }} /></ForgeCard>
    {summary ? <ForgeCard style={styles.dataCard}><ForgeText variant="h3">最近读取结果</ForgeText>{summary.weightKg !== undefined ? <ForgeText variant="body">体重 · {summary.weightKg.toFixed(1)} kg</ForgeText> : <ForgeText variant="caption" tone="secondary">最近 14 天没有可读取的体重记录。</ForgeText>}{summary.sleepHours !== undefined ? <ForgeText variant="body">睡眠 · {summary.sleepHours.toFixed(1)} 小时</ForgeText> : <ForgeText variant="caption" tone="secondary">最近 14 天没有可读取的睡眠记录。</ForgeText>}{summary.observedAt ? <ForgeText variant="caption" tone="tertiary">数据时间 · {formatLocalizedDateTime(summary.observedAt, '时间未知')}</ForgeText> : null}<ForgeButton label={applied ? '已写入今日状态' : '写入今日状态'} variant="secondary" disabled={applied || (summary.weightKg === undefined && summary.sleepHours === undefined)} onPress={applyLatest} /></ForgeCard> : null}
    <ForgeCard style={styles.trendCard}><ForgeText variant="h3">健康趋势</ForgeText><ForgeText variant="caption" tone="secondary">仅根据已读取到的真实历史样本绘制。</ForgeText><HealthTrend title="体重" unit="kg" values={appState.healthSnapshots.filter((item) => item.weightKg !== undefined).map((item) => ({ value: item.weightKg as number, observedAt: item.observedAt }))} /><HealthTrend title="睡眠" unit="小时" values={appState.healthSnapshots.filter((item) => item.sleepHours !== undefined).map((item) => ({ value: item.sleepHours as number, observedAt: item.observedAt }))} /></ForgeCard>
    <ForgeCard style={styles.historyCard}><ForgeText variant="h3">健康读取历史</ForgeText>{appState.healthSnapshots.length > 0 ? appState.healthSnapshots.slice(0, 10).map((item) => <View key={item.id} style={styles.historyRow}><View style={styles.historyCopy}><ForgeText variant="label">{item.source}</ForgeText><ForgeText variant="caption" tone="secondary">{item.weightKg !== undefined ? `体重 ${item.weightKg.toFixed(1)} kg` : '体重未记录'} · {item.sleepHours !== undefined ? `睡眠 ${item.sleepHours.toFixed(1)} 小时` : '睡眠未记录'}</ForgeText></View><ForgeText variant="caption" tone="tertiary">{formatLocalizedDate(item.observedAt, '时间未知')}</ForgeText></View>) : <ForgeText variant="caption" tone="secondary">读取真实健康数据后，这里会按来源和日期保留历史。</ForgeText>}</ForgeCard>
    {cloudAccessToken ? <ForgeCard style={styles.cloudPrivacy}><ForgeText variant="h3">云端健康数据</ForgeText><ForgeText variant="caption" tone="secondary">登录并开启同步后，健康快照会用于跨设备趋势。你可以单独清除云端健康快照，不会撤销系统权限。</ForgeText><ForgeButton label="清除云端健康快照" variant="secondary" onPress={clearCloudHealth} /></ForgeCard> : null}
    <ForgeCard style={styles.info}><ForgeText variant="h3">FORGE 会读取什么</ForgeText><ForgeText variant="caption" tone="secondary">当前连接请求仅包含体重与睡眠读取权限，不会写入健康数据，也不会在未授权时使用示例数据。</ForgeText><ForgeText variant="caption" tone="tertiary">Web 预览不支持系统健康数据；请使用包含原生模块的 iOS/Android Dev Client 或正式构建验证权限弹窗和数据同步。</ForgeText></ForgeCard>
    <Modal visible={clearOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setClearOpen(false)} statusBarTranslucent><Pressable style={styles.scrim} onPress={() => setClearOpen(false)}><Pressable style={styles.confirmSheet} onPress={(event) => event.stopPropagation()}><ForgeText variant="h3">清除云端健康快照？</ForgeText><ForgeText tone="secondary">这会删除 FORGE 云端保存的健康趋势快照，本机健康历史也会清空。系统健康数据权限不会被撤销，之后仍可重新读取。</ForgeText><View style={styles.confirmActions}><ForgeButton label="取消" variant="secondary" onPress={() => setClearOpen(false)} /><Pressable accessibilityRole="button" accessibilityLabel="确认清除云端健康数据" onPress={confirmClearCloudHealth} style={styles.dangerButton}><ForgeText variant="label" tone="danger">清除云端数据</ForgeText></Pressable></View></Pressable></Pressable></Modal>
  </ForgeScreen>;
}

function HealthTrend({ title, unit, values }: { title: string; unit: string; values: { value: number; observedAt: string }[] }) {
  const ordered = [...values].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).slice(-7);
  if (ordered.length < 4) return <View style={styles.trendSection}><ForgeText variant="label">{title}趋势</ForgeText><ForgeText variant="caption" tone="tertiary">已读取 {ordered.length} 条真实记录，至少需要 4 条后显示趋势。</ForgeText></View>;
  const numbers = ordered.map((item) => item.value);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const range = max - min || 1;
  return <View style={styles.trendSection} accessibilityLabel={`${title}趋势：${numbers[0].toFixed(1)} 到 ${numbers[numbers.length - 1].toFixed(1)} ${unit}`}><View style={styles.trendHeader}><ForgeText variant="label">{title}趋势</ForgeText><ForgeText variant="caption" tone="secondary">{numbers[numbers.length - 1].toFixed(1)} {unit}</ForgeText></View><View style={styles.bars}>{ordered.map((item) => <View key={item.observedAt} style={styles.barSlot}><View style={[styles.bar, { height: 18 + ((item.value - min) / range) * 62 }]} /><ForgeText variant="caption" tone="tertiary">{formatLocalizedDate(item.observedAt, '时间未知')}</ForgeText></View>)}</View></View>;
}

const styles = StyleSheet.create({ scrim: { flex: 1, justifyContent: 'center', backgroundColor: colors.scrim }, confirmSheet: { margin: spacing.lg, padding: spacing.lg, gap: spacing.md, borderRadius: radius.medium, backgroundColor: colors.elevated }, confirmActions: { flexDirection: 'row', gap: spacing.sm }, dangerButton: { flex: 1, minHeight: 48, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' }, content: { gap: spacing.lg }, header: { gap: spacing.sm }, headerCopy: { gap: spacing.xxs }, card: { gap: spacing.md }, dataCard: { gap: spacing.sm, backgroundColor: colors.surface2 }, trendCard: { gap: spacing.md, backgroundColor: colors.surface2 }, trendSection: { gap: spacing.xs, paddingTop: spacing.xs }, trendHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, bars: { minHeight: 108, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, barSlot: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-end', gap: 2 }, bar: { width: '58%', minHeight: 18, borderRadius: radius.small, backgroundColor: colors.accent }, historyCard: { gap: spacing.sm }, cloudPrivacy: { gap: spacing.sm, backgroundColor: colors.surface2 }, historyRow: { minHeight: 52, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, historyCopy: { flex: 1, gap: spacing.xxs }, info: { gap: spacing.sm, backgroundColor: colors.surface2 } });
