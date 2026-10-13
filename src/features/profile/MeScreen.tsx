import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ForgeButton, ForgeCard, ForgeScreen, ForgeSectionHeader, ForgeStatusPill, ForgeText, colors, radius, spacing } from '@/design-system';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';
import { formatLocalizedDateTime } from '@/utils/date';

export function MeScreen() {
  const appState = useForgeAppState();
  const actions = useForgeAppActions();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const confirmCloudRestore = () => {
    if (!appState.authSession) return;
    if (Platform.OS === 'web') {
      setRestoreOpen(true);
      return;
    }
    Alert.alert('从云端恢复数据？', '这会用云端保存的训练、历史、饮食和健康快照替换本机当前数据。本机数据不会自动合并，请确认云端版本就是你要恢复的版本。', [
      { text: '取消', style: 'cancel' },
      { text: '从云端恢复', style: 'destructive', onPress: () => { void actions.restoreFromCloud(); } },
    ]);
  };
  const confirmCloudMerge = () => {
    if (!appState.authSession || !appState.cloudRemoteDiff) return;
    if (Platform.OS === 'web') {
      void actions.mergeCloudConflict();
      return;
    }
    Alert.alert('合并本机与云端数据？', '训练、饮食、健康和 Coach 历史会按记录 ID 合并；账户、今日状态、当前训练和营养目标等单值字段保留本机当前值。合并会写入云端最新版本，失败时不会覆盖云端。', [
      { text: '取消', style: 'cancel' },
      { text: '合并并同步', onPress: () => { void actions.mergeCloudConflict(); } },
    ]);
  };
  return <ForgeScreen contentStyle={styles.content}>
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <View style={styles.brandRow}><Ionicons name="sparkles" size={15} color={colors.accent} /><ForgeText variant="label" tone="accent">FORGE · 账户</ForgeText></View>
        <ForgeText variant="title">我的</ForgeText>
        <ForgeText tone="secondary">管理你的目标、偏好与账户。</ForgeText>
      </View>
      <ForgeStatusPill label={appState.authSession ? '已登录' : '本地账户'} tone={appState.authSession ? 'accent' : 'neutral'} />
    </View>

    <ForgeCard style={styles.profileCard}>
      <View style={styles.profileMain}>
        <View style={styles.avatar}><ForgeText variant="h3">{appState.profile.initials || '—'}</ForgeText></View>
        <View style={styles.profileCopy}><ForgeText variant="h3">{appState.profile.name || '本地账户'}</ForgeText><ForgeText variant="caption" tone="secondary">目标 · {appState.profile.goal.label}</ForgeText></View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="切换账号，清理当前会话并打开登录页面" onPress={() => { actions.signOut(); router.replace('/login'); }} style={({ pressed }) => [styles.accountAction, pressed && styles.pressed]}><ForgeText variant="caption" tone="accent">切换账号</ForgeText><Ionicons name="arrow-forward" size={16} color={colors.accent} /></Pressable>
    </ForgeCard>

    <ForgeCard style={styles.syncCard}><ForgeSectionHeader title="云端同步" /><ForgeText variant="caption" tone="secondary">{appState.authSession ? `${appState.cloudSyncPending ? '有本地变更待同步 · ' : ''}${syncLabel(appState.cloudSyncStatus, appState.cloudSyncPending)} · ${appState.cloudConnectivity === 'offline' ? '设备离线' : appState.cloudConnectivity === 'online' ? '网络可用' : '网络状态未知'}` : '当前只保存在此设备；登录并连接 FORGE API 后才能同步。'}</ForgeText>{appState.cloudSyncError ? <ForgeText variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="assertive">{appState.cloudSyncError}</ForgeText> : null}{appState.cloudRemoteSummary ? <View style={styles.syncSummary} accessibilityLiveRegion="polite"><ForgeText variant="label">云端版本 {appState.cloudRemoteSummary.revision}</ForgeText><ForgeText variant="caption" tone="secondary">更新时间：{appState.cloudRemoteSummary.updatedAt ? formatLocalizedDateTime(appState.cloudRemoteSummary.updatedAt, '时间未知') : '未记录'}</ForgeText><ForgeText variant="caption" tone="secondary">训练计划动作 {appState.cloudRemoteSummary.exerciseCount} · 已完成训练 {appState.cloudRemoteSummary.trainingCount} · 食物 {appState.cloudRemoteSummary.foodCount} · 饮食记录 {appState.cloudRemoteSummary.foodEntryCount}</ForgeText><ForgeText variant="caption" tone="secondary">健康快照 {appState.cloudRemoteSummary.healthCount} · Coach 消息 {appState.cloudRemoteSummary.coachMessageCount}</ForgeText></View> : null}{appState.cloudRemoteDiff ? <View style={styles.diffSummary} accessibilityLiveRegion="polite"><ForgeText variant="label">本机与云端差异</ForgeText><ForgeText variant="caption" tone="secondary">{appState.cloudRemoteDiff.changedDomains.length ? '发现差异：' + appState.cloudRemoteDiff.changedDomains.join('、') : '当前主要数据一致，可安全核对版本时间。'}</ForgeText><ForgeText variant="caption" tone="tertiary">本机：训练动作 {appState.cloudRemoteDiff.local.exerciseCount} · 训练 {appState.cloudRemoteDiff.local.trainingCount} · 饮食记录 {appState.cloudRemoteDiff.local.foodEntryCount}</ForgeText><ForgeText variant="caption" tone="tertiary">云端：训练动作 {appState.cloudRemoteDiff.remote.exerciseCount} · 训练 {appState.cloudRemoteDiff.remote.trainingCount} · 饮食记录 {appState.cloudRemoteDiff.remote.foodEntryCount}</ForgeText><ForgeText variant="caption" tone="tertiary">合并规则：记录按 ID 合并；单值设置保留本机当前值。</ForgeText></View> : null}<ForgeButton label={appState.cloudSyncStatus === 'syncing' ? '同步中…' : appState.cloudSyncStatus === 'offline' ? '等待网络恢复' : appState.cloudSyncStatus === 'conflict' ? '等待冲突合并' : appState.authSession ? '立即同步' : '登录后同步'} disabled={!appState.authSession || appState.cloudSyncStatus === 'syncing' || appState.cloudSyncStatus === 'conflict' || appState.cloudConnectivity === 'offline'} onPress={() => { void actions.syncNow(); }} /><ForgeButton label={appState.cloudSyncStatus === 'syncing' ? '读取中…' : '查看云端版本'} variant="secondary" disabled={!appState.authSession || appState.cloudSyncStatus === 'syncing' || appState.cloudConnectivity === 'offline'} onPress={() => { void actions.inspectCloud(); }} />{appState.cloudRemoteDiff ? <ForgeButton label={appState.cloudSyncStatus === 'syncing' ? '合并中…' : '合并并同步'} variant="secondary" disabled={!appState.authSession || appState.cloudSyncStatus === 'syncing' || appState.cloudConnectivity === 'offline'} onPress={confirmCloudMerge} /> : null}<ForgeButton label={appState.cloudSyncStatus === 'syncing' ? '恢复中…' : '从云端恢复'} variant="secondary" disabled={!appState.authSession || appState.cloudSyncStatus === 'syncing' || appState.cloudConnectivity === 'offline'} onPress={confirmCloudRestore} /></ForgeCard>

    <View style={styles.section}><ForgeSectionHeader title="个人设置" /><ForgeCard style={styles.listCard}>
      <MenuRow icon="person-outline" title="目标与今日状态" subtitle="目标、体重、睡眠与恢复状态" onPress={() => router.push('/profile')} />
      <MenuRow icon="restaurant-outline" title="我的食物池" subtitle={appState.foods.length ? '已记录 ' + appState.foods.length + ' 项可用食物，供 Coach 规划饮食' : '记录所有能吃的食物，供 Coach 规划饮食'} onPress={() => router.push('/nutrition/foods')} />
      <MenuRow icon="options-outline" title="训练偏好" subtitle="训练日与默认休息时间" onPress={() => router.push('/training-preferences')} />
      <MenuRow icon="notifications-outline" title="提醒与通知" subtitle={Platform.OS === 'web' ? 'Web 不可用 · iOS/Android Dev Client 支持' : '训练开始、休息结束与计划变化'} onPress={() => router.push('/notifications')} />
      <MenuRow icon="heart-outline" title="健康数据连接" subtitle={Platform.OS === 'web' ? 'Web 不可用 · iOS/Android 原生构建支持' : 'Apple 健康 / Health Connect 权限与同步状态'} onPress={() => router.push('/health')} />
      <MenuRow icon="sparkles-outline" title="Coach 数据授权" subtitle={appState.profile.coachDataConsent ? '已允许使用训练、状态和饮食上下文' : '未授权，不会发送个人上下文'} onPress={() => router.push('/coach-consent')} />
    </ForgeCard></View>

    <View style={styles.section}><ForgeSectionHeader title="账户与支持" /><ForgeCard style={styles.listCard}>
      <MenuRow icon="shield-checkmark-outline" title="账号与安全" subtitle="双重验证、登录方式与设备管理" onPress={() => router.push('/security')} />
      {appState.authSession ? <MenuRow icon="log-out-outline" title="退出登录" subtitle="退出并清理此设备上的账户数据" onPress={() => setLogoutOpen(true)} /> : null}
      <MenuRow icon="lock-closed-outline" title="数据与隐私" subtitle={appState.authSession ? '导出或删除你的账户数据' : '当前只保存在此设备，不自动同步云端'} onPress={() => router.push('/privacy')} />
      <MenuRow icon="chatbubble-ellipses-outline" title="帮助与反馈" subtitle="告诉我们哪里还可以更好" onPress={() => router.push('/feedback')} />
    </ForgeCard></View>

    <Modal visible={logoutOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setLogoutOpen(false)} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={() => setLogoutOpen(false)}>
        <Pressable style={styles.confirmSheet} onPress={(event) => event.stopPropagation()}>
          <ForgeText variant="h3">退出登录？</ForgeText>
          <ForgeText tone="secondary">退出后会清理此设备上的账户数据，云端数据不会被删除。下次需要重新输入账号密码登录。</ForgeText>
          <View style={styles.actions}>
            <ForgeButton label="取消" variant="secondary" onPress={() => setLogoutOpen(false)} />
            <Pressable accessibilityRole="button" accessibilityLabel="确认退出登录" onPress={() => { setLogoutOpen(false); actions.signOut(); }} style={styles.logoutConfirm}>
              <ForgeText variant="label" tone="danger">退出并清理</ForgeText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    <Modal visible={restoreOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setRestoreOpen(false)} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={() => setRestoreOpen(false)}>
        <Pressable style={styles.confirmSheet} onPress={(event) => event.stopPropagation()}>
          <ForgeText variant="h3">从云端恢复数据？</ForgeText>
          <ForgeText tone="secondary">这会用云端保存的训练、历史、饮食和健康快照替换本机当前数据。本机数据不会自动合并，请确认云端版本就是你要恢复的版本。</ForgeText>
          <View style={styles.actions}>
            <ForgeButton label="取消" variant="secondary" onPress={() => setRestoreOpen(false)} />
            <Pressable accessibilityRole="button" accessibilityLabel="确认从云端恢复" onPress={() => { setRestoreOpen(false); void actions.restoreFromCloud(); }} style={styles.logoutConfirm}>
              <ForgeText variant="label" tone="accent">从云端恢复</ForgeText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    <ForgeText variant="caption" tone="tertiary" style={styles.version}>FORGE · Adaptive Fitness Coach</ForgeText>
  </ForgeScreen>;
}

