const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

type DateInput = Date | string | null | undefined;

function resolveDate(value: DateInput): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalizedDate(value: DateInput, fallback = '时间未知'): string {
  const date = resolveDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date) : fallback;
}

export function formatLocalizedDateTime(value: DateInput, fallback = '时间未知'): string {
  const date = resolveDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : fallback;
}

export function formatLocalizedTime(value: DateInput, fallback = '时间未知'): string {
  const date = resolveDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date) : fallback;
}

export function formatRelativeTime(value: DateInput, fallback = '时间未知', reference = Date.now()): string {
  const date = resolveDate(value);
  if (!date) return fallback;
  const deltaMs = date.getTime() - reference;
  const absoluteMs = Math.abs(deltaMs);
  if (absoluteMs < 60 * 1000) return '刚刚';
  const units = [
    { threshold: 60 * 60 * 1000, divisor: 60 * 1000, unit: 'minute' as const },
    { threshold: 24 * 60 * 60 * 1000, divisor: 60 * 60 * 1000, unit: 'hour' as const },
    { threshold: 7 * 24 * 60 * 60 * 1000, divisor: 24 * 60 * 60 * 1000, unit: 'day' as const },
  ];
  const match = units.find(({ threshold }) => absoluteMs < threshold);
  if (!match) return formatLocalizedDate(date, fallback);
  try {
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(deltaMs / match.divisor), match.unit);
  } catch {
    return formatLocalizedDate(date, fallback);
  }
}

export function formatChineseDate(date: Date): string {
  return String(date.getMonth() + 1) + ' 月 ' + String(date.getDate()) + ' 日 · 星期' + WEEKDAYS[date.getDay()];
}

export function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' }).format(date);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function getGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 6) return '夜深了。';
  if (hour < 12) return '早上好。';
  if (hour < 18) return '下午好。';
  return '晚上好。';
}
