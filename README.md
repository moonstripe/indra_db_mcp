# indra_db_mcp

> **Think out loud. Remember what matters. Watch understanding evolve.**

An MCP (Model Context Protocol) server that gives AI models a place to externalize their thinking. Built on [indra_db](https://github.com/moonstripe/indra_db) — a content-addressed graph database for versioned thoughts.

## Why This Exists

Most AI interactions are ephemeral. Insights evaporate. Reasoning chains vanish. Good ideas get rediscovered instead of built upon.

**indra_db_mcp** changes that by giving models (and humans) a shared space to:

- 🧠 **Capture thoughts** as they emerge during reasoning
- 🔗 **Connect ideas** into a web of understanding  
- 🔮 **Search by meaning** not just keywords
- 🌿 **Branch and explore** alternative lines of thinking
- 📜 **Track evolution** of understanding over time

It's git for thoughts. Version-controlled thinking. A knowledge graph that grows with every conversation.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0+)
- [Rust/Cargo](https://rustup.rs/) (for auto-installing indra_db CLI)

### Usage with MCP Clients

The simplest way to use this server is via `bunx`:

```json
{
  "mcpServers": {
    "indra": {
      "command": ["bunx", "-y", "indra_db_mcp"],
      "type": "local"
    }
  }
}
```

### Enabling Proactive Use

Models won't automatically use Indra unless instructed. Add the bundled instructions file to your config:

**OpenCode** (`~/.config/opencode/opencode.json` or project `opencode.json`):
```json
{
  "instructions": ["node_modules/indra_db_mcp/INDRA_INSTRUCTIONS.md"]
}
```

**Claude Code** (project `CLAUDE.md` or global `~/.claude/CLAUDE.md`):
```markdown
<!-- Include Indra instructions -->
@import node_modules/indra_db_mcp/INDRA_INSTRUCTIONS.md
```

Or copy `INDRA_INSTRUCTIONS.md` to your project and reference it directly.

Or with a custom database path:

```json
{
  "mcpServers": {
    "indra": {
      "command": ["bunx", "-y", "indra_db_mcp"],
      "environment": {
        "INDRA_DB_PATH": "~/.indra"
      },
      "type": "local"
    }
  }
}
```

### Manual Installation

```bash
# Install globally
bun add -g indra_db_mcp

# Or clone and run locally
git clone https://github.com/moonstripe/indra_db_mcp
cd indra_db_mcp
bun install
bun start

# The indra CLI will auto-install on first run via cargo
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INDRA_DB_PATH` | Path to database file | `./.indra` (hidden file) |

When `INDRA_DB_PATH` is set, uses that path (supports `~` for home directory).
When unset, creates a hidden `.indra` file in the current working directory.

## Available Tools

### Core Tools (Always Start Here)

The MCP provides a minimal set of tools designed to be **agent-inviting** - each tool clearly explains *why* you'd use it before explaining *how*.

#### 💾 Memory Management

| Tool | Purpose |
|------|---------|
| `indra_remember` | Save information to improve future conversations. Automatically creates embeddings for semantic search. |
| `indra_search` | Recall what you know about this user and topic. Searches by meaning, not just keywords. Use "*" to list all notes. |
| `indra_status` | Check database status - current branch, note count, sync state. Use this to orient yourself. |

#### 🌿 Branching & History

| Tool | Purpose |
|------|---------|
| `indra_branch` | Create, switch, or list branches for parallel exploration. Actions: `create`, `switch`, `list`. |
| `indra_experiment` | Quick sandbox - creates and switches to a new branch in one step. Perfect for "what if?" scenarios. |
| `indra_history` | View how notes evolved over time. See commit history with timestamps. |
| `indra_diff` | Compare two points in history to see exactly what changed (added/removed/modified). |

### Design Principles

Following the successful pattern of `indra_search` and `indra_remember`:

1. **Benefit-first descriptions** - Tools explain why they exist before how to use them
2. **Minimal interface** - Each tool does one thing well
3. **Auto-commit** - Mutations persist immediately (no explicit saves needed)
4. **Auto-sync** - Pull before reads, push after writes (best-effort, never blocks)
5. **Self-contained** - No tool requires calling another tool first

### Example Workflows

#### Exploring Alternative Approaches

```javascript
// Create a sandbox for experimentation
indra_experiment({ name: "alternative-approach" })
// Make changes...
indra_remember({ content: "Trying a different strategy..." })
// Compare with main timeline
indra_diff({ from: "main" })
// Switch back when done
indra_branch({ action: "switch", name: "main" })
```

#### Reviewing History

```javascript
// See recent changes
indra_history({ limit: 20 })
// Compare two points
indra_diff({ from: "abc123", to: "def456" })
// Check current state
indra_status()
```

## Example Session

Here's how an AI might use this during reasoning:

```
User: Help me think through whether to use microservices or a monolith for my startup.

AI: Let me capture my initial thoughts on this decision...

[Uses remember] "The microservices vs monolith decision depends heavily on team size, 
expected scale, and operational maturity"

[Uses remember] "Startups typically benefit from monoliths initially - faster iteration, 
simpler deployment, easier debugging"

[Uses remember] "Microservices add operational overhead: service discovery, distributed 
tracing, network latency, deployment complexity"

[Uses connect] "monolith-benefits" --[supports]--> "startup-recommendation"
[Uses connect] "microservices-overhead" --[contradicts]--> "premature-microservices"

[Uses checkpoint] "Initial analysis of architecture decision"

Let me explore an alternative perspective...

[Uses branch] "microservices-case"
[Uses switch_branch] "microservices-case"

[Uses remember] "If expecting rapid team growth, microservices enable independent 
team ownership and deployment"

[Uses search] "team scaling" 
// Finds related thoughts about team dynamics

[Uses switch_branch] "main"
[Uses compare] "main" vs "microservices-case"
// Shows what each branch explored
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Client (Claude)                   │
└─────────────────────────┬───────────────────────────────┘
                          │ MCP Protocol (stdio)
┌─────────────────────────▼───────────────────────────────┐
│                   indra_db_mcp (Bun)                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   MCP SDK   │  │ IndraClient  │  │  Type Safety  │  │
│  └─────────────┘  └──────┬───────┘  └───────────────┘  │
└──────────────────────────┼──────────────────────────────┘
                           │ CLI subprocess (JSON)
┌──────────────────────────▼──────────────────────────────┐
│                    indra CLI (Rust)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Graph Store │  │  Embeddings  │  │  Git-like VCS │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│              thoughts.indra (Single File)                │
│  Content-addressed objects, BLAKE3 hashes, zstd compressed│
└─────────────────────────────────────────────────────────┘
```

## Development

```bash
# Run with watch mode
bun run dev

# Type check
bun run typecheck

# Run tests
bun test
```

## How It Works

1. **Content Addressing**: Every thought is hashed (BLAKE3). Identity comes from content.

2. **Embeddings**: Using `sentence-transformers/all-MiniLM-L6-v2` locally via HuggingFace. 
   Thoughts are embedded on creation for semantic search.

3. **Graph Structure**: Thoughts are nodes, relationships are typed/weighted edges.
   Edges "float" to latest node versions.

4. **Version Control**: Git-like commits create snapshots. Branches enable parallel exploration.
   Full history preserved — nothing truly deleted.

5. **Single File**: Everything stored in one `.indra` file. Easy to backup, share, version.

## Philosophical Note

This project is named after [Indra's Net](https://en.wikipedia.org/wiki/Indra%27s_net) — 
a Buddhist metaphor where reality is a vast net of jewels, each reflecting all others.

Your thoughts are like those jewels. Each one reflects and connects to others. 
The web of connections *is* your understanding. This tool makes that web visible, 
versionable, and searchable.

## License

MIT

## Related

- [indra_db](https://github.com/moonstripe/indra_db) — The underlying Rust database
- [MCP Specification](https://modelcontextprotocol.io/) — Model Context Protocol docs
- [indranet](https://github.com/moonstripe/indranet) — Online viewing tool (coming soon)