function MenuRow({ icon, title, subtitle, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}：${subtitle}`} onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
    <View style={styles.menuIcon}><Ionicons name={icon} size={19} color={colors.textSecondary} /></View>
    <View style={styles.menuCopy}><ForgeText variant="h3">{title}</ForgeText><ForgeText variant="caption" tone="secondary" numberOfLines={1}>{subtitle}</ForgeText></View>
    <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
  </Pressable>;
}

function syncLabel(status: 'disabled' | 'idle' | 'syncing' | 'synced' | 'error' | 'offline' | 'conflict', pending = false) { return status === 'syncing' ? '正在请求同步…' : status === 'synced' ? '云端已确认保存。' : status === 'error' ? '上次同步失败，可以重试。' : status === 'conflict' ? '发现跨设备版本冲突，未覆盖云端。' : status === 'offline' ? '离线，本地变更等待网络恢复。' : pending ? '网络已恢复，准备自动重试同步。' : status === 'disabled' ? '尚未连接云端同步。' : '尚未同步到云端。'; }

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xxs },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxs },
  profileCard: { gap: spacing.md, backgroundColor: colors.surface2 },
  syncCard: { gap: spacing.sm },
  scrim: { flex: 1, justifyContent: 'center', backgroundColor: colors.scrim },
  confirmSheet: { margin: spacing.lg, padding: spacing.lg, gap: spacing.md, borderRadius: radius.medium, backgroundColor: colors.elevated },
  actions: { flexDirection: 'row', gap: spacing.sm },
  logoutConfirm: { minHeight: 48, flex: 1, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  syncSummary: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2 },
  diffSummary: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.warning, backgroundColor: colors.surface2 },
  profileMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 56, height: 56, borderRadius: radius.round, backgroundColor: colors.accentMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  profileCopy: { gap: spacing.xxs },
  accountAction: { minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm },
  section: { gap: spacing.xs },
  listCard: { paddingVertical: spacing.xs },
  menuRow: { minHeight: 64, paddingHorizontal: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  menuIcon: { width: 36, height: 36, borderRadius: radius.small, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  menuCopy: { flex: 1, gap: spacing.xxs },
  version: { textAlign: 'center', paddingTop: spacing.xs },
  pressed: { opacity: 0.68 },
});
