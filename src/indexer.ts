import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { findMarkdownFiles, readNoteFile } from "./markdown.js";
import { trimForSnippet } from "./utils.js";
import type { MemoLink, NoteRecord, NoteSearchResult, SearchInput } from "./types.js";

type NoteRow = {
  id: string;
  title: string;
  path: string;
  status: string;
  scope: string;
  project: string | null;
  tags: string;
  source_type: string;
  source_url: string | null;
  attachments: string;
  links: string;
  created_at: string;
  updated_at: string;
  content: string;
  snippet?: string;
  rank?: number;
};

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseLinks(value: string | null | undefined): MemoLink[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is MemoLink => Boolean(item?.id) && typeof item.id === "string")
      : [];
  } catch {
    return [];
  }
}

function toSearchResult(row: NoteRow): NoteSearchResult {
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    status: row.status as NoteSearchResult["status"],
    scope: row.scope as NoteSearchResult["scope"],
    project: row.project ?? undefined,
    tags: parseJsonArray(row.tags),
    source_type: row.source_type as NoteSearchResult["source_type"],
    source_url: row.source_url ?? undefined,
    attachments: parseJsonArray(row.attachments),
    links: parseLinks(row.links),
    created_at: row.created_at,
    updated_at: row.updated_at,
    snippet: row.snippet || trimForSnippet(row.content),
    score: row.rank
  };
}

function tokenizeFts(input: string): string | undefined {
  const tokens = input.match(/[\p{Letter}\p{Number}_]+/gu) ?? [];
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}

function matchesTags(row: NoteSearchResult, requiredTags?: string[]): boolean {
  if (!requiredTags?.length) {
    return true;
  }
  const rowTags = new Set(row.tags);
  return requiredTags.every((tag) => rowTags.has(tag));
}

export class MemoIndex {
  private readonly db: Database.Database;

  constructor(private readonly home: string) {
    const dbPath = join(home, "index.sqlite");
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  ensureSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        scope TEXT NOT NULL,
        project TEXT,
        tags TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        attachments TEXT NOT NULL,
        links TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS links (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation TEXT,
        PRIMARY KEY (from_id, to_id, relation)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        id UNINDEXED,
        title,
        content,
        tags,
        project,
        scope,
        tokenize = 'unicode61'
      );
    `);
  }

  indexNote(note: NoteRecord): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO notes (
            id, title, path, status, scope, project, tags, source_type, source_url,
            attachments, links, created_at, updated_at, content
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          note.id,
          note.title,
          note.path,
          note.status,
          note.scope,
          note.project ?? null,
          JSON.stringify(note.tags),
          note.source_type,
          note.source_url ?? null,
          JSON.stringify(note.attachments),
          JSON.stringify(note.links),
          note.created_at,
          note.updated_at,
          note.content
        );
      this.db.prepare("DELETE FROM notes_fts WHERE id = ?").run(note.id);
      this.db
        .prepare("INSERT INTO notes_fts (id, title, content, tags, project, scope) VALUES (?, ?, ?, ?, ?, ?)")
        .run(note.id, note.title, note.content, note.tags.join(" "), note.project ?? "", note.scope);
      this.db.prepare("DELETE FROM links WHERE from_id = ?").run(note.id);
      for (const link of note.links) {
        this.db
          .prepare("INSERT OR REPLACE INTO links (from_id, to_id, relation) VALUES (?, ?, ?)")
          .run(note.id, link.id, link.relation ?? "");
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  removeNote(id: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM notes_fts WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM links WHERE from_id = ? OR to_id = ?").run(id, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getPathById(id: string): string | undefined {
    const row = this.db.prepare("SELECT path FROM notes WHERE id = ?").get(id) as { path?: string } | undefined;
    return row?.path;
  }

  search(input: SearchInput): NoteSearchResult[] {
    const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
    const requiredTags = input.tags ?? [];
    const candidates = Math.max(limit * 5, 25);
    const fts = tokenizeFts(input.query);

    if (fts) {
      try {
        const rows = this.searchFts(fts, input, candidates);
        const filtered = rows.map(toSearchResult).filter((row) => matchesTags(row, requiredTags));
        return filtered.slice(0, limit);
      } catch {
        return this.searchLike(input, candidates).filter((row) => matchesTags(row, requiredTags)).slice(0, limit);
      }
    }

    return this.searchLike(input, candidates).filter((row) => matchesTags(row, requiredTags)).slice(0, limit);
  }

  listInbox(input: { project?: string; limit?: number } = {}): NoteSearchResult[] {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const where = ["status = ?"];
    const params: Array<string | number> = ["inbox"];
    if (input.project) {
      where.push("project = ?");
      params.push(input.project);
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT *, substr(content, 1, 240) AS snippet
         FROM notes
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(...params) as NoteRow[];
    return rows.map(toSearchResult);
  }

  async rebuild(notesRoot: string): Promise<number> {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM links").run();
      this.db.prepare("DELETE FROM notes").run();
      this.db.prepare("DELETE FROM notes_fts").run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const files = await findMarkdownFiles(notesRoot);
    let count = 0;
    for (const file of files) {
      const note = await readNoteFile(file);
      this.indexNote(note);
      count += 1;
    }
    return count;
  }

  private searchFts(fts: string, input: SearchInput, limit: number): NoteRow[] {
    const where = ["notes_fts MATCH ?"];
    const params: Array<string | number> = [fts];
    if (input.scope) {
      where.push("n.scope = ?");
      params.push(input.scope);
    }
    if (input.project) {
      where.push("n.project = ?");
      params.push(input.project);
    }
    params.push(limit);

    return this.db
      .prepare(
        `SELECT n.*, snippet(notes_fts, 2, '[', ']', '...', 24) AS snippet, bm25(notes_fts) AS rank
         FROM notes_fts
         JOIN notes n ON n.id = notes_fts.id
         WHERE ${where.join(" AND ")}
         ORDER BY rank
         LIMIT ?`
      )
      .all(...params) as NoteRow[];
  }

  private searchLike(input: SearchInput, limit: number): NoteSearchResult[] {
    const like = `%${input.query}%`;
    const where = ["(title LIKE ? OR content LIKE ? OR tags LIKE ?)"];
    const params: Array<string | number> = [like, like, like];
    if (input.scope) {
      where.push("scope = ?");
      params.push(input.scope);
    }
    if (input.project) {
      where.push("project = ?");
      params.push(input.project);
    }
    params.push(limit);

    const rows = this.db
      .prepare(
        `SELECT *, substr(content, 1, 240) AS snippet
         FROM notes
         WHERE ${where.join(" AND ")}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...params) as NoteRow[];
    return rows.map(toSearchResult);
  }
}
