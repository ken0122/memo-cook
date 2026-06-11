#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { MemoCook } from "./service.js";
import { runMcpServer } from "./mcp.js";
import type { CaptureInput, MemoryScope, NoteStatus } from "./types.js";
import { normalizeTags } from "./utils.js";

function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function collectTags(value?: string): string[] | undefined {
  const tags = normalizeTags(value);
  return tags.length ? tags : undefined;
}

function service(home?: string): MemoCook {
  return new MemoCook({ home });
}

export async function main(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("memo-cook")
    .description("Explicit, traceable Markdown memory outboard for agents.")
    .version("0.1.0")
    .option("--home <path>", "override MEMO_COOK_HOME for this command");

  program
    .command("mcp")
    .description("start the Memo Cook MCP server on stdio")
    .action(async () => {
      const opts = program.opts<{ home?: string }>();
      await runMcpServer({ home: opts.home });
    });

  program
    .command("capture")
    .description("explicitly capture text, a URL, or an image attachment into inbox")
    .option("--kind <kind>", "text, url, or image")
    .option("--text <text>", "text fragment to save")
    .option("--url <url>", "URL to fetch and save")
    .option("--image <path>", "image path to copy into attachments")
    .option("--note <text>", "human/agent note, required for image capture")
    .option("--title <title>", "memory title")
    .option("--tags <tags>", "comma-separated tags")
    .option("--project <project>", "project/workspace scope")
    .option("--scope <scope>", "global or project")
    .action(async (opts) => {
      const root = service(program.opts<{ home?: string }>().home);
      const input: CaptureInput = {
        kind: opts.kind,
        text: opts.text,
        url: opts.url,
        imagePath: opts.image,
        note: opts.note,
        title: opts.title,
        tags: collectTags(opts.tags),
        project: opts.project,
        scope: opts.scope as MemoryScope | undefined
      };
      json(await root.capture(input));
      root.close();
    });

  program
    .command("search")
    .description("search saved memories")
    .argument("<query>", "search query")
    .option("--tags <tags>", "comma-separated required tags")
    .option("--project <project>", "filter to project")
    .option("--scope <scope>", "global or project")
    .option("--limit <number>", "max results", (value) => Number.parseInt(value, 10))
    .action((query: string, opts) => {
      const root = service(program.opts<{ home?: string }>().home);
      json(
        root.search({
          query,
          tags: collectTags(opts.tags),
          project: opts.project,
          scope: opts.scope as MemoryScope | undefined,
          limit: opts.limit
        })
      );
      root.close();
    });

  program
    .command("read")
    .description("read one memory by id")
    .argument("<id>", "note id")
    .action(async (id) => {
      const root = service(program.opts<{ home?: string }>().home);
      json(await root.read(id));
      root.close();
    });

  program
    .command("inbox")
    .description("list inbox memories")
    .option("--project <project>", "filter to project")
    .option("--limit <number>", "max results", (value) => Number.parseInt(value, 10))
    .action((opts) => {
      const root = service(program.opts<{ home?: string }>().home);
      json(root.listInbox({ project: opts.project, limit: opts.limit }));
      root.close();
    });

  program
    .command("organize")
    .description("organize an inbox memory into global or project notes")
    .argument("<id>", "note id")
    .option("--title <title>", "new title")
    .option("--tags <tags>", "comma-separated replacement tags")
    .option("--project <project>", "project/workspace scope")
    .option("--status <status>", "active or archived", "active")
    .action(async (id, opts) => {
      const root = service(program.opts<{ home?: string }>().home);
      json(
        await root.organize(id, {
          title: opts.title,
          tags: collectTags(opts.tags),
          project: opts.project,
          status: opts.status as Exclude<NoteStatus, "inbox">
        })
      );
      root.close();
    });

  program
    .command("link")
    .description("link one memory to another")
    .argument("<from_id>", "source note id")
    .argument("<to_id>", "target note id")
    .option("--relation <relation>", "relationship label")
    .action(async (fromId, toId, opts) => {
      const root = service(program.opts<{ home?: string }>().home);
      json(await root.link({ fromId, toId, relation: opts.relation }));
      root.close();
    });

  program
    .command("reindex")
    .description("rebuild SQLite FTS index from Markdown notes")
    .action(async () => {
      const root = service(program.opts<{ home?: string }>().home);
      json(await root.rebuildIndex());
      root.close();
    });

  await program.parseAsync(argv);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
