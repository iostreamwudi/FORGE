import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient && Constants.appOwnership === 'expo';
}

async function loadNotifications(): Promise<NotificationsModule> {
  if (isExpoGo()) throw new Error('NOTIFICATIONS_UNAVAILABLE_IN_EXPO_GO');
  return import('expo-notifications');
}

export async function scheduleWorkoutReminders(trainingDays: number[], hour: number, minute: number): Promise<string[]> {
  if (Platform.OS === 'web') throw new Error('NOTIFICATIONS_UNAVAILABLE_ON_WEB');
  if (isExpoGo()) throw new Error('NOTIFICATIONS_UNAVAILABLE_IN_EXPO_GO');
  if (trainingDays.length === 0) throw new Error('TRAINING_DAYS_REQUIRED');
  const Notifications = await loadNotifications();
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('NOTIFICATION_PERMISSION_DENIED');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('workout-reminders', { name: '训练提醒', importance: Notifications.AndroidImportance.DEFAULT });
  const identifiers = await Promise.all(trainingDays.map((day) => Notifications.scheduleNotificationAsync({ content: { title: 'FORGE 训练提醒', body: '你的训练日到了，打开 FORGE 查看今天计划。', data: { type: 'workout-reminder' } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: day === 7 ? 1 : day + 1, hour, minute, ...(Platform.OS === 'android' ? { channelId: 'workout-reminders' } : {}) } })));
  return identifiers;
}

export async function cancelWorkoutReminders(identifiers: string[] = []): Promise<void> {
  if (Platform.OS === 'web') throw new Error('NOTIFICATIONS_UNAVAILABLE_ON_WEB');
  if (isExpoGo()) throw new Error('NOTIFICATIONS_UNAVAILABLE_IN_EXPO_GO');
  const Notifications = await loadNotifications();
  await Promise.all(identifiers.map((identifier) => Notifications.cancelScheduledNotificationAsync(identifier)));
}

export async function getNotificationPermissionState(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  if (Platform.OS === 'web' || isExpoGo()) return 'unavailable';
  const Notifications = await loadNotifications();
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted ? 'granted' : permission.canAskAgain ? 'undetermined' : 'denied';
}
