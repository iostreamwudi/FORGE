import { Linking, Platform } from 'react-native';
import { getMostRecentCategorySample, getMostRecentQuantitySample, isHealthDataAvailable, requestAuthorization } from '@kingstinct/react-native-healthkit';
import { getGrantedPermissions, getSdkStatus, initialize, openHealthConnectDataManagement, readRecords, requestPermission, SdkAvailabilityStatus } from 'react-native-health-connect';

export type HealthProvider = 'apple_health' | 'health_connect';
export type HealthConnectionStatus = 'unavailable' | 'not_connected' | 'connected' | 'permission_denied' | 'error';
export interface HealthConnectionState { provider: HealthProvider | null; status: HealthConnectionStatus; detail: string; }
export interface HealthSummary { weightKg?: number; sleepHours?: number; observedAt?: string; source: 'Apple 健康' | 'Health Connect'; }

const IOS_READ_TYPES = ['HKQuantityTypeIdentifierBodyMass', 'HKCategoryTypeIdentifierSleepAnalysis'] as const;
const ANDROID_PERMISSIONS = [
  { accessType: 'read' as const, recordType: 'Weight' as const },
  { accessType: 'read' as const, recordType: 'SleepSession' as const },
];

export async function inspectHealthConnection(): Promise<HealthConnectionState> {
  if (Platform.OS === 'web') return { provider: null, status: 'unavailable', detail: 'Web 预览不支持系统健康数据。' };
  try {
    if (Platform.OS === 'ios') return isHealthDataAvailable() ? { provider: 'apple_health', status: 'not_connected', detail: '尚未请求 Apple 健康数据权限。' } : { provider: 'apple_health', status: 'unavailable', detail: '此 iOS 设备不支持 Apple 健康数据。' };
    if (Platform.OS === 'android') {
      const sdkStatus = await getSdkStatus();
      if (sdkStatus !== SdkAvailabilityStatus.SDK_AVAILABLE) return { provider: 'health_connect', status: 'unavailable', detail: sdkStatus === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ? 'Health Connect 需要更新后才能使用。' : '此 Android 设备没有可用的 Health Connect。' };
      await initialize();
      const granted = await getGrantedPermissions();
      const connected = ANDROID_PERMISSIONS.every((required) => granted.some((item) => item.accessType === required.accessType && item.recordType === required.recordType));
      return { provider: 'health_connect', status: connected ? 'connected' : 'not_connected', detail: connected ? '已授权读取体重与睡眠数据。' : '尚未授权读取体重与睡眠数据。' };
    }
    return { provider: null, status: 'unavailable', detail: '当前平台不支持系统健康数据。' };
  } catch {
    return { provider: Platform.OS === 'ios' ? 'apple_health' : Platform.OS === 'android' ? 'health_connect' : null, status: 'error', detail: '读取健康数据权限状态失败，请稍后重试。' };
  }
}

export async function requestHealthConnection(): Promise<HealthConnectionState> {
  if (Platform.OS === 'web') return { provider: null, status: 'unavailable', detail: 'Web 预览不支持系统健康数据，请在 iOS 或 Android 真机上操作。' };
  try {
    if (Platform.OS === 'ios') {
      if (!isHealthDataAvailable()) return { provider: 'apple_health', status: 'unavailable', detail: '此 iOS 设备不支持 Apple 健康数据。' };
      const granted = await requestAuthorization({ toRead: IOS_READ_TYPES });
      return granted ? { provider: 'apple_health', status: 'connected', detail: '已提交 Apple 健康数据授权。系统可能仍需要你在健康 App 中确认具体项目。' } : { provider: 'apple_health', status: 'permission_denied', detail: 'Apple 健康数据授权未完成，请在系统健康权限中允许读取。' };
    }
    if (Platform.OS === 'android') {
      const sdkStatus = await getSdkStatus();
      if (sdkStatus !== SdkAvailabilityStatus.SDK_AVAILABLE) return { provider: 'health_connect', status: 'unavailable', detail: 'Health Connect 不可用或需要更新。' };
      await initialize();
      const granted = await requestPermission(ANDROID_PERMISSIONS);
      const connected = ANDROID_PERMISSIONS.every((required) => granted.some((item) => item.accessType === required.accessType && item.recordType === required.recordType));
      return connected ? { provider: 'health_connect', status: 'connected', detail: '已授权读取体重与睡眠数据。' } : { provider: 'health_connect', status: 'permission_denied', detail: 'Health Connect 未授予所需的体重与睡眠读取权限。' };
    }
    return { provider: null, status: 'unavailable', detail: '当前平台不支持系统健康数据。' };
  } catch {
    return { provider: Platform.OS === 'ios' ? 'apple_health' : 'health_connect', status: 'error', detail: '请求健康数据权限失败，请检查系统设置后重试。' };
  }
}

