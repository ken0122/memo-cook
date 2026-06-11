# Memo Cook Eval Standard

## Product Target

Memo Cook succeeds when an agent can save a useful memory explicitly, retrieve it later in the right context, and show where it came from.

## Golden Retrieval

Use a fixed fixture set containing:

- Global preferences.
- Project-specific facts.
- URL captures.
- Image captures with manual notes.
- Similar notes across different projects.

Expected behavior:

- Clear queries return the correct note in Top 3.
- Project-filtered queries do not return unrelated project notes.
- Tag-filtered queries require all requested tags.
- Ambiguous queries return traceable candidates rather than pretending certainty.

## Traceability

Every `memo_search` result must include:

- `id`
- `title`
- `path`
- `scope`
- `project`
- `tags`
- `source_type`
- `source_url` or `attachments`
- `snippet`

Every `memo_read` result must include the full Markdown content and the same traceability fields.

## Explicit Write Boundary

Only these operations may create or modify notes:

- `memo_capture`
- `memo_organize`
- `memo_link`
- CLI equivalents

These operations must remain read-only:

- `memo_search`
- `memo_read`
- `memo_list_inbox`

## Conflict Handling

When Memo Cook retrieval conflicts with Codex built-in memory, current thread context, or another Memo Cook note, the agent must:

- State the conflict.
- Cite Memo Cook note ids or paths when available.
- Ask the user which source to follow.
- Avoid silently merging or choosing between conflicting memories.

## Input Fidelity

Text:

- Save exact user-provided text in Markdown.
- Preserve title, tags, scope, and project metadata.

URL:

- Save original/final URL, metadata, and extracted text when fetch succeeds.
- Save a link card and failure reason when fetch fails.

Image:

- Copy the image into `attachments/<note-id>/`.
- Index the user/agent-provided note.
- Do not claim OCR or visual understanding in v1.

## Recovery

Deleting `index.sqlite` must not delete memory. `memo-cook reindex` must rebuild the index from Markdown notes.
