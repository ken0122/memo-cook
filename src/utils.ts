import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, relative, sep } from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeNoteId(date = new Date()): string {
  const stamp = date
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function slugify(value: string, fallback = "memory"): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

export function sanitizeProject(value: string): string {
  return slugify(value, "project");
}

export function normalizeTags(tags?: string[] | string): string[] {
  const values = Array.isArray(tags) ? tags : (tags ?? "").split(",");
  return [...new Set(values.map((tag) => tag.trim()).filter(Boolean))].sort();
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export function relativePosix(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

export function firstMeaningfulLine(value?: string): string | undefined {
  return value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

export function displayTitle(value: string, fallback = "Untitled memory"): string {
  const first = firstMeaningfulLine(value);
  return first ? first.slice(0, 120) : fallback;
}

export function safeBasename(path: string): string {
  return basename(path).replace(/[^\w.\- \u4e00-\u9fff]/g, "_");
}

export function trimForSnippet(value: string, max = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function assertNonEmpty(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
}
