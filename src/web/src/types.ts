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
