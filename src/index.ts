#!/usr/bin/env bun
/**
 * indra_db MCP Server - Simplified API
 * 
 * A Model Context Protocol server for managing the user's personal notes.
 * 
 * DESIGN PRINCIPLES:
 * 1. Minimal tools - each tool does ONE thing well
 * 2. Auto-commit - every mutation persists immediately
 * 3. Self-contained - no tool depends on another being called first
 * 4. Clear purpose - tool names match what users would say
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { IndraClient } from "./indra-client.js";
import { IndraError } from "./types.js";

// ============================================================================
// Server Setup
// ============================================================================

const SERVER_INSTRUCTIONS = `# Indra: User's Personal Knowledge Base

You have access to **Indra**, the user's personal notes system. Help them build and use it.

## PRIMARY TOOLS

### \`indra_remember\` - Save information
\`\`\`
indra_remember(content="User prefers Hokas for arch support")
indra_remember(content="Updated: now using Brooks", id="shoe-preference")  // updates existing
\`\`\`

### \`indra_search\` - Find prior notes
\`\`\`
indra_search(query="shoe preferences")
indra_search(query="*")  // list all notes
\`\`\`

## THE PATTERN

1. **Before answering**: \`indra_search\` to check for relevant notes
2. **Answer the question**: Use any context you found
3. **After learning something**: \`indra_remember\` to save it

## IMPORTANT

Adding notes is **helping the user**, not extra work. They set up this system
because they WANT you to track their preferences, context, and insights.

**Don't ask permission - adding useful notes IS the service they want.**`;

const server = new McpServer(
  {
    name: "indra_db",
    version: "0.1.13",
  },
  {
    instructions: SERVER_INSTRUCTIONS,
  }
);

const client = new IndraClient();

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
// TOOL: indra_remember - Save or update notes
// ============================================================================

server.tool(
  "indra_remember",
  `Save a note to the user's personal knowledge base.

USE THIS WHEN YOU:
- Learn something about the user (preferences, context, situation)
- Make a recommendation worth preserving
- Discover a pattern or insight
- Want to record something for future reference

EXAMPLES:
- "User prefers Hokas over Altras for arch support"
- "Currently recovering from plantar fasciitis, resting foot"
- "Project deadline is March 15, 2026"
- "Recommended cycling as cross-training during injury recovery"

The note is saved immediately and will be findable via indra_search.
If you provide an existing ID, it updates that note instead of creating new.`,
  {
    content: z.string().describe("The note to save - be specific and self-contained"),
    id: z.string().optional().describe("Optional ID to update existing note, or memorable ID for new note"),
  },
  async ({ content, id }) => {
    try {
      // Check if this is an update (ID exists)
      if (id) {
        try {
          const existing = await client.getThought(id);
          if (existing) {
            // Update existing thought
            const thought = await client.updateThought(id, content);
            return formatSuccess(
              { id: thought.id, content: thought.content, updated: true },
              `✅ Updated note "${id}"`
            );
          }
        } catch {
          // ID doesn't exist, will create new
        }
      }
      
      // Create new thought
      const thought = await client.createThought(content, { id });
      return formatSuccess(
        { id: thought.id, content: thought.content, created: true },
        `✅ Saved note "${thought.id}"`
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_search - Find notes by meaning or list all
// ============================================================================

server.tool(
  "indra_search",
  `Search the user's notes by meaning, or list all notes.

USE THIS WHEN:
- Starting to answer a question (check for prior context)
- The user asks about preferences or past decisions
- You want to see what's been recorded
- Looking for related information

SEARCH MODES:
- Semantic search: indra_search(query="shoe recommendations")
- List all notes: indra_search(query="*")

Returns notes ranked by relevance with similarity scores.`,
  {
    query: z.string().describe('What to search for, or "*" to list all notes'),
    limit: z.number().min(1).max(50).default(10).describe("Maximum results to return"),
  },
  async ({ query, limit }) => {
    try {
      // Special case: list all
      if (query === "*") {
        const result = await client.listThoughts();
        if (result.count === 0) {
          return formatSuccess(
            { count: 0, notes: [] },
            `📭 No notes yet. Use indra_remember to save some!`
          );
        }
        return formatSuccess(
          { count: result.count, notes: result.thoughts },
          `📋 Found ${result.count} note(s):`
        );
      }
      
      // Semantic search
      const result = await client.search(query, limit);
      if (result.count === 0) {
        return formatSuccess(
          { query, count: 0, results: [] },
          `📭 No notes found matching "${query}"`
        );
      }
      return formatSuccess(
        { query, count: result.count, results: result.results },
        `🔍 Found ${result.count} note(s) matching "${query}":`
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_status - Get current state
// ============================================================================

server.tool(
  "indra_status",
  `Check the status of the user's notes database.

Shows:
- Database location
- Number of notes
- Current branch (if using versioning)

Use this to orient yourself at the start of a session.`,
  {},
  async () => {
    try {
      const status = await client.status();
      const thoughts = await client.listThoughts();
      return formatSuccess(
        { 
          database: status.database,
          branch: status.branch,
          noteCount: thoughts.count,
          dirty: status.dirty
        },
        `📊 Notes database status:`
      );
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
  
  console.error(`[indra_db_mcp] Starting server v0.1.11...`);
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
