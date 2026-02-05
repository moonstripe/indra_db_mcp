#!/usr/bin/env bun
/**
 * indra_db MCP Server
 * 
 * A Model Context Protocol server that provides tools for managing a
 * content-addressed graph database of thoughts. Perfect for:
 * 
 * - Externalizing your reasoning process
 * - Building evolving knowledge graphs
 * - Tracking how understanding changes over time
 * - Creating branching paths of exploration
 * - Finding semantic connections between ideas
 * 
 * Think of it as version-controlled thinking - git for your mind.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { IndraClient } from "./indra-client.js";
import { EdgeTypes, IndraError } from "./types.js";

// ============================================================================
// Server Setup
// ============================================================================

const server = new McpServer({
  name: "indra_db",
  version: "0.1.0",
});

const client = new IndraClient({
  autoCommit: false, // We'll handle commits explicitly for better control
});

// ============================================================================
// Helper: Format responses for LLM consumption
// ============================================================================

function formatSuccess(data: unknown, context?: string): { content: Array<{ type: "text"; text: string }> } {
  const response = context 
    ? `${context}\n\n${JSON.stringify(data, null, 2)}`
    : JSON.stringify(data, null, 2);
  
  return {
    content: [{ type: "text", text: response }],
  };
}

function formatError(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  if (error instanceof IndraError) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error.message}\n\nDetails:\n${error.stderr}\n\nCommand: ${error.command.join(" ")}`,
      }],
      isError: true,
    };
  }
  
  return {
    content: [{
      type: "text",
      text: `Error: ${error instanceof Error ? error.message : String(error)}`,
    }],
    isError: true,
  };
}

// ============================================================================
// THOUGHT TOOLS - Capture and evolve ideas
// ============================================================================

server.tool(
  "remember",
  `🧠 CAPTURE A THOUGHT - Crystallize an idea, insight, or realization into the knowledge graph.

Use this when you:
- Have an insight worth preserving
- Want to externalize part of your reasoning
- Need to create a reference point for later
- Are building understanding incrementally

The thought will be embedded for semantic search, allowing you to find it later 
by meaning rather than exact words. Each thought becomes a node that can be 
connected to others, forming a web of understanding.

This is how you think out loud - make your reasoning visible and traceable.`,
  {
    content: z.string().describe("The thought to capture - be specific and self-contained"),
    id: z.string().optional().describe("Optional memorable identifier (e.g., 'key-insight-about-X'). Auto-generated if not provided."),
  },
  async ({ content, id }) => {
    try {
      const thought = await client.createThought(content, { id });
      await client.commit(`Remember: ${id || thought.id}`);
      return formatSuccess(thought, `✅ Thought captured and committed. ID: "${thought.id}"`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "recall",
  `🔍 RETRIEVE A THOUGHT - Fetch a specific thought by its identifier.

Use this when you:
- Need to review a previous insight
- Want to check what you recorded earlier
- Are building on a specific prior thought
- Need exact content for a connection

Returns the full thought including its content and metadata.`,
  {
    id: z.string().describe("The identifier of the thought to retrieve"),
  },
  async ({ id }) => {
    try {
      const thought = await client.getThought(id);
      return formatSuccess(thought, `📖 Retrieved thought "${id}":`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "revise",
  `✏️ REVISE A THOUGHT - Update your understanding while preserving history.

Use this when:
- Your understanding has evolved
- You need to correct or refine an idea
- New information changes a previous insight
- You want to improve how something is expressed

Unlike editing a document, this creates a new version. The old understanding 
is preserved in history - you can always see how your thinking evolved.
This is the heart of versioned thinking.`,
  {
    id: z.string().describe("The thought to revise"),
    content: z.string().describe("The new, revised content"),
  },
  async ({ id, content }) => {
    try {
      const thought = await client.updateThought(id, content);
      await client.commit(`Revise: ${id}`);
      return formatSuccess(thought, `✅ Thought revised. The previous version is preserved in history.`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "forget",
  `🗑️ FORGET A THOUGHT - Remove a thought from the current state.

Use sparingly. The thought remains in history and can be recovered by:
- Viewing commit history
- Branching from a previous state
- Using diff to see what was removed

This isn't true deletion - it's more like archiving. Version control means 
nothing is ever truly lost.`,
  {
    id: z.string().describe("The thought to forget"),
  },
  async ({ id }) => {
    try {
      await client.deleteThought(id);
      await client.commit(`Forget: ${id}`);
      return formatSuccess({ forgotten: id }, `✅ Thought "${id}" removed from current state. It remains in history.`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "list_thoughts",
  `📋 LIST ALL THOUGHTS - See everything currently in the knowledge graph.

Use this to:
- Get an overview of what's been captured
- Find thoughts to connect
- Review the current state of understanding
- Plan what connections to make

Returns all thoughts with their IDs and content.`,
  {},
  async () => {
    try {
      const result = await client.listThoughts();
      return formatSuccess(result, `📋 ${result.count} thought(s) in the knowledge graph:`);
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// RELATIONSHIP TOOLS - Build the web of understanding
// ============================================================================

server.tool(
  "connect",
  `🔗 CONNECT THOUGHTS - Create a typed relationship between two ideas.

This is where the graph comes alive. Connections reveal structure in your thinking.

Relationship types (use what fits, or create your own):
- "supports" → This thought provides evidence for another
- "contradicts" → This thought conflicts with another
- "derives_from" → This thought evolved from another
- "part_of" → This thought is a component of a larger idea
- "causes" → This thought leads to another
- "precedes" → This thought comes before another temporally
- "similar_to" → These thoughts express related ideas
- "relates_to" → General connection (when type is unclear)

The web of connections IS your understanding made visible.`,
  {
    from: z.string().describe("Source thought ID - the starting point of the relationship"),
    to: z.string().describe("Target thought ID - what the source connects to"),
    relationship: z.string().default("relates_to").describe("Type of relationship (see description for built-in types)"),
    strength: z.number().min(0).max(1).optional().describe("Optional weight 0.0-1.0 indicating relationship strength"),
  },
  async ({ from, to, relationship, strength }) => {
    try {
      const edge = await client.relate(from, to, relationship, { weight: strength });
      await client.commit(`Connect: ${from} --[${relationship}]--> ${to}`);
      return formatSuccess(edge, `✅ Connected: "${from}" --[${relationship}]--> "${to}"`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "disconnect",
  `✂️ DISCONNECT THOUGHTS - Remove a relationship between thoughts.

Use when:
- A connection no longer makes sense
- You're restructuring your understanding
- A relationship was created in error

The thoughts themselves remain - only the connection is removed.`,
  {
    from: z.string().describe("Source thought ID"),
    to: z.string().describe("Target thought ID"),
    relationship: z.string().optional().describe("Specific relationship type to remove (removes all if not specified)"),
  },
  async ({ from, to, relationship }) => {
    try {
      await client.unrelate(from, to, relationship);
      await client.commit(`Disconnect: ${from} from ${to}`);
      return formatSuccess(
        { disconnected: { from, to, relationship } },
        `✅ Disconnected "${from}" from "${to}"`
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "explore",
  `🌐 EXPLORE CONNECTIONS - See what's connected to a thought.

This is how you traverse the knowledge graph. From any thought, see:
- What it connects TO (outgoing)
- What connects to IT (incoming)
- Or both directions

Each neighbor comes with the edge that connects them, showing the 
relationship type and strength. Use this to follow chains of reasoning,
find related concepts, or understand context.`,
  {
    thought_id: z.string().describe("The thought to explore from"),
    direction: z.enum(["outgoing", "incoming", "both"]).default("both")
      .describe("Which connections to follow"),
  },
  async ({ thought_id, direction }) => {
    try {
      const result = await client.getNeighbors(thought_id, direction);
      const directionEmoji = direction === "outgoing" ? "→" : direction === "incoming" ? "←" : "↔";
      return formatSuccess(result, `🌐 Connections from "${thought_id}" (${directionEmoji} ${direction}):`);
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// SEARCH TOOLS - Find by meaning
// ============================================================================

server.tool(
  "search",
  `🔮 SEMANTIC SEARCH - Find thoughts by meaning, not just keywords.

This is powerful: describe what you're looking for conceptually, and find 
thoughts that match semantically. The embeddings capture meaning, so:

- "initial hypothesis" might find "my first theory about X"
- "things that went wrong" might find "problems encountered"  
- "key decisions" might find "we chose to..."

Use this to:
- Rediscover relevant prior thinking
- Find thoughts to connect
- Check if you've already captured something similar
- Surface related ideas you may have forgotten

Higher scores = more semantically similar.`,
  {
    query: z.string().describe("What you're looking for - describe the meaning/concept"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum results to return"),
  },
  async ({ query, limit }) => {
    try {
      const result = await client.search(query, limit);
      return formatSuccess(result, `🔮 Found ${result.count} thought(s) matching "${query}":`);
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// VERSION CONTROL TOOLS - Track the evolution of understanding
// ============================================================================

server.tool(
  "checkpoint",
  `💾 CHECKPOINT - Commit current state with a meaningful message.

Like git commit, but for thoughts. Creates a snapshot you can return to.

Good checkpoint messages describe WHY, not just what:
- "Completed initial analysis of problem space"
- "Refined hypothesis after finding contradicting evidence"  
- "Branching to explore alternative approach"

Checkpoints let you see how understanding evolved over time.`,
  {
    message: z.string().describe("What this checkpoint represents - focus on the WHY"),
  },
  async ({ message }) => {
    try {
      const result = await client.commit(message);
      return formatSuccess(result, `💾 Checkpoint created: "${message}"`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "history",
  `📜 VIEW HISTORY - See how understanding has evolved.

Returns the commit log showing each checkpoint. This is the trajectory 
of your thinking - not just where you are, but how you got here.

Use this to:
- Review the evolution of understanding
- Find a point to branch from
- Understand context of current state
- Track decision points`,
  {
    limit: z.number().min(1).max(100).optional().describe("Maximum commits to show"),
  },
  async ({ limit }) => {
    try {
      const result = await client.log(limit);
      return formatSuccess(result, `📜 Commit history for branch "${result.branch}":`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "branch",
  `🌿 CREATE BRANCH - Start a new line of exploration.

Branches let you explore alternatives without losing your main line of thought.
Like git branches, they're cheap and fast.

Use this when:
- You want to explore a "what if" scenario
- Testing a hypothesis that might not pan out
- Trying an alternative approach
- Saving current state before major changes

You can always come back to main, or merge insights later.`,
  {
    name: z.string().describe("Name for the new branch (e.g., 'explore-alternative', 'hypothesis-b')"),
  },
  async ({ name }) => {
    try {
      const branch = await client.createBranch(name);
      return formatSuccess(branch, `🌿 Branch "${name}" created. Use 'switch_branch' to explore it.`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "switch_branch",
  `🔀 SWITCH BRANCH - Move to a different line of thinking.

Changes which branch you're working on. All thoughts and connections 
reflect that branch's state.

Use this to:
- Return to main after exploring
- Switch between different approaches
- Compare different lines of reasoning`,
  {
    name: z.string().describe("Branch name to switch to"),
  },
  async ({ name }) => {
    try {
      await client.checkout(name);
      return formatSuccess({ branch: name }, `🔀 Switched to branch "${name}"`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "list_branches",
  `🌳 LIST BRANCHES - See all lines of exploration.

Shows all branches and which one is currently active.
Each branch is an independent line of thought that can evolve separately.`,
  {},
  async () => {
    try {
      const result = await client.listBranches();
      return formatSuccess(result, `🌳 Branches (current: "${result.current}"):`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "compare",
  `🔍 COMPARE - See what changed between states.

Shows differences between commits or branches:
- Thoughts added, removed, modified
- Connections added or removed

Use this to:
- Understand how thinking evolved
- See what a branch explored
- Review changes before merging ideas`,
  {
    from: z.string().optional().describe("Starting commit/branch (defaults to parent)"),
    to: z.string().optional().describe("Ending commit/branch (defaults to HEAD)"),
  },
  async ({ from, to }) => {
    try {
      const result = await client.diff(from, to);
      return formatSuccess(result, `🔍 Diff${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}:`);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "status",
  `📊 STATUS - Get current database state overview.

Shows:
- Current branch
- Number of thoughts and connections
- Uncommitted changes
- Database location

Use this to orient yourself - where am I in the knowledge graph?`,
  {},
  async () => {
    try {
      const result = await client.status();
      return formatSuccess(result, `📊 Database status:`);
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// Server Startup
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  
  console.error(`[indra_db_mcp] Starting server...`);
  console.error(`[indra_db_mcp] Database path: ${client.getDatabasePath()}`);
  
  // Initialize the client (ensures binary exists, creates DB if needed)
  try {
    await client.init();
    console.error(`[indra_db_mcp] Database initialized successfully`);
  } catch (error) {
    console.error(`[indra_db_mcp] Warning: ${error}`);
    // Continue anyway - errors will be reported when tools are called
  }
  
  await server.connect(transport);
  console.error(`[indra_db_mcp] Server connected and ready`);
}

main().catch((error) => {
  console.error(`[indra_db_mcp] Fatal error:`, error);
  process.exit(1);
});
