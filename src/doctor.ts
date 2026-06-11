import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { resolveMemoHome } from "./config.js";
import { findMarkdownFiles } from "./markdown.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type DoctorCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type DoctorReport = {
  home: string;
  ok: boolean;
  checks: DoctorCheck[];
  stats: {
    markdown_notes: number;
    indexed_notes?: number;
  };
  suggestions: string[];
};

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command: string): boolean {
  if (command.includes("/")) {
    try {
      execFileSync("test", ["-x", command], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function pluginCommandChecks(root: string): Promise<DoctorCheck[]> {
  const pluginConfigs = [
    join(root, "plugins", "codex-memo-cook", ".mcp.json"),
    join(root, "plugins", "claude-memo-cook", ".mcp.json")
  ];
  const checks: DoctorCheck[] = [];
  for (const configPath of pluginConfigs) {
    try {
      const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
        mcpServers?: Record<string, { command?: string; args?: string[] }>;
      };
      const command = parsed.mcpServers?.["memo-cook"]?.command;
      checks.push({
        name: `plugin command ${configPath}`,
        ok: Boolean(command && commandExists(command)),
        detail: command ? `${command} ${(parsed.mcpServers?.["memo-cook"]?.args ?? []).join(" ")}`.trim() : "missing command"
      });
    } catch (error) {
      checks.push({
        name: `plugin command ${configPath}`,
        ok: false,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return checks;
}

export async function runDoctor(options: { home?: string; repoRoot?: string } = {}): Promise<DoctorReport> {
  const home = resolveMemoHome(options.home);
  const notesRoot = join(home, "notes");
  const indexPath = join(home, "index.sqlite");
  const checks: DoctorCheck[] = [];
  const suggestions: string[] = [];

  const homeExists = await canAccess(home, constants.F_OK);
  checks.push({ name: "home exists", ok: homeExists, detail: home });
  checks.push({ name: "home readable", ok: homeExists && (await canAccess(home, constants.R_OK)), detail: home });
  checks.push({ name: "home writable", ok: homeExists && (await canAccess(home, constants.W_OK)), detail: home });

  const markdownFiles = await findMarkdownFiles(notesRoot);
  checks.push({ name: "notes readable", ok: homeExists && (await canAccess(notesRoot, constants.R_OK)), detail: notesRoot });

  const indexExists = await canAccess(indexPath, constants.F_OK);
  let indexedNotes: number | undefined;
  if (indexExists) {
    try {
      const db = new Database(indexPath, { readonly: true, fileMustExist: true });
      indexedNotes = (db.prepare("SELECT COUNT(*) AS count FROM notes").get() as { count: number }).count;
      db.close();
      checks.push({ name: "index readable", ok: true, detail: indexPath });
    } catch (error) {
      checks.push({
        name: "index readable",
        ok: false,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    checks.push({ name: "index readable", ok: false, detail: "index.sqlite not found" });
  }

  const indexStat = indexExists ? await stat(indexPath).catch(() => undefined) : undefined;
  const newestNote = (
    await Promise.all(markdownFiles.map((file) => stat(file).then((value) => value.mtimeMs).catch(() => 0)))
  ).reduce((max, value) => Math.max(max, value), 0);
  const indexFresh = Boolean(indexStat && indexedNotes === markdownFiles.length && indexStat.mtimeMs >= newestNote);
  checks.push({
    name: "index fresh",
    ok: indexFresh,
    detail: `markdown=${markdownFiles.length}, indexed=${indexedNotes ?? "unknown"}`
  });

  const repoRoot = options.repoRoot ?? packageRoot;
  checks.push(...(await pluginCommandChecks(repoRoot)));

  if (!homeExists) {
    suggestions.push("Run a write command such as memo-cook capture, or set MEMO_COOK_HOME to an existing store.");
  }
  if (!indexFresh) {
    suggestions.push("Run memo-cook reindex to rebuild SQLite from Markdown notes.");
  }
  if (checks.some((check) => check.name.startsWith("plugin command") && !check.ok)) {
    suggestions.push("Install Node/npm or edit plugin .mcp.json to point at a working memo-cook command.");
  }

  return {
    home,
    ok: checks.every((check) => check.ok),
    checks,
    stats: {
      markdown_notes: markdownFiles.length,
      indexed_notes: indexedNotes
    },
    suggestions
  };
}
