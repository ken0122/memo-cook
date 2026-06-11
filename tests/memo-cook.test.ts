import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp.js";
import { MemoCook } from "../src/service.js";
import { runDoctor } from "../src/doctor.js";

const homes: string[] = [];

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "memo-cook-"));
  homes.push(home);
  return home;
}

async function markdownFiles(home: string): Promise<string[]> {
  const { findMarkdownFiles } = await import("../src/markdown.js");
  return findMarkdownFiles(join(home, "notes"));
}

async function withServer(handler: Parameters<typeof createServer>[0]): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start test server");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("MemoCook", () => {
  it("captures text, returns traceable fields, and finds the right memory in top 3", async () => {
    const home = await makeHome();
    const memo = new MemoCook({ home });

    await memo.capture({
      text: "Codex prefers explicit saves for durable memory. Never auto-capture chat transcripts.",
      title: "Explicit save policy",
      tags: ["policy", "agent"],
      project: "memo-cook"
    });
    await memo.capture({
      text: "The garden plan needs a drip irrigation timer and shade cloth.",
      title: "Garden plan",
      tags: ["home"]
    });
    const target = await memo.capture({
      text: "Memo Cook stores Markdown as the truth source and rebuilds SQLite FTS from it.",
      title: "Markdown truth source",
      tags: ["architecture", "agent"],
      project: "memo-cook"
    });

    const results = memo.search({ query: "Markdown truth source SQLite", project: "memo-cook", limit: 3 });

    expect(results.map((item) => item.id)).toContain(target.id);
    expect(results[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      path: expect.stringContaining(".md"),
      scope: "project",
      project: "memo-cook",
      tags: expect.arrayContaining(["architecture"]),
      source_type: "text",
      snippet: expect.any(String)
    });
    memo.close();
  });

  it("uses gram search for Chinese and exact lexical fragments", async () => {
    const home = await makeHome();
    const memo = new MemoCook({ home });
    const saved = await memo.capture({
      text: "我喜欢在项目分析里先给结论，再给具体证据。",
      title: "回复偏好",
      tags: ["偏好", "中文"],
      project: "memo-cook"
    });

    const results = memo.search({ query: "项目分析 结论", project: "memo-cook", limit: 3 });

    expect(results[0]?.id).toBe(saved.id);
    expect(results[0]?.match_reasons).toEqual(expect.arrayContaining(["gram", "content"]));
    memo.close();
  });

  it("keeps tag filters strict while ranking title and tag matches", async () => {
    const home = await makeHome();
    const memo = new MemoCook({ home });
    const titleMatch = await memo.capture({
      text: "The body mentions a general preference.",
      title: "Agent retrieval preference",
      tags: ["policy"],
      project: "memo-cook"
    });
    await memo.capture({
      text: "Agent retrieval preference appears only in this unrelated body.",
      title: "Body-only fixture",
      tags: ["misc"],
      project: "memo-cook"
    });

    const results = memo.search({ query: "retrieval preference", tags: ["policy"], project: "memo-cook", limit: 5 });

    expect(results.map((item) => item.id)).toEqual([titleMatch.id]);
    expect(results[0]?.match_reasons).toEqual(expect.arrayContaining(["title"]));
    memo.close();
  });

  it("does not modify markdown notes for read-only search/read/list operations", async () => {
    const home = await makeHome();
    const memo = new MemoCook({ home });
    const saved = await memo.capture({ text: "Read-only operations must not write note files.", title: "Read-only policy" });
    const beforeFiles = await markdownFiles(home);
    const beforeStats = await Promise.all(beforeFiles.map((file) => stat(file)));

    memo.search({ query: "read-only" });
    await memo.read(saved.id);
    memo.listInbox();

    const afterFiles = await markdownFiles(home);
    const afterStats = await Promise.all(afterFiles.map((file) => stat(file)));
    expect(afterFiles).toEqual(beforeFiles);
    expect(afterStats.map((item) => item.mtimeMs)).toEqual(beforeStats.map((item) => item.mtimeMs));
    memo.close();
  });

  it("captures image attachments with a searchable manual note and organizes into a project", async () => {
    const home = await makeHome();
    const imagePath = join(home, "whiteboard.png");
    await writeFile(imagePath, Buffer.from("fake png bytes"));
    const memo = new MemoCook({ home });

    const saved = await memo.capture({
      imagePath,
      note: "Screenshot of the agent memory architecture whiteboard.",
      tags: ["diagram"],
      title: "Memory architecture whiteboard"
    });
    expect(saved.attachments[0]).toMatch(/^attachments\//);

    const organized = await memo.organize(saved.id, {
      project: "memo-cook",
      tags: ["diagram", "architecture"],
      status: "active"
    });

    expect(organized.status).toBe("active");
    expect(organized.path).toContain("/notes/projects/memo-cook/");
    expect(memo.search({ query: "whiteboard", project: "memo-cook" })[0]?.id).toBe(saved.id);
    memo.close();
  });

  it("saves a URL card with failure reason when fetching fails", async () => {
    const home = await makeHome();
    const memo = new MemoCook({ home });

    const saved = await memo.capture({
      url: "notaurl",
      title: "Broken link fixture",
      tags: ["url"]
    });
    const note = await memo.read(saved.id);

    expect(saved.source_type).toBe("url");
    expect(saved.source_url).toBe("notaurl");
    expect(note.content).toContain("Capture failed");
    expect(note.content).toContain("Link card saved");
    memo.close();
  });

  it("blocks private URL capture by default and stores the failure reason", async () => {
    const home = await makeHome();
    const memo = new MemoCook({ home });

    const saved = await memo.capture({ url: "http://127.0.0.1:9/private", title: "Private URL" });
    const note = await memo.read(saved.id);

    expect(note.content).toContain("Capture failed");
    expect(note.content).toContain("Private URL blocked");
    memo.close();
  });

  it("rejects unsupported and oversized URL responses as failure cards", async () => {
    const previous = process.env.MEMO_COOK_ALLOW_PRIVATE_URLS;
    process.env.MEMO_COOK_ALLOW_PRIVATE_URLS = "1";
    const unsupported = await withServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end("binary");
    });
    const oversized = await withServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-length": String(2 * 1024 * 1024 + 1) });
      res.end("too large");
    });
    const home = await makeHome();
    const memo = new MemoCook({ home });

    try {
      const badType = await memo.capture({ url: unsupported.url, title: "Unsupported type" });
      const tooLarge = await memo.capture({ url: oversized.url, title: "Oversized type" });

      expect((await memo.read(badType.id)).content).toContain("Unsupported content type");
      expect((await memo.read(tooLarge.id)).content).toContain("Response too large");
    } finally {
      memo.close();
      await unsupported.close();
      await oversized.close();
      if (previous === undefined) {
        delete process.env.MEMO_COOK_ALLOW_PRIVATE_URLS;
      } else {
        process.env.MEMO_COOK_ALLOW_PRIVATE_URLS = previous;
      }
    }
  });

  it("rebuilds the SQLite index from Markdown notes", async () => {
    const home = await makeHome();
    const memo = new MemoCook({ home });
    const saved = await memo.capture({
      text: "Rebuild fixture: the index can be regenerated from Markdown.",
      title: "Rebuild fixture"
    });
    memo.close();
    await rm(join(home, "index.sqlite"), { force: true });

    const restored = new MemoCook({ home });
    expect(restored.search({ query: "regenerated" })).toHaveLength(0);
    await restored.rebuildIndex();

    expect(restored.search({ query: "regenerated" })[0]?.id).toBe(saved.id);
    expect(restored.search({ query: "Rebuild fixture" })[0]?.match_reasons).toEqual(expect.arrayContaining(["gram"]));
    restored.close();
  });

  it("links two memories by writing the source note frontmatter", async () => {
    const home = await makeHome();
    const memo = new MemoCook({ home });
    const from = await memo.capture({ text: "Preference: concise traceable answers.", title: "Answer style" });
    const to = await memo.capture({ text: "Project context: Memo Cook evaluates top-three retrieval.", title: "Eval target" });

    await memo.link({ fromId: from.id, toId: to.id, relation: "supports" });
    const source = await memo.read(from.id);
    const raw = await readFile(source.path, "utf8");

    expect(source.links).toEqual([{ id: to.id, relation: "supports" }]);
    expect(raw).toContain("relation: supports");
    memo.close();
  });

  it("exposes the MCP tool contract and returns structured traceable search results", async () => {
    const home = await makeHome();
    const server = createMcpServer({ home });
    const client = new Client({ name: "memo-cook-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["memo_capture", "memo_search", "memo_read", "memo_list_inbox", "memo_organize", "memo_link"])
    );

    const captured = await client.callTool({
      name: "memo_capture",
      arguments: {
        kind: "text",
        text: "MCP contract fixture for traceable memory retrieval.",
        title: "MCP contract fixture",
        tags: ["mcp", "eval"]
      }
    });
    const capturedContent = captured.structuredContent as { id: string };
    expect(capturedContent.id).toEqual(expect.any(String));

    const searched = await client.callTool({
      name: "memo_search",
      arguments: {
        query: "traceable memory retrieval",
        limit: 3
      }
    });
    const searchContent = searched.structuredContent as {
      results: Array<{ id: string; path: string; source_type: string; snippet: string }>;
    };

    expect(searchContent.results[0]).toMatchObject({
      id: capturedContent.id,
      path: expect.stringContaining(".md"),
      source_type: "text",
      snippet: expect.stringContaining("traceable")
    });

    await client.close();
    await server.close();
  });

  it("reports read-only doctor diagnostics as JSON-ready data", async () => {
    const home = await makeHome();
    const memo = new MemoCook({ home });
    await memo.capture({ text: "Doctor fixture memory.", title: "Doctor fixture" });
    memo.close();

    const report = await runDoctor({ home, repoRoot: join(process.cwd()) });

    expect(report.ok).toBe(true);
    expect(report.stats.markdown_notes).toBe(1);
    expect(report.stats.indexed_notes).toBe(1);
    expect(report.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["home exists", "index fresh"]));
  });
});
