import { describe, it, expect } from 'vitest';
import {
  getOrdinalSuffix,
  formatTime,
  buildCronExpression,
  parseCronExpression,
  formatScheduleDescription,
  parseTypedTime,
  hour24ToDisplayTime,
} from './scheduleUtils';

describe('scheduleUtils', () => {
  describe('getOrdinalSuffix', () => {
    it('should return "st" for numbers ending in 1 (except 11)', () => {
      expect(getOrdinalSuffix(1)).toBe('st');
      expect(getOrdinalSuffix(21)).toBe('st');
      expect(getOrdinalSuffix(31)).toBe('st');
    });

    it('should return "nd" for numbers ending in 2 (except 12)', () => {
      expect(getOrdinalSuffix(2)).toBe('nd');
      expect(getOrdinalSuffix(22)).toBe('nd');
    });

    it('should return "rd" for numbers ending in 3 (except 13)', () => {
      expect(getOrdinalSuffix(3)).toBe('rd');
      expect(getOrdinalSuffix(23)).toBe('rd');
    });

    it('should return "th" for 11, 12, 13', () => {
      expect(getOrdinalSuffix(11)).toBe('th');
      expect(getOrdinalSuffix(12)).toBe('th');
      expect(getOrdinalSuffix(13)).toBe('th');
    });

    it('should return "th" for other numbers', () => {
      expect(getOrdinalSuffix(4)).toBe('th');
      expect(getOrdinalSuffix(10)).toBe('th');
      expect(getOrdinalSuffix(15)).toBe('th');
    });
  });

  describe('formatTime', () => {
    it('should format time in 24h format', () => {
      expect(formatTime(0, 0, '24h')).toBe('00:00');
      expect(formatTime(14, 30, '24h')).toBe('14:30');
      expect(formatTime(9, 5, '24h')).toBe('09:05');
    });

    it('should format time in 12h format', () => {
      expect(formatTime(0, 0, '12h')).toBe('12:00 AM');
      expect(formatTime(12, 0, '12h')).toBe('12:00 PM');
      expect(formatTime(14, 30, '12h')).toBe('2:30 PM');
      expect(formatTime(9, 5, '12h')).toBe('9:05 AM');
    });
  });

  describe('buildCronExpression', () => {
    it('should build hourly cron expression', () => {
      expect(buildCronExpression('hourly', 30, 0, 0, 1, [])).toBe('30 * * * *');
    });

    it('should build daily cron expression', () => {
      expect(buildCronExpression('daily', 0, 2, 0, 1, [])).toBe('0 2 * * *');
    });

    it('should build weekly cron expression', () => {
      expect(buildCronExpression('weekly', 0, 2, 3, 1, [])).toBe('0 2 * * 3');
    });

    it('should build monthly cron expression', () => {
      expect(buildCronExpression('monthly', 0, 2, 0, 15, [])).toBe('0 2 15 * *');
    });

    it('should build custom cron expression with multiple days', () => {
      expect(buildCronExpression('custom', 30, 14, 0, 1, [1, 3, 5])).toBe('30 14 * * 1,3,5');
    });

    it('should use day 1 as default for custom with empty selectedDays', () => {
      expect(buildCronExpression('custom', 0, 0, 0, 1, [])).toBe('0 0 * * 1');
    });
  });

  describe('parseCronExpression', () => {
    it('should return defaults for undefined', () => {
      const result = parseCronExpression(undefined);
      expect(result.minute).toBe(0);
      expect(result.hour).toBe(2);
      expect(result.dayOfMonth).toBe(1);
    });

    it('should parse hourly cron', () => {
      const result = parseCronExpression('30 * * * *');
      expect(result.minute).toBe(30);
      expect(result.hour).toBe(0); // * becomes 0
    });

    it('should parse daily cron', () => {
      const result = parseCronExpression('0 14 * * *');
      expect(result.minute).toBe(0);
      expect(result.hour).toBe(14);
    });

    it('should parse weekly cron', () => {
      const result = parseCronExpression('0 2 * * 3');
      expect(result.dayOfWeek).toBe(3);
      expect(result.selectedDays).toEqual([3]);
    });

    it('should parse custom cron with multiple days', () => {
      const result = parseCronExpression('30 14 * * 1,3,5');
      expect(result.selectedDays).toEqual([1, 3, 5]);
      expect(result.dayOfWeek).toBe(1);
    });
  });

  describe('formatScheduleDescription', () => {
    it('should format hourly schedule', () => {
      expect(formatScheduleDescription('hourly', '30 * * * *', '12h')).toBe('Every hour at :30');
    });

    it('should format daily schedule', () => {
      expect(formatScheduleDescription('daily', '0 14 * * *', '12h')).toBe('Daily at 2:00 PM');
      expect(formatScheduleDescription('daily', '0 14 * * *', '24h')).toBe('Daily at 14:00');
    });

    it('should format weekly schedule', () => {
      expect(formatScheduleDescription('weekly', '0 2 * * 3', '12h')).toContain('Wednesday');
    });

    it('should format monthly schedule', () => {
      expect(formatScheduleDescription('monthly', '0 2 15 * *', '12h')).toContain('15th');
    });

    it('should return preset label for empty cron', () => {
      expect(formatScheduleDescription('daily', undefined, '12h')).toBe('Daily');
    });
  });

  describe('parseTypedTime', () => {
    describe('12h format', () => {
      it('should parse valid 12h time in AM', () => {
        expect(parseTypedTime('9', '30', 'AM', '12h')).toEqual({
          hour24: 9,
          minute: 30,
          error: null,
        });
      });

      it('should parse valid 12h time in PM', () => {
        expect(parseTypedTime('2', '30', 'PM', '12h')).toEqual({
          hour24: 14,
          minute: 30,
          error: null,
        });
      });

      it('should handle 12 AM (midnight)', () => {
        expect(parseTypedTime('12', '00', 'AM', '12h')).toEqual({
          hour24: 0,
          minute: 0,
          error: null,
        });
      });

      it('should handle 12 PM (noon)', () => {
        expect(parseTypedTime('12', '00', 'PM', '12h')).toEqual({
          hour24: 12,
          minute: 0,
          error: null,
        });
      });

      it('should error for invalid hour', () => {
        expect(parseTypedTime('13', '00', 'AM', '12h').error).not.toBeNull();
        expect(parseTypedTime('0', '00', 'AM', '12h').error).not.toBeNull();
      });
    });

    describe('24h format', () => {
      it('should parse valid 24h time', () => {
        expect(parseTypedTime('14', '30', 'AM', '24h')).toEqual({
          hour24: 14,
          minute: 30,
          error: null,
        });
      });

      it('should handle midnight', () => {
        expect(parseTypedTime('0', '00', 'AM', '24h')).toEqual({
          hour24: 0,
          minute: 0,
          error: null,
        });
      });

      it('should error for invalid hour', () => {
        expect(parseTypedTime('24', '00', 'AM', '24h').error).not.toBeNull();
        expect(parseTypedTime('-1', '00', 'AM', '24h').error).not.toBeNull();
      });
    });

    it('should error for invalid minutes', () => {
      expect(parseTypedTime('12', '60', 'AM', '12h').error).not.toBeNull();
      expect(parseTypedTime('12', '-1', 'AM', '12h').error).not.toBeNull();
    });
  });

  describe('hour24ToDisplayTime', () => {
    describe('12h format', () => {
      it('should convert midnight', () => {
        const result = hour24ToDisplayTime(0, 0, '12h');
        expect(result.typedHour).toBe('12');
        expect(result.ampm).toBe('AM');
      });

      it('should convert noon', () => {
        const result = hour24ToDisplayTime(12, 0, '12h');
        expect(result.typedHour).toBe('12');
        expect(result.ampm).toBe('PM');
      });

      it('should convert afternoon', () => {
        const result = hour24ToDisplayTime(14, 30, '12h');
        expect(result.typedHour).toBe('2');
        expect(result.typedMinute).toBe('30');
        expect(result.ampm).toBe('PM');
      });

      it('should convert morning', () => {
        const result = hour24ToDisplayTime(9, 5, '12h');
        expect(result.typedHour).toBe('9');
        expect(result.typedMinute).toBe('05');
        expect(result.ampm).toBe('AM');
      });
    });

    describe('24h format', () => {
      it('should keep 24h values', () => {
        const result = hour24ToDisplayTime(14, 30, '24h');
        expect(result.typedHour).toBe('14');
        expect(result.typedMinute).toBe('30');
      });
    });
  });
});
