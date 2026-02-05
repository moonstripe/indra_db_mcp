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

### Installation

```bash
# Clone and install
git clone https://github.com/your-username/indra_db_mcp
cd indra_db_mcp
bun install

# The indra CLI will auto-install on first run via cargo
```

### Configure with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "indra": {
      "command": "bun",
      "args": ["run", "/path/to/indra_db_mcp/src/index.ts"],
      "env": {
        "INDRA_DB_PATH": "~/.indra"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INDRA_DB_PATH` | Path to database file | `./.indra` (hidden file) |

When `INDRA_DB_PATH` is set, uses that path (supports `~` for home directory).
When unset, creates a hidden `.indra` file in the current working directory.

## Available Tools

### 🧠 Thought Capture

| Tool | Description |
|------|-------------|
| `remember` | Capture a thought with optional ID. Embeddings auto-generated for semantic search. |
| `recall` | Retrieve a specific thought by ID. |
| `revise` | Update a thought while preserving history. |
| `forget` | Remove from current state (preserved in history). |
| `list_thoughts` | See all thoughts in the graph. |

### 🔗 Relationship Building

| Tool | Description |
|------|-------------|
| `connect` | Create typed relationship between thoughts. |
| `disconnect` | Remove a relationship. |
| `explore` | Traverse connections from a thought. |

**Built-in relationship types:**
- `supports` — evidence/backing
- `contradicts` — conflicts with
- `derives_from` — evolved from
- `part_of` — component of larger idea
- `causes` — leads to
- `precedes` — temporal ordering
- `similar_to` — related concepts
- `relates_to` — general connection

### 🔮 Semantic Search

| Tool | Description |
|------|-------------|
| `search` | Find thoughts by meaning using vector embeddings. |

### 📜 Version Control

| Tool | Description |
|------|-------------|
| `checkpoint` | Commit current state with a message. |
| `history` | View commit log showing evolution. |
| `branch` | Create new line of exploration. |
| `switch_branch` | Move between branches. |
| `list_branches` | See all branches. |
| `compare` | Diff between states. |
| `status` | Current database overview. |

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
