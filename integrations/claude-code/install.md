# Claude Code

Use this file when you want Memo Cook as a Claude Code MCP server without installing the full Claude plugin wrapper.

```bash
claude --mcp-config integrations/claude-code/mcp.json
```

For project-scoped sharing, copy the same JSON to the project root as `.mcp.json`.

Keep `MEMO_COOK_HOME` the same across agents if they should share one memory store.
