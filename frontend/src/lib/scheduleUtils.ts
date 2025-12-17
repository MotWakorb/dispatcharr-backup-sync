import type { SchedulePreset, TimeFormat } from '../types';

// Constants
export const PRESET_LABELS: Record<SchedulePreset, string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom',
};

export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun', fullLabel: 'Sunday' },
  { value: 1, label: 'Mon', fullLabel: 'Monday' },
  { value: 2, label: 'Tue', fullLabel: 'Tuesday' },
  { value: 3, label: 'Wed', fullLabel: 'Wednesday' },
  { value: 4, label: 'Thu', fullLabel: 'Thursday' },
  { value: 5, label: 'Fri', fullLabel: 'Friday' },
  { value: 6, label: 'Sat', fullLabel: 'Saturday' },
] as const;

export const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`,
}));

export const MINUTES = [
  { value: 0, label: ':00' },
  { value: 15, label: ':15' },
  { value: 30, label: ':30' },
  { value: 45, label: ':45' },
];

export const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1}${getOrdinalSuffix(i + 1)}`,
}));

// Utility functions
export function getOrdinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function formatTime(hour: number, minute: number, timeFormat: TimeFormat): string {
  if (timeFormat === '24h') {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  // 12h format
  const period = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
}

// Cron expression utilities
export interface CronParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  dayOfWeek: number;
  selectedDays: number[];
}

export function buildCronExpression(
  preset: SchedulePreset,
  minute: number,
  hour: number,
  dayOfWeek: number,
  dayOfMonth: number,
  selectedDays: number[]
): string {
  switch (preset) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${dayOfWeek}`;
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`;
    case 'custom':
      const days = selectedDays.length > 0 ? selectedDays.sort((a, b) => a - b).join(',') : '1';
      return `${minute} ${hour} * * ${days}`;
    default:
      return '0 2 * * *';
  }
}

export function parseCronExpression(cron: string | undefined): CronParts {
  const defaults: CronParts = {
    minute: 0,
    hour: 2,
    dayOfMonth: 1,
    dayOfWeek: 0,
    selectedDays: [1],
  };

  if (!cron) return defaults;

  const parts = cron.split(' ');
  if (parts.length < 5) return defaults;

  const minute = parseInt(parts[0]) || 0;
  const hour = parts[1] === '*' ? 0 : parseInt(parts[1]) || 2;
  const dayOfMonth = parts[2] === '*' ? 1 : parseInt(parts[2]) || 1;

  // Parse day of week - could be single value or comma-separated list
  const dayOfWeekPart = parts[4];
  let dayOfWeek = 0;
  let selectedDays: number[] = [1];

  if (dayOfWeekPart === '*') {
    dayOfWeek = 0;
    selectedDays = [1];
  } else if (dayOfWeekPart.includes(',')) {
    selectedDays = dayOfWeekPart.split(',').map(d => parseInt(d) || 0);
    dayOfWeek = selectedDays[0] || 0;
  } else {
    dayOfWeek = parseInt(dayOfWeekPart) || 0;
    selectedDays = [dayOfWeek];
  }

  return { minute, hour, dayOfMonth, dayOfWeek, selectedDays };
}

export function formatScheduleDescription(
  preset: SchedulePreset,
  cronExpression: string | undefined,
  timeFormat: TimeFormat
): string {
  if (!cronExpression) return PRESET_LABELS[preset];

  const parts = cronExpression.split(' ');
  if (parts.length < 5) return cronExpression;

  const minute = parseInt(parts[0]) || 0;
  const hour = parts[1] === '*' ? null : parseInt(parts[1]);
  const dayOfMonth = parts[2] === '*' ? null : parseInt(parts[2]);
  const dayOfWeekPart = parts[4];

  const timeStr = hour !== null ? formatTime(hour, minute, timeFormat) : `at :${minute.toString().padStart(2, '0')}`;

  switch (preset) {
    case 'hourly':
      return `Every hour at :${minute.toString().padStart(2, '0')}`;
    case 'daily':
      return `Daily at ${timeStr}`;
    case 'weekly':
      const dayOfWeek = dayOfWeekPart === '*' ? 0 : parseInt(dayOfWeekPart) || 0;
      const dayName = DAYS_OF_WEEK.find(d => d.value === dayOfWeek)?.fullLabel || 'Sunday';
      return `${dayName}s at ${timeStr}`;
    case 'monthly':
      return `${dayOfMonth}${getOrdinalSuffix(dayOfMonth || 1)} at ${timeStr}`;
    case 'custom':
      if (dayOfWeekPart.includes(',')) {
        const days = dayOfWeekPart.split(',').map(d => parseInt(d) || 0);
        const dayNames = days.map(d => DAYS_OF_WEEK.find(dow => dow.value === d)?.label || '?');
        return `${dayNames.join(', ')} at ${timeStr}`;
      } else {
        const singleDay = parseInt(dayOfWeekPart) || 0;
        const singleDayName = DAYS_OF_WEEK.find(d => d.value === singleDay)?.fullLabel || 'Monday';
        return `${singleDayName}s at ${timeStr}`;
      }
    default:
      return cronExpression;
  }
}

// Time conversion utilities for 12h/24h formats
export interface TimeState {
  hour24: number;
  minute: number;
  typedHour: string;
  typedMinute: string;
  ampm: 'AM' | 'PM';
}

export function parseTypedTime(
  typedHour: string,
  typedMinute: string,
  ampm: 'AM' | 'PM',
  timeFormat: TimeFormat
): { hour24: number; minute: number; error: string | null } {
  const hour = parseInt(typedHour, 10);
  const minute = parseInt(typedMinute, 10);

  // Validate minute
  if (isNaN(minute) || minute < 0 || minute > 59) {
    return { hour24: 0, minute: 0, error: 'Minutes must be 0-59' };
  }

  if (timeFormat === '12h') {
    // 12-hour format validation
    if (isNaN(hour) || hour < 1 || hour > 12) {
      return { hour24: 0, minute: 0, error: 'Hour must be 1-12 in 12-hour format' };
    }
    // Convert to 24h
    let hour24: number;
    if (ampm === 'AM') {
      hour24 = hour === 12 ? 0 : hour;
    } else {
      hour24 = hour === 12 ? 12 : hour + 12;
    }
    return { hour24, minute, error: null };
  } else {
    // 24-hour format validation
    if (isNaN(hour) || hour < 0 || hour > 23) {
      return { hour24: 0, minute: 0, error: 'Hour must be 0-23 in 24-hour format' };
    }
    return { hour24: hour, minute, error: null };
  }
}

export function hour24ToDisplayTime(hour24: number, minute: number, timeFormat: TimeFormat): {
  typedHour: string;
  typedMinute: string;
  ampm: 'AM' | 'PM';
} {
  let typedHour: string;
  let ampm: 'AM' | 'PM' = 'AM';

  if (timeFormat === '12h') {
    if (hour24 === 0) {
      typedHour = '12';
      ampm = 'AM';
    } else if (hour24 < 12) {
      typedHour = String(hour24);
      ampm = 'AM';
    } else if (hour24 === 12) {
      typedHour = '12';
      ampm = 'PM';
    } else {
      typedHour = String(hour24 - 12);
      ampm = 'PM';
    }
  } else {
    typedHour = String(hour24);
  }

  return {
    typedHour,
    typedMinute: minute.toString().padStart(2, '0'),
    ampm,
  };
}
