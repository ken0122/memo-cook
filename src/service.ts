import { access, copyFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { resolveMemoHome } from "./config.js";
import { MemoIndex } from "./indexer.js";
import { findMarkdownFiles, readNoteFile, writeNoteFile } from "./markdown.js";
import { fetchUrlSnapshot } from "./url.js";
import {
  assertNonEmpty,
  displayTitle,
  ensureDir,
  makeNoteId,
  normalizeTags,
  nowIso,
  safeBasename,
  sanitizeProject,
  slugify,
  trimForSnippet
} from "./utils.js";
import type {
  CaptureInput,
  LinkInput,
  MemoryScope,
  NoteFrontmatter,
  NoteRecord,
  NoteSearchResult,
  NoteStatus,
  OrganizeInput,
  SearchInput,
  SourceType
} from "./types.js";

export type MemoCookOptions = {
  home?: string;
};

export class MemoCook {
  readonly home: string;
  readonly notesRoot: string;
  readonly attachmentsRoot: string;
  private readonly index: MemoIndex;

  constructor(options: MemoCookOptions = {}) {
    this.home = resolveMemoHome(options.home);
    this.notesRoot = join(this.home, "notes");
    this.attachmentsRoot = join(this.home, "attachments");
    this.index = new MemoIndex(this.home);
  }

  async init(): Promise<void> {
    await ensureDir(join(this.notesRoot, "inbox"));
    await ensureDir(join(this.notesRoot, "global"));
    await ensureDir(join(this.notesRoot, "projects"));
    await ensureDir(this.attachmentsRoot);
  }

  close(): void {
    this.index.close();
  }

  async capture(input: CaptureInput): Promise<NoteSearchResult> {
    await this.init();
    const kind = this.inferKind(input);
    const id = makeNoteId();
    const createdAt = nowIso();
    const tags = normalizeTags(input.tags);
    const scope: MemoryScope = input.project ? "project" : input.scope ?? "global";
    const project = input.project?.trim() || undefined;
    const attachments: string[] = [];

    let title: string;
    let content: string;
    let sourceUrl: string | undefined;

    if (kind === "text") {
      assertNonEmpty(input.text, "capture --text requires non-empty text");
      title = input.title?.trim() || displayTitle(input.text);
      content = input.text.trim();
    } else if (kind === "url") {
      assertNonEmpty(input.url, "capture --url requires a URL");
      sourceUrl = input.url.trim();
      const snapshot = await this.captureUrl(sourceUrl);
      title = input.title?.trim() || snapshot.title;
      sourceUrl = snapshot.finalUrl || sourceUrl;
      content = snapshot.content;
    } else {
      assertNonEmpty(input.imagePath, "capture --image requires an image path");
      assertNonEmpty(input.note, "capture --image requires --note so the image is searchable in v1");
      title = input.title?.trim() || displayTitle(input.note, `Image memory ${id}`);
      const attachment = await this.copyAttachment(id, input.imagePath);
      attachments.push(attachment.relativePath);
      content = [
        input.note.trim(),
        "",
        "## Attachments",
        `- ${attachment.fileName}: ${attachment.relativePath}`
      ].join("\n");
    }

    const frontmatter: NoteFrontmatter = {
      id,
      title,
      status: "inbox",
      scope,
      project,
      tags,
      source_type: kind,
      source_url: sourceUrl,
      attachments,
      links: [],
      created_at: createdAt,
      updated_at: createdAt
    };

    const path = await this.uniqueNotePath("inbox", frontmatter);
    await writeNoteFile(path, frontmatter, content);
    const note = await readNoteFile(path);
    this.index.indexNote(note);
    return this.toSearchResult(note);
  }

  search(input: SearchInput): NoteSearchResult[] {
    assertNonEmpty(input.query, "search requires a non-empty query");
    return this.index.search({
      ...input,
      tags: normalizeTags(input.tags)
    });
  }

  async read(id: string): Promise<NoteRecord> {
    assertNonEmpty(id, "read requires a note id");
    const path = await this.findNotePath(id);
    if (!path) {
      throw new Error(`No note found for id ${id}`);
    }
    return readNoteFile(path);
  }

  listInbox(input: { project?: string; limit?: number } = {}): NoteSearchResult[] {
    return this.index.listInbox(input);
  }

  async organize(id: string, input: OrganizeInput): Promise<NoteSearchResult> {
    assertNonEmpty(id, "organize requires a note id");
    const current = await this.read(id);
    const updatedAt = nowIso();
    const project = input.project?.trim() || current.project;
    const status = input.status ?? (current.status === "inbox" ? "active" : current.status);
    const scope: MemoryScope = project ? "project" : "global";
    const frontmatter: NoteFrontmatter = {
      ...current,
      title: input.title?.trim() || current.title,
      status: status as NoteStatus,
      scope,
      project,
      tags: input.tags ? normalizeTags(input.tags) : current.tags,
      updated_at: updatedAt
    };

    const nextPath = await this.uniqueNotePath(status, frontmatter, current.path);
    await writeNoteFile(nextPath, frontmatter, current.content);
    if (nextPath !== current.path) {
      await unlink(current.path).catch(() => undefined);
      this.index.removeNote(current.id);
    }
    const note = await readNoteFile(nextPath);
    this.index.indexNote(note);
    return this.toSearchResult(note);
  }

  async link(input: LinkInput): Promise<NoteSearchResult> {
    assertNonEmpty(input.fromId, "link requires fromId");
    assertNonEmpty(input.toId, "link requires toId");
    const from = await this.read(input.fromId);
    await this.read(input.toId);
    const relation = input.relation?.trim() || undefined;
    const exists = from.links.some((link) => link.id === input.toId && (link.relation || undefined) === relation);
    const frontmatter: NoteFrontmatter = {
      ...from,
      links: exists ? from.links : [...from.links, { id: input.toId, relation }],
      updated_at: nowIso()
    };
    await writeNoteFile(from.path, frontmatter, from.content);
    const note = await readNoteFile(from.path);
    this.index.indexNote(note);
    return this.toSearchResult(note);
  }

  async rebuildIndex(): Promise<{ indexed: number }> {
    await this.init();
    const indexed = await this.index.rebuild(this.notesRoot);
    return { indexed };
  }

  private inferKind(input: CaptureInput): SourceType {
    if (input.kind) {
      return input.kind;
    }
    if (input.url) {
      return "url";
    }
    if (input.imagePath) {
      return "image";
    }
    return "text";
  }

  private async captureUrl(url: string): Promise<{ title: string; finalUrl?: string; content: string }> {
    try {
      const snapshot = await fetchUrlSnapshot(url);
      const metadata = [
        `- URL: ${snapshot.finalUrl}`,
        snapshot.description ? `- Description: ${snapshot.description}` : undefined,
        snapshot.author ? `- Author: ${snapshot.author}` : undefined,
        snapshot.publishedAt ? `- Published: ${snapshot.publishedAt}` : undefined,
        snapshot.contentType ? `- Content-Type: ${snapshot.contentType}` : undefined
      ].filter(Boolean);
      return {
        title: snapshot.title || `URL: ${url}`,
        finalUrl: snapshot.finalUrl,
        content: [
          "## Source",
          ...metadata,
          "",
          "## Extracted Content",
          snapshot.text || "(No readable body text extracted.)"
        ].join("\n")
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        title: `URL: ${url}`,
        finalUrl: url,
        content: ["## Source", `- URL: ${url}`, `- Capture failed: ${reason}`, "", "## Notes", "Link card saved for later review."].join(
          "\n"
        )
      };
    }
  }

  private async copyAttachment(id: string, imagePath: string): Promise<{ fileName: string; relativePath: string }> {
    await stat(imagePath);
    const fileName = safeBasename(imagePath);
    const dir = join(this.attachmentsRoot, id);
    await ensureDir(dir);
    const destination = join(dir, fileName);
    await copyFile(imagePath, destination);
    return {
      fileName,
      relativePath: `attachments/${id}/${fileName}`
    };
  }

  private noteDirectory(status: NoteStatus, frontmatter: NoteFrontmatter): string {
    if (status === "inbox") {
      return join(this.notesRoot, "inbox");
    }
    if (frontmatter.scope === "project" && frontmatter.project) {
      return join(this.notesRoot, "projects", sanitizeProject(frontmatter.project));
    }
    return join(this.notesRoot, "global");
  }

  private async uniqueNotePath(status: NoteStatus, frontmatter: NoteFrontmatter, currentPath?: string): Promise<string> {
    const dir = this.noteDirectory(status, frontmatter);
    await ensureDir(dir);
    const base = `${frontmatter.id}-${slugify(frontmatter.title)}.md`;
    let candidate = join(dir, base);
    if (candidate === currentPath || !(await this.pathExists(candidate))) {
      return candidate;
    }
    for (let index = 2; index < 100; index += 1) {
      candidate = join(dir, `${frontmatter.id}-${slugify(frontmatter.title)}-${index}.md`);
      if (candidate === currentPath || !(await this.pathExists(candidate))) {
        return candidate;
      }
    }
    throw new Error(`Could not allocate a unique note path for ${frontmatter.id}`);
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async findNotePath(id: string): Promise<string | undefined> {
    const indexedPath = this.index.getPathById(id);
    if (indexedPath && (await this.pathExists(indexedPath))) {
      return indexedPath;
    }
    const files = await findMarkdownFiles(this.notesRoot);
    for (const file of files) {
      try {
        const note = await readNoteFile(file);
        if (note.id === id) {
          return file;
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private toSearchResult(note: NoteRecord): NoteSearchResult {
    return {
      id: note.id,
      title: note.title,
      path: note.path,
      status: note.status,
      scope: note.scope,
      project: note.project,
      tags: note.tags,
      source_type: note.source_type,
      source_url: note.source_url,
      attachments: note.attachments,
      links: note.links,
      created_at: note.created_at,
      updated_at: note.updated_at,
      snippet: trimForSnippet(note.content)
    };
  }
}
