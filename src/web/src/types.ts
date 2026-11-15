// The shapes exchanged with the shell. They mirror Taskii.Core.Days.DayContent and the
// records in Taskii.App's HostBridge.

export interface TaskField {
  key: string;
  value: string;
}

export interface TaskDto {
  id: string;
  done: boolean;
  /** Markdown, one line. */
  title: string;
  fields: TaskField[];
  /** Markdown, without the indentation it has in the file. */
  body: string;
}

export interface SideDto {
  heading: string;
  body: string;
}

export interface NoteDto {
  heading: string;
  body: string;
  sides: SideDto[];
}

export interface DayContent {
  todo: TaskDto[];
  backlog: TaskDto[];
  notes: NoteDto[];
}

export interface DayDto extends DayContent {
  /** yyyy-MM-dd */
  date: string;
  exists: boolean;
  /** Fingerprint of the file on disk; empty when there is no file. */
  version: string;
  /** Only today can be edited. */
  editable: boolean;
  /** The day this one continues from, while it has no file of its own yet. */
  carriedFrom: string | null;
  prev: string | null;
  next: string | null;
}

export interface InitResult {
  today: string;
  dataFolder: string | null;
  /** Where the shell would put the data folder if asked to pick for the user. */
  suggestedFolder: string | null;
  day: DayDto | null;
  /** URL prefix that pasted images are loaded from; an image at `assets/x.png` is at `<assetBase>x.png`. */
  assetBase: string;
}

export interface AssetResult {
  /** Path relative to the data folder, as written in markdown: `assets/3fa9c1d2e7.png`. */
  path: string;
}

export interface FolderResult {
  dataFolder: string;
  day: DayDto;
}

export interface SaveResult {
  status: 'saved' | 'unchanged' | 'conflict';
  version: string;
}

export interface PeekResult {
  today: string;
  version: string;
}

export interface CaptureTag {
  tag: string;
  /** How many open tasks carry it. */
  open: number;
}

export interface CaptureTask {
  id: string;
  title: string;
  backlog: boolean;
}

/** What the quick capture bar knows about today. */
export interface CaptureContext {
  /** False until a data folder has been chosen. */
  ready: boolean;
  assetBase: string;
  tags: CaptureTag[];
  /** Open tasks, Todo first. */
  tasks: CaptureTask[];
}

/** The last standup that was finished. Both are null when there has been none. */
export interface StandupDto {
  /** When it was finished, local time, written like the time on a done task: 2026-11-13T09:15. */
  since: string | null;
  /** The day as it was at that moment. */
  baseline: DayContent | null;
}

export type CaptureKind = 'todo' | 'backlog' | 'note' | 'append';

export type ItemKind = 'task' | 'note';

export interface SearchRequest {
  /** Every word must be found, as the start of a word. */
  text: string;
  kind: ItemKind | null;
  tag: string | null;
  /** Open or done on the last day the task appears. Anything but 'any' leaves notes out. */
  state: 'any' | 'open' | 'done';
}

/** One task or note, however many days it lived on. */
export interface SearchHit {
  /** Identifies the item across days; what `searchItem` takes. */
  key: string;
  kind: ItemKind;
  /** The task's title or the note's heading on the latest day it matched. Markdown. */
  title: string;
  /** The rest of its text on that day; for a note that includes its side notes. Markdown. */
  body: string;
  tag: string | null;
  /** Whether a task was done on the last day it appears. */
  done: boolean;
  first: string;
  last: string;
  /** How many days it appears on. */
  days: number;
}

export interface SearchResponse {
  /** Newest first. */
  hits: SearchHit[];
  /** How many items matched; more than `hits` holds when there were too many to send. */
  total: number;
  /** How many different days the matching items appear on. */
  days: number;
  /** Every tag there is to narrow by, most used first. */
  tags: string[];
}

/** An item as it was on one or more days. Exactly one of `task` and `note` is set. */
export interface ItemVersion {
  section: 'todo' | 'backlog' | 'notes';
  task: TaskDto | null;
  note: NoteDto | null;
}

/** Something that has to do with an item: its blocker, a task waiting for it, or whatever mentions the same ticket. */
export interface RelatedItem {
  /** The related item; what `searchItem` takes. */
  key: string;
  kind: ItemKind;
  relation: 'blockedBy' | 'blocks' | 'ticket';
  /** Its title or heading on `date`. Markdown. */
  title: string;
  done: boolean;
  /** The last day it appears on, or for a shared ticket the last day it mentioned it. */
  date: string;
  /** The ticket both mention, such as `AB#4521` or `widget-service#413`. */
  ticket: string | null;
}

/** Every day an item appears on, oldest first, and what it looked like on each. */
export interface ItemHistory {
  key: string;
  kind: ItemKind;
  days: Array<{ date: string; /** Index into `versions`. */ version: number }>;
  versions: ItemVersion[];
  /** For each of `versions`, what the item was related to in that state. */
  related: RelatedItem[][];
}
