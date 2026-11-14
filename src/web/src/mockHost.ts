// A stand-in for the shell, used only when the page runs in a plain browser during
// development. It holds the day from the design mockups in memory. `?first-run` shows the
// welcome screen, `?conflict` makes the next save collide with a change "from another device".

import type { Host } from './host';
import type { DayContent, DayDto } from './types';

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const sample = (): DayContent => ({
  todo: [
    {
      id: 't7k2',
      done: false,
      title: 'ACME: Fix users with space in username',
      fields: [],
      body: 'Get stats 1 234 (~500 have space in the middle)\nTell Support about it\nRun the script',
    },
    { id: 's3c9', done: false, title: 'ACME: Security fixes', fields: [], body: '' },
    { id: 'p1v5', done: false, title: 'ACME: Catalog: exact-match search for Admin and Support', fields: [], body: 'Waiting on review' },
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

export function mockHost(): Host {
  const params = new URLSearchParams(location.search);
  const today = iso(new Date());
  const yesterday = iso(new Date(Date.now() - 86_400_000));
  const days = new Map<string, { content: DayContent; version: number }>([
    [today, { content: sample(), version: 1 }],
    [yesterday, { content: sample(), version: 1 }],
  ]);
  let folder: string | null = params.has('first-run') ? null : 'C:\\Users\\you\\OneDrive\\Taskii';
  let collide = params.has('conflict');

  const load = (date: string): DayDto => {
    const day = days.get(date);
    const dates = [...days.keys()].sort();
    return {
      date,
      exists: !!day,
      version: day ? String(day.version) : '',
      editable: date === today,
      carriedFrom: null,
      prev: dates.filter((d) => d < date).pop() ?? null,
      next: dates.find((d) => d > date) ?? null,
      ...structuredClone(day?.content ?? { todo: [], backlog: [], notes: [] }),
    };
  };

  const handle = (type: string, payload: any): unknown => {
    switch (type) {
      case 'init':
        return { today, dataFolder: folder, suggestedFolder: 'C:\\Users\\you\\OneDrive\\Taskii', day: folder ? load(today) : null, assetBase: '' };
      case 'chooseFolder':
        folder = 'C:\\Users\\you\\OneDrive\\Taskii';
        return { dataFolder: folder, day: load(today) };
      case 'loadDay':
        return load(payload.date);
      case 'peek':
        return { today, version: String(days.get(payload.date)?.version ?? '') };
      case 'saveDay': {
        const day = days.get(payload.date);
        if (collide && day) {
          collide = false;
          day.version++;
          day.content.todo.unshift({ id: 'zz99', done: false, title: 'Laptop: added on the other machine', fields: [], body: '' });
        }
        const version = String(day?.version ?? '');
        if (version !== payload.baseVersion && !payload.overwrite) return { status: 'conflict', version };
        const next = (day?.version ?? 0) + 1;
        days.set(payload.date, { content: structuredClone(payload.content), version: next });
        console.debug('[mock host] saved', payload.date, payload.content);
        return { status: 'saved', version: String(next) };
      }
      case 'saveAsset':
        // No folder to store it in here, so the image travels inline.
        return { path: `data:${payload.mediaType};base64,${payload.data}` };
      case 'openLink':
        window.open(payload.url, '_blank', 'noopener');
        return null;
      default:
        return null;
    }
  };

  return {
    request: ((type: string, payload?: unknown) =>
      new Promise<unknown>((resolve) => setTimeout(() => resolve(handle(type, payload)), 30))) as Host['request'],
    on(event, handler) {
      if (event === 'activated') window.addEventListener('focus', handler);
    },
  };
}
