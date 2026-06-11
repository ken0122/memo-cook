import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoCook } from "../src/service.js";

type EvalCase = {
  name: string;
  run: (memo: MemoCook, fixtures: Record<string, string>, home: string) => Promise<void> | void;
};

async function main(): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "memo-cook-eval-"));
  const memo = new MemoCook({ home });
  const fixtures: Record<string, string> = {};

  try {
    fixtures.preference = (
      await memo.capture({
        text: "Codex prefers concise answers with evidence and explicit source notes.",
        title: "Answer style preference",
        tags: ["preference", "agent"]
      })
    ).id;
    fixtures.architecture = (
      await memo.capture({
        text: "Memo Cook stores Markdown as the source of truth and rebuilds SQLite FTS plus gram indexes from it.",
        title: "Markdown truth source",
        tags: ["architecture", "agent"],
        project: "memo-cook"
      })
    ).id;
    fixtures.otherProject = (
      await memo.capture({
        text: "Another project uses markdown for publishing drafts.",
        title: "Publishing notes",
        tags: ["architecture"],
        project: "other-project"
      })
    ).id;
    fixtures.chinese = (
      await memo.capture({
        text: "我喜欢在项目分析里先给结论，再给具体证据。",
        title: "中文回复偏好",
        tags: ["偏好", "中文"],
        project: "memo-cook"
      })
    ).id;
    fixtures.brokenUrl = (
      await memo.capture({
        url: "notaurl",
        title: "Broken link fixture",
        tags: ["url"],
        project: "memo-cook"
      })
    ).id;
    const imagePath = join(home, "whiteboard.png");
    await writeFile(imagePath, Buffer.from("fake png bytes"));
    fixtures.image = (
      await memo.capture({
        imagePath,
        note: "Screenshot of the agent memory architecture whiteboard.",
        title: "Architecture whiteboard",
        tags: ["diagram"],
        project: "memo-cook"
      })
    ).id;

    const cases: EvalCase[] = [
      {
        name: "English clear query returns target in top 3",
        run: () => {
          const ids = memo.search({ query: "Markdown truth source SQLite gram", project: "memo-cook", limit: 3 }).map((item) => item.id);
          assert(ids.includes(fixtures.architecture));
        }
      },
      {
        name: "Chinese gram query returns target in top 3",
        run: () => {
          const ids = memo.search({ query: "项目分析 结论", project: "memo-cook", limit: 3 }).map((item) => item.id);
          assert(ids.includes(fixtures.chinese));
        }
      },
      {
        name: "Project filter excludes similar unrelated project",
        run: () => {
          const ids = memo.search({ query: "markdown architecture", project: "memo-cook", limit: 5 }).map((item) => item.id);
          assert(ids.includes(fixtures.architecture));
          assert(!ids.includes(fixtures.otherProject));
        }
      },
      {
        name: "Tag filter requires all tags",
        run: () => {
          const ids = memo.search({ query: "answers evidence", tags: ["preference", "agent"], limit: 5 }).map((item) => item.id);
          assert.deepEqual(ids, [fixtures.preference]);
        }
      },
      {
        name: "URL failure card remains searchable",
        run: () => {
          const result = memo.search({ query: "Capture failed Link card", tags: ["url"], limit: 3 })[0];
          assert.equal(result?.id, fixtures.brokenUrl);
        }
      },
      {
        name: "Image manual note remains searchable",
        run: () => {
          const result = memo.search({ query: "architecture whiteboard screenshot", project: "memo-cook", limit: 3 })[0];
          assert.equal(result?.id, fixtures.image);
        }
      },
      {
        name: "Reindex restores search from Markdown",
        run: async (_memo, _fixtures, evalHome) => {
          memo.close();
          await rm(join(evalHome, "index.sqlite"), { force: true });
          const restored = new MemoCook({ home: evalHome });
          await restored.rebuildIndex();
          assert.equal(restored.search({ query: "项目分析 结论", project: "memo-cook", limit: 3 })[0]?.id, fixtures.chinese);
          restored.close();
        }
      }
    ];

    for (const testCase of cases) {
      await testCase.run(memo, fixtures, home);
      process.stdout.write(`ok - ${testCase.name}\n`);
    }
  } finally {
    try {
      memo.close();
    } catch {
      // The reindex case closes the original service before opening a restored one.
    }
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
