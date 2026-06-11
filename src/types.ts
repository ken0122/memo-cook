export const sourceTypes = ["text", "url", "image"] as const;
export const memoryScopes = ["global", "project"] as const;
export const noteStatuses = ["inbox", "active", "archived"] as const;

export type SourceType = (typeof sourceTypes)[number];
export type MemoryScope = (typeof memoryScopes)[number];
export type NoteStatus = (typeof noteStatuses)[number];

export type MemoLink = {
  id: string;
  relation?: string;
};

export type NoteFrontmatter = {
  id: string;
  title: string;
  status: NoteStatus;
  scope: MemoryScope;
  project?: string;
  tags: string[];
  source_type: SourceType;
  source_url?: string;
  attachments: string[];
  links: MemoLink[];
  created_at: string;
  updated_at: string;
};

export type NoteRecord = NoteFrontmatter & {
  path: string;
  content: string;
};

export type NoteSearchResult = NoteFrontmatter & {
  path: string;
  snippet: string;
  score?: number;
  match_reasons?: string[];
};

export type CaptureInput = {
  kind?: SourceType;
  text?: string;
  url?: string;
  imagePath?: string;
  note?: string;
  title?: string;
  tags?: string[];
  project?: string;
  scope?: MemoryScope;
};

export type SearchInput = {
  query: string;
  tags?: string[];
  project?: string;
  scope?: MemoryScope;
  limit?: number;
};

export type OrganizeInput = {
  title?: string;
  tags?: string[];
  project?: string;
  status?: Exclude<NoteStatus, "inbox">;
};

export type LinkInput = {
  fromId: string;
  toId: string;
  relation?: string;
};
