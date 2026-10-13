import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ForgeButton, ForgeCard, ForgeIconButton, ForgeScreen, ForgeSectionHeader, ForgeText, colors, radius, spacing } from '@/design-system';
import { cancelWorkoutReminders, getNotificationPermissionState, scheduleWorkoutReminders } from '@/data/notificationService';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';

export function NotificationsScreen() {
  const state = useForgeAppState();
  const actions = useForgeAppActions();
  const saved = state.profile.notificationPreferences;
  const [enabled, setEnabled] = useState(saved?.workoutReminderEnabled ?? false);
  const [hour, setHour] = useState(String(saved?.reminderHour ?? 9));
  const [minute, setMinute] = useState(String(saved?.reminderMinute ?? 0).padStart(2, '0'));
  const [permission, setPermission] = useState<'granted' | 'denied' | 'undetermined' | 'unavailable'>('undetermined');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notificationUnavailable = Platform.OS === 'web' || permission === 'unavailable';

  useEffect(() => { getNotificationPermissionState().then(setPermission).catch(() => setPermission('unavailable')); }, []);
  const retryPermission = () => { setError(null); void getNotificationPermissionState().then(setPermission).catch(() => setPermission('unavailable')); };
  const save = async () => {
    const nextHour = Number(hour); const nextMinute = Number(minute);
    if (!Number.isInteger(nextHour) || nextHour < 0 || nextHour > 23 || !Number.isInteger(nextMinute) || nextMinute < 0 || nextMinute > 59) { setError('请输入有效时间：小时 0–23，分钟 0–59。'); return; }
    setError(null); setSaving(true);
    try {
      const oldIds = saved?.scheduledNotificationIds ?? [];
      if (oldIds.length) await cancelWorkoutReminders(oldIds);
      if (!enabled) { actions.updateNotificationPreferences(undefined); return; }
      const ids = await scheduleWorkoutReminders(state.profile.trainingPreferences?.trainingDays ?? [], nextHour, nextMinute);
      actions.updateNotificationPreferences({ workoutReminderEnabled: true, reminderHour: nextHour, reminderMinute: nextMinute, scheduledNotificationIds: ids });
    } catch (requestError: unknown) {
      const message = requestError instanceof Error ? requestError.message : '';
      setError(message === 'TRAINING_DAYS_REQUIRED' ? '请先在训练偏好中选择至少一个训练日。' : message === 'NOTIFICATION_PERMISSION_DENIED' ? '系统通知权限未开启，请在设备设置中允许 FORGE 通知。' : message === 'NOTIFICATIONS_UNAVAILABLE_ON_WEB' ? 'Web 预览不支持系统通知，请在 iOS 或 Android 真机上开启。' : message === 'NOTIFICATIONS_UNAVAILABLE_IN_EXPO_GO' ? 'Expo Go 不支持系统通知。请安装 FORGE development build 后再开启；当前不会伪造提醒已开启。' : '提醒保存失败，请检查系统权限后重试。');
    } finally { setSaving(false); }
  };

  return <ForgeScreen contentStyle={styles.content}><View style={styles.header}><ForgeIconButton icon="chevron-back" label="返回我的" variant="ghost" onPress={() => router.back()} /><View style={styles.headerCopy}><ForgeText variant="h2">提醒与通知</ForgeText><ForgeText variant="caption" tone="secondary">只会使用你明确授权的系统通知权限。</ForgeText></View><View style={styles.headerSpacer} /></View>
    <ForgeCard style={styles.card}><ForgeSectionHeader title="训练日提醒" /><ForgeText variant="caption" tone="secondary">按训练偏好中选择的日期，在设定时间提醒你打开真实训练计划。</ForgeText><View style={styles.permission}><ForgeText variant="label">系统通知</ForgeText><ForgeText variant="caption" tone={permission === 'granted' ? 'accent' : 'secondary'}>{Platform.OS === 'web' ? 'Web 不可用' : permission === 'unavailable' ? 'Expo Go 不支持' : permission === 'granted' ? '已授权' : permission === 'denied' ? '已拒绝' : '尚未授权'}</ForgeText></View><Pressable accessibilityRole="switch" accessibilityLabel="开启训练日提醒" accessibilityState={{ checked: enabled, disabled: notificationUnavailable }} disabled={notificationUnavailable} onPress={() => setEnabled((current) => !current)} style={({ pressed }) => [styles.switchRow, pressed && styles.pressed]}><View style={styles.switchCopy}><ForgeText variant="label">开启训练日提醒</ForgeText><ForgeText variant="caption" tone="tertiary">{notificationUnavailable ? '请使用 FORGE development build 访问系统通知。' : '关闭后会取消已安排的本地提醒。'}</ForgeText></View><View style={[styles.switch, enabled && styles.switchOn]}><View style={[styles.knob, enabled && styles.knobOn]} /></View></Pressable><View style={styles.timeRow}><View style={styles.timeField}><ForgeText variant="caption" tone="secondary">小时</ForgeText><TextInput accessibilityLabel="提醒小时" value={hour} onChangeText={setHour} keyboardType="number-pad" inputMode="numeric" maxLength={2} style={styles.timeInput} /></View><ForgeText variant="h2">:</ForgeText><View style={styles.timeField}><ForgeText variant="caption" tone="secondary">分钟</ForgeText><TextInput accessibilityLabel="提醒分钟" value={minute} onChangeText={setMinute} keyboardType="number-pad" inputMode="numeric" maxLength={2} style={styles.timeInput} /></View></View>{error ? <View style={styles.errorBlock}><ForgeText variant="caption" tone="danger" accessibilityLiveRegion="assertive">{error}</ForgeText><Pressable accessibilityRole="button" accessibilityLabel="重新检查通知权限" onPress={retryPermission}><ForgeText variant="label" tone="accent">重新检查权限</ForgeText></Pressable></View> : null}{notificationUnavailable ? <Pressable accessibilityRole="link" accessibilityLabel="查看 development build 安装说明" onPress={() => { void Linking.openURL('https://docs.expo.dev/develop/development-builds/introduction/'); }}><ForgeText variant="caption" tone="accent">查看 development build 安装说明</ForgeText></Pressable> : null}<ForgeButton label="保存提醒设置" loading={saving} disabled={saving || notificationUnavailable} onPress={save} /></ForgeCard>
    <ForgeCard style={styles.card}><ForgeText variant="label">当前范围</ForgeText><ForgeText variant="caption" tone="secondary">FORGE 当前只调度训练日提醒。休息计时会在训练页面内运行；其他通知类型尚未连接服务，不会显示为已开启。</ForgeText></ForgeCard>
  </ForgeScreen>;
}

const styles = StyleSheet.create({ errorBlock: { gap: spacing.xs }, content: { gap: spacing.lg }, header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, headerCopy: { flex: 1, gap: spacing.xxs }, headerSpacer: { width: 44 }, card: { gap: spacing.md }, permission: { minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, switchRow: { minHeight: 64, padding: spacing.sm, borderRadius: radius.small, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, switchCopy: { flex: 1, gap: spacing.xxs }, switch: { width: 52, height: 32, padding: 3, borderRadius: radius.round, backgroundColor: colors.surfacePressed, justifyContent: 'center' }, switchOn: { backgroundColor: colors.accent }, knob: { width: 26, height: 26, borderRadius: radius.round, backgroundColor: colors.textSecondary }, knobOn: { alignSelf: 'flex-end', backgroundColor: colors.background }, timeRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.sm }, timeField: { alignItems: 'center', gap: spacing.xs }, timeInput: { width: 64, minHeight: 48, borderRadius: radius.small, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.textPrimary, textAlign: 'center', fontSize: 18 }, pressed: { opacity: 0.7 } });
