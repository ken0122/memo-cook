import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { ensureDir } from "./utils.js";
import type { MemoLink, MemoryScope, NoteFrontmatter, NoteRecord, NoteStatus, SourceType } from "./types.js";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function asLinks(value: unknown): MemoLink[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const link = item as Record<string, unknown>;
      if (typeof link.id !== "string" || !link.id) {
        return undefined;
      }
      if (typeof link.relation === "string" && link.relation) {
        return { id: link.id, relation: link.relation };
      }
      return { id: link.id };
    })
    .filter((item): item is MemoLink => Boolean(item));
}

function cleanFrontmatter(frontmatter: NoteFrontmatter): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {
    id: frontmatter.id,
    title: frontmatter.title,
    status: frontmatter.status,
    scope: frontmatter.scope,
    tags: frontmatter.tags,
    source_type: frontmatter.source_type,
    attachments: frontmatter.attachments,
    links: frontmatter.links,
    created_at: frontmatter.created_at,
    updated_at: frontmatter.updated_at
  };
  if (frontmatter.project) {
    cleaned.project = frontmatter.project;
  }
  if (frontmatter.source_url) {
    cleaned.source_url = frontmatter.source_url;
  }
  return cleaned;
}

export function parseFrontmatter(data: Record<string, unknown>): NoteFrontmatter {
  const id = asString(data.id);
  if (!id) {
    throw new Error("Note is missing required frontmatter field: id");
  }

  return {
    id,
    title: asString(data.title, "Untitled memory"),
    status: asString(data.status, "inbox") as NoteStatus,
    scope: asString(data.scope, "global") as MemoryScope,
    project: asString(data.project) || undefined,
    tags: asStringArray(data.tags),
    source_type: asString(data.source_type, "text") as SourceType,
    source_url: asString(data.source_url) || undefined,
    attachments: asStringArray(data.attachments),
    links: asLinks(data.links),
    created_at: asString(data.created_at),
    updated_at: asString(data.updated_at)
  };
}

export async function readNoteFile(path: string): Promise<NoteRecord> {
  const raw = await readFile(path, "utf8");
  const parsed = matter(raw);
  const frontmatter = parseFrontmatter(parsed.data);
  return {
    ...frontmatter,
    path,
    content: parsed.content.trim()
  };
}

export async function writeNoteFile(path: string, frontmatter: NoteFrontmatter, content: string): Promise<void> {
  await ensureDir(dirname(path));
  const markdown = matter.stringify(`${content.trim()}\n`, cleanFrontmatter(frontmatter));
  await writeFile(path, markdown, "utf8");
}

export async function findMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return findMarkdownFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    })
  );

  return paths.flat();
}
