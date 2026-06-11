import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { MemoCook } from "./service.js";
import type { MemoCookOptions } from "./service.js";

function toolResult(value: unknown) {
  const structuredContent =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { results: value };
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ],
    structuredContent
  };
}

export function createMcpServer(options: MemoCookOptions = {}): McpServer {
  const memo = new MemoCook(options);
  const server = new McpServer({
    name: "memo-cook",
    version: "0.1.0"
  });

  server.registerTool(
    "memo_capture",
    {
      title: "Capture Memory",
      description:
        "Explicitly save a text fragment, URL, or image attachment into Memo Cook inbox. Use only when the user asks to remember, save, capture, or organize something.",
      inputSchema: {
        kind: z.enum(["text", "url", "image"]).optional(),
        text: z.string().optional(),
        url: z.string().optional(),
        imagePath: z.string().optional(),
        note: z.string().optional(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        project: z.string().optional(),
        scope: z.enum(["global", "project"]).optional()
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        readOnlyHint: false
      }
    },
    async (args) => toolResult(await memo.capture(args))
  );

  server.registerTool(
    "memo_search",
    {
      title: "Search Memories",
      description: "Search saved Memo Cook memories. This is read-only and must not create new memories.",
      inputSchema: {
        query: z.string().min(1),
        tags: z.array(z.string()).optional(),
        project: z.string().optional(),
        scope: z.enum(["global", "project"]).optional(),
        limit: z.number().int().min(1).max(50).optional()
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (args) => toolResult(memo.search(args))
  );

  server.registerTool(
    "memo_read",
    {
      title: "Read Memory",
      description: "Read one saved Memo Cook memory by id. This is read-only.",
      inputSchema: {
        id: z.string().min(1)
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ id }) => toolResult(await memo.read(id))
  );

  server.registerTool(
    "memo_list_inbox",
    {
      title: "List Memory Inbox",
      description: "List Memo Cook inbox items awaiting organization. This is read-only.",
      inputSchema: {
        project: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional()
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (args) => toolResult(memo.listInbox(args))
  );

  server.registerTool(
    "memo_organize",
    {
      title: "Organize Memory",
      description: "Move or retitle a memory and set tags/project/status after explicit user intent.",
      inputSchema: {
        id: z.string().min(1),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        project: z.string().optional(),
        status: z.enum(["active", "archived"]).optional()
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        readOnlyHint: false
      }
    },
    async ({ id, ...input }) => toolResult(await memo.organize(id, input))
  );

  server.registerTool(
    "memo_link",
    {
      title: "Link Memories",
      description: "Record a relationship from one memory to another after explicit user intent.",
      inputSchema: {
        fromId: z.string().min(1),
        toId: z.string().min(1),
        relation: z.string().optional()
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        readOnlyHint: false
      }
    },
    async (args) => toolResult(await memo.link(args))
  );

  return server;
}

export async function runMcpServer(options: MemoCookOptions = {}): Promise<void> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
