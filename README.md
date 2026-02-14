# indra_db_mcp

> **Persistent memory for AI reasoning and decisions.**

An MCP server that gives AI agents memory that persists across sessions. Built on [indra_db](https://github.com/moonstripe/indra_db) — a git-like database for versioned thoughts.

## The Problem

AI agents start fresh every session. Yesterday's insights evaporate. Decisions get re-made. Reasoning chains vanish.

**indra_db_mcp** changes that by giving agents:

- 🧠 **Persistent memory** — Record reasoning that survives session boundaries
- 🔍 **Semantic search** — Find past decisions by meaning, not keywords
- 🌿 **Branching** — Explore alternatives without losing the main thread
- 📜 **History** — See how understanding evolved over time

## Quick Start

### Install

No installation required — use `bunx` for automatic updates:

```bash
bunx -y indra_db_mcp@latest
```

Or install globally:
```bash
bun add -g indra_db_mcp
```

### Configure Your Agent

**Claude Code** — Add to your project's `CLAUDE.md`:

```markdown
@import node_modules/indra_db_mcp/INDRA_INSTRUCTIONS.md
```

**Claude Desktop** — Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "indra": {
      "command": "bunx",
      "args": ["-y", "indra_db_mcp@latest"]
    }
  }
}
```

**OpenCode** — Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "indra": {
      "command": ["bunx", "-y", "indra_db_mcp@latest"],
      "type": "local"
    }
  },
  "instructions": ["~/.config/opencode/instructions/indra.md"]
}
```

Then copy INDRA_INSTRUCTIONS.md:
```bash
mkdir -p ~/.config/opencode/instructions
curl -o ~/.config/opencode/instructions/indra.md \
  https://raw.githubusercontent.com/moonstripe/indra_db_mcp/main/INDRA_INSTRUCTIONS.md
```

**Generic MCP Client:**

```json
{
  "mcpServers": {
    "indra": {
      "command": "bunx",
      "args": ["-y", "indra_db_mcp@latest"],
      "env": {
        "INDRA_DB_PATH": "./.indra"
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
|------|---------|
| `indra_remember` | Record reasoning, decisions, and insights |
| `indra_search` | Find past reasoning by meaning (or `"*"` for all) |
| `indra_status` | Check current branch and entry count |
| `indra_branch` | Create, switch, or list branches |
| `indra_experiment` | Quick sandbox for exploring alternatives |
| `indra_history` | See how reasoning evolved |
| `indra_diff` | Compare two points in history |

## Example Usage

An agent might use Indra like this:

```
User: Should I use PostgreSQL or MongoDB for my e-commerce app?

Agent thinking:
  → indra_search({ query: "database recommendations" })
  → Found: Previously recommended PostgreSQL for relational data with transactions
  
  → Making recommendation based on past reasoning + current context
  
  → indra_remember({ 
      content: "Recommended PostgreSQL for e-commerce app. User has relational product 
               catalog, needs transactions for orders. Consistent with past guidance.",
      id: "ecommerce-db-decision"
    })
```

Later:

```
User: Why did you recommend PostgreSQL?

Agent:
  → indra_search({ query: "ecommerce database" })
  → Found the reasoning from the previous session
  → Can explain the decision with full context
```

### Branching for Exploration

```
Agent: Let me explore an alternative approach...

  → indra_experiment({ name: "try-nosql-approach" })
  
  [Explores MongoDB path, records reasoning]
  
  → indra_diff({ from: "main" })  // Compare with main reasoning
  
  → indra_branch({ action: "switch", name: "main" })  // Back to main
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INDRA_DB_PATH` | Path to database file | `./.indra` |
| `INDRA_API_URL` | API for sync (optional) | `https://api.indradb.net` |

## How It Works

1. **Content-addressed storage** — Every entry is hashed. Identity comes from content.
2. **Local embeddings** — Uses `sentence-transformers/all-MiniLM-L6-v2` for semantic search.
3. **Git-like versioning** — Commits create snapshots. Branches enable parallel exploration.
4. **Single file** — Everything in one `.indra` file. Easy to backup and share.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Client (Claude)                   │
└─────────────────────────┬───────────────────────────────┘
                          │ MCP Protocol (stdio)
┌─────────────────────────▼───────────────────────────────┐
│                   indra_db_mcp (Bun)                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   MCP SDK   │  │ IndraClient  │  │ Auto-sync     │  │
│  └─────────────┘  └──────┬───────┘  └───────────────┘  │
└──────────────────────────┼──────────────────────────────┘
                           │ CLI subprocess (JSON)
┌──────────────────────────▼──────────────────────────────┐
│                    indra CLI (Rust)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Graph Store │  │  Embeddings  │  │  Git-like VCS │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Visualize on IndraDB

Push to [IndraDB](https://indradb.net) for 3D visualization and analytics:

```bash
indra login
indra remote add origin username/my-memory
indra push origin
```

## License

MIT

## Related

- [indra_db](https://github.com/moonstripe/indra_db) — The underlying Rust database
- [IndraDB](https://indradb.net) — Web platform for visualization
- [MCP Specification](https://modelcontextprotocol.io/) — Model Context Protocol docs
