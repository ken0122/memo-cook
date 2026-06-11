# Hermes

Add the contents of `mcp.yaml` to your Hermes MCP configuration.

```yaml
mcp_servers:
  memo-cook:
    command: "npx"
    args:
      - "-y"
      - "memo-cook@latest"
      - "mcp"
    enabled: true
```

Keep `MEMO_COOK_HOME` the same across agents if they should share one memory store.
