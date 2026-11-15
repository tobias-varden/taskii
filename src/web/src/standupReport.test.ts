import { describe, expect, it } from 'vitest';
import { buildReport, reportText } from './standupReport';
import type { DayContent, StandupDto, TaskDto } from './types';

const task = (id: string, title: string, body = '', extra: Partial<TaskDto> = {}): TaskDto => ({ id, done: false, title, fields: [], body, ...extra });
const done = (id: string, title: string, at: string | null, body = ''): TaskDto =>
  task(id, title, body, { done: true, fields: at ? [{ key: 'done', value: at }] : [] });

const friday: DayContent = {
  todo: [
    task('spc', 'ACME: Fix users with space in username', 'Get stats 1 234'),
    task('sec', 'ACME: Security fixes'),
    task('contoso', 'Federation: Add Contoso Edu to our TEST environment', 'Onboard them, details in Mail'),
    done('old', 'Dev: Reported on friday', '2026-11-13T08:00'),
  ],
  backlog: [task('cap', 'ACME: ReCaptcha', 'Waiting for IT')],
  notes: [],
};

const monday: DayContent = {
  todo: [
    task('spc', 'ACME: Fix users with space in username', 'Get stats 1 234\n  - Tell Support about it\nRun the script'),
    task('key', 'Federation: Get client secret from Contoso'),
    task('sec', 'ACME: Security fixes'),
    task('contoso', 'Federation: Add Contoso Edu to our TEST environment', 'Onboard them, details in Mail\nWe have reached out to Contoso', {
      fields: [{ key: 'blocked-by', value: '^key' }],
    }),
    task('cap', 'ACME: ReCaptcha', 'Waiting for IT'),
    done('old', 'Dev: Reported on friday', '2026-11-13T08:00'),
    done('pool', 'Dev: Switch all repos to the new agent pool', '2026-11-13T15:00', 'Went fine'),
    done('mail', 'ACME: Support: no emails being sent', null),
    task('', ''),
  ],
  backlog: [task('later', 'Someday: not shown')],
  notes: [],
};

const last: StandupDto = { since: '2026-11-13T09:15', baseline: friday };
const titles = (tasks: Array<{ tag: string | null; title: string }>) => tasks.map((t) => (t.tag ? `${t.tag}: ${t.title}` : t.title));

describe('standup report', () => {
  const report = buildReport(monday, last);

  it('reads out the done tasks that have not been reported yet', () => {
    expect(titles(report.done)).toEqual(['Dev: Switch all repos to the new agent pool', 'ACME: Support: no emails being sent']);
  });

  it('groups open tasks by tag, in the order the tags come in the list', () => {
    expect(titles(report.working)).toEqual([
      'ACME: Fix users with space in username',
      'ACME: Security fixes',
      'ACME: ReCaptcha',
      'Federation: Get client secret from Contoso',
    ]);
  });

  it('says how each open task compares to the last standup', () => {
    expect(report.working.map((t) => t.change)).toEqual(['changed', 'unchanged', 'fromBacklog', 'new']);
  });

  it('marks the lines written since, wherever they are indented to', () => {
    expect(report.working[0].lines.map((line) => line.isNew)).toEqual([false, true, true]);
    // A task that is new as a whole has nothing singled out.
    expect(report.working[2].lines.map((line) => line.isNew)).toEqual([false]);
  });

  it('lists a task as blocked while its blocker is open', () => {
    expect(titles(report.blocked)).toEqual(['Federation: Add Contoso Edu to our TEST environment']);
    expect(report.blocked[0].blockedBy).toBe('Get client secret from Contoso');
    expect(report.blocked[0].lines.map((line) => line.isNew)).toEqual([false, true]);

    const unblocked = buildReport({ ...monday, todo: monday.todo.map((t) => (t.id === 'key' ? { ...t, done: true } : t)) }, last);
    expect(unblocked.blocked).toEqual([]);
    expect(titles(unblocked.working)).toContain('Federation: Add Contoso Edu to our TEST environment');
  });

  it('leaves the backlog and empty tasks out', () => {
    const all = titles([...report.done, ...report.working, ...report.blocked]);
    expect(all).not.toContain('Someday: not shown');
    expect(all).toHaveLength(7);
  });

  it('compares against nothing before the first standup', () => {
    const first = buildReport(monday, { since: null, baseline: null });
    expect(first.done).toHaveLength(3);
    expect(first.working.every((t) => t.change === null && t.lines.every((line) => !line.isNew))).toBe(true);
  });

  it('copies as plain text with only what is new under a task reported before', () => {
    expect(reportText(report, 'Standup Mon 16 Nov 2026')).toBe(
      [
        'Standup Mon 16 Nov 2026',
        '',
        'Done',
        '- Dev: Switch all repos to the new agent pool',
        '    Went fine',
        '- ACME: Support: no emails being sent',
        '',
        'Working on',
        '- ACME: Fix users with space in username',
        '      - Tell Support about it',
        '    Run the script',
        '- ACME: Security fixes (no change)',
        '- ACME: ReCaptcha (from backlog)',
        '    Waiting for IT',
        '- Federation: Get client secret from Contoso (new task)',
        '',
        'Blocked',
        '- Federation: Add Contoso Edu to our TEST environment (blocked by Get client secret from Contoso)',
        '    We have reached out to Contoso',
        '',
      ].join('\n'),
    );
  });
});
