// The days the mock host holds: the day from the design mockups, as it changed over a few weeks.

import type { DayContent } from './types';

export const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** How many days back each sample day is. */
export const SAMPLE_BACK = [47, 46, 45, 42, 40, 39, 38, 33, 32, 8, 7, 6, 5, 4, 3, 2, 1, 0];

/** The date `back` days before today. */
export const ago = (back: number) => iso(new Date(Date.now() - back * 86_400_000));

export const sample = (): DayContent => ({
  todo: [
    {
      id: 't7k2',
      done: false,
      title: 'ACME: Fix users with space in username',
      fields: [],
      body: 'Get stats 1 234 (~500 have space in the middle)\nTell Support about it\nRun the script',
    },
    { id: 's3c9', done: false, title: 'ACME: Security fixes', fields: [], body: '' },
    { id: 'p1v5', done: false, title: 'ACME: Catalog: exact-match search for Admin and Support', fields: [], body: 'Waiting on review of widget-service#413' },
    { id: 'c9d0', done: false, title: 'Federation: Get client secret from Contoso', fields: [], body: '' },
    {
      id: 'a1b3',
      done: false,
      title: 'Federation: Add Contoso Edu to our TEST environment',
      fields: [{ key: 'blocked-by', value: '^c9d0' }],
      body: 'Onboard them, details in Mail\nNo one has received the shared folder, we have reached out to Contoso',
    },
    {
      id: 'q2w3',
      done: true,
      title: 'Dev: Switch all repos to use SharedBuild agent pool',
      fields: [{ key: 'done', value: '2026-11-16T08:40' }],
      body: '',
    },
  ],
  backlog: [
    {
      id: 'r3c4',
      done: false,
      title: 'ACME: ReCaptcha: switch to Enterprise project',
      fields: [],
      body: "I need additional permissions, I've asked IT for it\nThey can't give it. I've created a new project\nBusiness on vacation, so let's wait",
    },
    { id: 'm4n5', done: false, title: 'Portal infra: Use refresh tokens on PROD', fields: [], body: '- [ ] Apply new portalv3 and portal-admin' },
    { id: 'e2e7', done: false, title: 'ACME: e2e test fails on staging with mailosaur', fields: [], body: '' },
  ],
  notes: [
    {
      heading: 'Catalog search PR',
      body: 'Draft ready, waiting on review. [widget-service#413](https://github.com/owner/widget-service/pull/413)',
      sides: [{ heading: 'Edge cases', body: 'Email match must ignore case, username must not.' }],
    },
    {
      heading: '10:05 Sprint planning',
      body: 'Security fixes go out before the 24th.\nCheck who owns the Contoso shared folder.\nDemo single sign-out next sprint.',
      sides: [],
    },
    { heading: 'Useful commands', body: '```\nkubectl logs -f deploy/identity --since=10m\naz account get-access-token\n```', sides: [] },
    { heading: 'Ask Micke', body: 'Business account for ReCaptcha?\n- Did the mailosaur inbox id change?\n  - [x] Asked in chat', sides: [] },
  ],
});

export interface StoredDay {
  content: DayContent;
  version: number;
}

/**
 * Nine days ending today, with things arriving, changing and leaving along the way, so search has a
 * past to look in. A few older ones are scattered over the weeks before, so the calendar has months to turn.
 */
export function sampleDays(): Map<string, StoredDay> {
  const days = new Map<string, StoredDay>();
  for (const back of SAMPLE_BACK) {
    const date = ago(back);
    const content = sample();

    const contoso = content.todo.find((task) => task.id === 'a1b3')!;
    if (back > 5) {
      content.todo = content.todo.filter((task) => task.id !== 'c9d0');
      contoso.fields = [];
      contoso.body = 'Onboard them, details in Mail';
    } else if (back > 2) {
      contoso.body = "Onboard them, details in Mail\nWe're missing the Client Secret";
    }

    if (back > 3) {
      content.todo.push({
        id: 'k1c0',
        done: back < 6,
        title: 'Federation: Contoso Edu kickoff call',
        fields: back < 6 ? [{ key: 'done', value: '2026-11-10T10:00' }] : [],
        body: 'Agreed to start with TEST, PROD after their term break',
      });
    }

    const pool = content.todo.find((task) => task.id === 'q2w3')!;
    if (back > 0) {
      pool.done = false;
      pool.fields = [];
      content.notes = content.notes.filter((note) => note.heading !== '10:05 Sprint planning');
    }
    if (back > 1) {
      content.notes.push({ heading: 'Contoso contacts', body: 'IT lead and identity architect, emails in the kickoff invite', sides: [] });
    }

    days.set(date, { content, version: 1 });
  }
  return days;
}