export async function openHealthDataSettings(provider: HealthProvider | null): Promise<void> {
  if (provider === 'health_connect' && Platform.OS === 'android') { openHealthConnectDataManagement(); return; }
  if (provider === 'apple_health' && Platform.OS === 'ios') { await Linking.openSettings(); return; }
  throw new Error('HEALTH_SETTINGS_UNAVAILABLE');
}

export async function readLatestHealthSummary(): Promise<HealthSummary> {
  if (Platform.OS === 'web') throw new Error('HEALTH_DATA_UNAVAILABLE');
  if (Platform.OS === 'ios') {
    if (!isHealthDataAvailable()) throw new Error('HEALTH_DATA_UNAVAILABLE');
    const [weight, sleep] = await Promise.all([
      getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyMass', 'kg'),
      getMostRecentCategorySample('HKCategoryTypeIdentifierSleepAnalysis'),
    ]);
    const summary: HealthSummary = { source: 'Apple 健康' };
    if (weight && Number.isFinite(weight.quantity) && weight.quantity > 0) { summary.weightKg = weight.quantity; summary.observedAt = weight.endDate.toISOString(); }
    if (sleep) { const hours = (sleep.endDate.getTime() - sleep.startDate.getTime()) / 3600000; if (Number.isFinite(hours) && hours > 0 && hours < 24) { summary.sleepHours = Math.round(hours * 10) / 10; summary.observedAt = summary.observedAt ?? sleep.endDate.toISOString(); } }
    return summary;
  }
  if (Platform.OS === 'android') {
    const sdkStatus = await getSdkStatus();
    if (sdkStatus !== SdkAvailabilityStatus.SDK_AVAILABLE) throw new Error('HEALTH_DATA_UNAVAILABLE');
    await initialize();
    const startTime = new Date(Date.now() - 14 * 24 * 3600000).toISOString();
    const [weights, sleeps] = await Promise.all([
      readRecords('Weight', { timeRangeFilter: { operator: 'after', startTime }, ascendingOrder: false, pageSize: 1 }),
      readRecords('SleepSession', { timeRangeFilter: { operator: 'after', startTime }, ascendingOrder: false, pageSize: 1 }),
    ]);
    const summary: HealthSummary = { source: 'Health Connect' };
    const weight = weights.records[0];
    if (weight && Number.isFinite(weight.weight.inKilograms) && weight.weight.inKilograms > 0) { summary.weightKg = weight.weight.inKilograms; summary.observedAt = weight.time; }
    const sleep = sleeps.records[0];
    if (sleep) { const hours = (new Date(sleep.endTime).getTime() - new Date(sleep.startTime).getTime()) / 3600000; if (Number.isFinite(hours) && hours > 0 && hours < 24) { summary.sleepHours = Math.round(hours * 10) / 10; summary.observedAt = summary.observedAt ?? sleep.endTime; } }
    return summary;
  }
  throw new Error('HEALTH_DATA_UNAVAILABLE');
}
