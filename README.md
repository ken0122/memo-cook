# Memo Cook

Memo Cook is an explicit, traceable memory outboard for agents. It gives Codex, Claude Code, Hermes, OpenClaw, and other MCP-capable agents one shared local memory store without silently recording chat history.

## Positioning

Memo Cook is:

- An agent memory outboard for durable preferences, project context, source snippets, URLs, and image references.
- Explicit by design: writes happen only through capture, organize, and link operations.
- Human-readable and portable: Markdown notes are the source of truth.
- Traceable: search/read results include note id, path, scope/project, tags, source URL or attachment reference, and snippet.

Memo Cook is not:

- An automatic transcript recorder.
- A full PKM replacement.
- A cloud sync service.
- An OCR, embedding, or multimodal understanding system in v1.

## Install

```bash
npm install -g memo-cook
memo-cook --help
```

For local development from this repository:

```bash
npm install
npm run build
npm link
memo-cook --help
```

Memo Cook stores data in `~/.memo-cook` by default. Override with:

```bash
export MEMO_COOK_HOME=/path/to/memo-store
```

## CLI

```bash
memo-cook capture --text "Codex prefers explicit saves." --title "Agent save policy" --tags agent,policy
memo-cook capture --url "https://example.com/article" --tags research
memo-cook capture --image ./whiteboard.png --note "Architecture sketch for memory flow." --tags diagram
memo-cook search "explicit saves" --limit 5
memo-cook inbox
memo-cook organize <id> --project memo-cook --tags architecture,agent --status active
memo-cook link <from_id> <to_id> --relation supports
memo-cook reindex
```

## MCP

Start the server over stdio:

```bash
memo-cook mcp
```

Tools:

- `memo_capture`
- `memo_search`
- `memo_read`
- `memo_list_inbox`
- `memo_organize`
- `memo_link`

Read tools are side-effect free. Write tools are intended only for explicit user intent.

## Data Layout

```text
~/.memo-cook/
├── index.sqlite
├── notes/
│   ├── inbox/
│   ├── global/
│   └── projects/
│       └── <project>/
└── attachments/
    └── <note-id>/
```

Each note is Markdown with YAML frontmatter:

```yaml
id: 20260610123000-abc12345
title: Explicit save policy
status: inbox
scope: project
project: memo-cook
tags:
  - agent
  - policy
source_type: text
attachments: []
links: []
created_at: "2026-06-10T12:30:00.000Z"
updated_at: "2026-06-10T12:30:00.000Z"
```

## Agent Plugins

This repository ships wrapper plugins:

- `plugins/codex-memo-cook`
- `plugins/claude-memo-cook`

Both declare the same MCP server command:

```json
{
  "mcpServers": {
    "memo-cook": {
      "command": "npx",
      "args": ["-y", "memo-cook@latest", "mcp"]
    }
  }
}
```

For unpublished local development, replace that command with a globally linked `memo-cook` binary or an absolute `node dist/cli.js mcp` command.

Hermes and OpenClaw can use the same MCP server by adding an equivalent stdio MCP server entry.

## Eval Standard

The v1 north star is retrieval of useful saved memory with evidence. See [docs/EVAL.md](docs/EVAL.md).

Run checks:

```bash
npm run typecheck
npm test
npm run build
```
