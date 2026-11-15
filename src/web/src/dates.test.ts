import { describe, expect, it } from 'vitest';
import { ageLabel, daysBetween } from './dates';

describe('ages', () => {
  it('counts days across months and years', () => {
    expect(daysBetween('2026-11-13', '2026-11-16')).toBe(3);
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-11-16', '2026-11-16')).toBe(0);
  });

  it('says an age in a word', () => {
    expect([0, 1, 6, 7, 13, 14, 62, 63, 364, 365, 800].map((days) => ageLabel(days, true))).toEqual([
      'today', '1d', '6d', '1w', '1w', '2w', '8w', '2mo', '12mo', '1y', '2y',
    ]);
    // Looking at a past day, "today" would be the wrong word for what was new then.
    expect(ageLabel(0, false)).toBe('new');
  });
});
