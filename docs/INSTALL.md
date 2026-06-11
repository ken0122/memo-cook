# Installing Memo Cook In Agents

## Local Runtime

Memo Cook requires Node.js 20 or newer.

```bash
npm install -g memo-cook
memo-cook mcp
```

For local development before publishing:

```bash
npm install
npm run build
npm link
memo-cook mcp
```

## Codex

Use `plugins/codex-memo-cook` as a Codex plugin directory. Its `.codex-plugin/plugin.json` follows the Codex plugin manifest layout, and its `.mcp.json` uses the `mcpServers` wrapper accepted by the current Codex plugin validator.

This repository also includes a repo-scoped Codex marketplace at:

```text
.agents/plugins/marketplace.json
```

Open this repository in Codex, restart Codex if needed, then install Memo Cook from the `Memo Cook Local` marketplace.

For local development, edit `plugins/codex-memo-cook/.mcp.json` to use the linked binary:

```json
{
  "mcpServers": {
    "memo-cook": {
      "command": "memo-cook",
      "args": ["mcp"]
    }
  }
}
```

## Claude Code

Use `plugins/claude-memo-cook` as a Claude Code plugin directory. Claude Code discovers `skills/` and `.mcp.json` from the plugin.

For a project-scoped MCP config without the plugin wrapper, use:

```bash
claude --mcp-config integrations/claude-code/mcp.json
```

Or copy `integrations/claude-code/mcp.json` to the project root as `.mcp.json`:

```json
{
  "mcpServers": {
    "memo-cook": {
      "command": "memo-cook",
      "args": ["mcp"]
    }
  }
}
```

## Hermes

Add the contents of `integrations/hermes/mcp.yaml` to your Hermes MCP configuration:

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

## OpenClaw

Register the same MCP stdio command in the OpenClaw bundle or native plugin wrapper:

```bash
memo-cook mcp
```

The core contract is the MCP tool schema, so OpenClaw should not need a separate memory implementation.
