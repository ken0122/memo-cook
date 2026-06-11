# Memo Cook Architecture

## Shape

Memo Cook has one core service and thin adapters:

- `MemoCook` service: capture, search, read, inbox, organize, link, reindex.
- CLI adapter: command-line access for humans and scripts.
- MCP adapter: tool schema for agents.
- Plugin wrappers: Codex and Claude Code skills plus MCP declarations.

## Source Of Truth

Markdown is authoritative. SQLite is a rebuildable FTS index.

This keeps the system portable and inspectable while still giving agents fast retrieval.

## Capture Flow

1. User explicitly asks to save/capture/remember.
2. Agent or CLI calls capture with text, URL, or image.
3. Memo Cook writes a Markdown note into `notes/inbox/`.
4. Attachments are copied into `attachments/<note-id>/`.
5. The note is indexed into SQLite FTS.

## Search Flow

1. Agent calls `memo_search`.
2. SQLite FTS ranks candidates.
3. Scope/project/tag filters are applied.
4. Results include traceability metadata and snippets.

## Organize Flow

1. User explicitly asks to organize/archive/tag/move a note.
2. Memo Cook updates frontmatter.
3. The Markdown file moves from inbox to `notes/global/` or `notes/projects/<project>/`.
4. The index is updated.
