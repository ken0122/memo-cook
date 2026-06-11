---
name: memo-cook
description: Use when the user asks to save, remember, capture, organize, link, or search durable agent memory through Memo Cook. Writes must be explicit; search/read/list are safe read-only operations.
---

# Memo Cook

Memo Cook is the user's shared memory outboard for Claude Code and other agents. It stores human-readable Markdown notes, copies image attachments, fetches URL text/metadata, and maintains a rebuildable SQLite FTS index.

## Operating Rules

- Use `memo_search`, `memo_read`, and `memo_list_inbox` when the user asks what is remembered or when durable context would help the current task.
- Use `memo_capture`, `memo_organize`, and `memo_link` only when the user explicitly asks to save, remember, capture, organize, archive, tag, or link something.
- Never silently save a conversation, private detail, terminal output, or inferred preference.
- When returning search results, include the note `id`, title, scope/project, tags, source URL or attachment reference, and the relevant snippet.
- Treat Markdown as the source of truth. If search looks stale, run `memo-cook reindex` only after the user asks for repair or maintenance.

## Capture Guidance

- Text: pass the exact text, plus a concise title and tags when available.
- URL: pass the URL and optional title/tags/project. Memo Cook will save fetched metadata/body, or a failure card if fetching fails.
- Image: pass `imagePath` and a searchable `note`. V1 does not perform OCR or visual analysis.
- New captures go to inbox. Use `memo_organize` after explicit user intent to set `project`, `tags`, and `status`.
