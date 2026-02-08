#!/usr/bin/env bun
/**
 * indra_db MCP Server - Simplified API
 * 
 * A Model Context Protocol server for managing the user's personal notes.
 * 
 * DESIGN PRINCIPLES:
 * 1. Minimal tools - each tool does ONE thing well
 * 2. Auto-commit - every mutation persists immediately
 * 3. Auto-sync - pull before search, push after remember
 * 4. Self-contained - no tool depends on another being called first
 * 5. Clear purpose - tool names match what users would say
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { IndraClient } from "./indra-client.js";
import { IndraError } from "./types.js";

// ============================================================================
// Server Setup
// ============================================================================

const server = new McpServer({
  name: "indra_db",
  version: "0.1.24",
});

const client = new IndraClient();

// ============================================================================
// Sync Helpers
// ============================================================================

interface SyncResult {
  synced: boolean;
  warning?: string;
}

/**
 * Check if we have authentication configured.
 * Auth is needed for:
 * - Pushing to any base (you need to be logged in to write)
 * - Pulling from private bases
 * 
 * Authentication can come from:
 * - INDRA_API_KEY env var (legacy API key)
 * - OAuth credentials file (from `indra login`)
 */
function hasAuth(): boolean {
  // Check for legacy API key
  if (process.env.INDRA_API_KEY) {
    return true;
  }
  
  // Check for OAuth credentials file
  const { existsSync } = require("fs");
  const { homedir } = require("os");
  const { join } = require("path");
  
  // Check both possible credential locations
  const credentialsPaths = [
    join(homedir(), "Library", "Application Support", "indra", "credentials.json"),
    join(homedir(), ".config", "indra", "credentials.json"),
  ];
  
  for (const path of credentialsPaths) {
    if (existsSync(path)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Attempt to pull from remote before read operations.
 * Uses hash comparison for fast merge (ORT-style).
 * Returns warning message if sync failed, but never throws.
 * 
 * Pull behavior:
 * - Public bases: works without auth
 * - Private bases: requires INDRA_API_KEY
 * - No remote configured: silently skip (local-only mode is fine)
 */
async function tryPullSync(): Promise<SyncResult> {
  try {
    // Check if remote is configured
    const remotes = await client.remoteList();
    if (remotes.count === 0) {
      return { synced: false }; // No remote, that's fine - local only mode
    }
    
    const result = await client.pull();
    if (result.status === "ok") {
      return { synced: true };
    } else if (result.status === "pending") {
      // API not connected yet - this is expected during development
      return { synced: false };
    } else if (result.message?.includes("Not found")) {
      // Remote doesn't exist yet or is private without auth - that's ok for reads
      return { synced: false };
    } else {
      return { synced: false, warning: `Sync: ${result.message}` };
    }
  } catch (error) {
    // Network error or other issue - don't block the operation
    const msg = error instanceof Error ? error.message : String(error);
    // Only warn if it's not a "no remote" or "not found" error
    if (!msg.includes("not found") && !msg.includes("No remote") && !msg.includes("Not found")) {
      return { synced: false, warning: `Sync unavailable: ${msg}` };
    }
    return { synced: false };
  }
}

/**
 * Attempt to push to remote after write operations.
 * Returns warning message if sync failed, but never throws.
 * 
 * Push behavior:
 * - Always requires auth (you need to be logged in to write)
 * - No remote configured: silently skip
 * - No auth: skip silently (user is in local-only mode)
 */
async function tryPushSync(): Promise<SyncResult> {
  try {
    // Check if remote is configured
    const remotes = await client.remoteList();
    if (remotes.count === 0) {
      return { synced: false }; // No remote, that's fine - local only mode
    }
    
    // Check if we have auth - push always requires it
    if (!hasAuth()) {
      // No auth, but that's fine - user is working locally
      // They can push later with `indra login` + `indra push`
      return { synced: false };
    }
    
    const result = await client.push();
    if (result.status === "ok") {
      return { synced: true };
    } else if (result.status === "pending") {
      // API not connected yet - this is expected during development
      return { synced: false };
    } else {
      return { synced: false, warning: `Sync: ${result.message}` };
    }
  } catch (error) {
    // Network error or other issue - don't block the operation
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes("not found") && !msg.includes("No remote")) {
      return { synced: false, warning: `Sync unavailable: ${msg}` };
    }
    return { synced: false };
  }
}

// ============================================================================
// Helper: Format responses for LLM consumption
// ============================================================================

function formatSuccess(
  data: unknown, 
  context?: string,
  syncWarning?: string
): { content: Array<{ type: "text"; text: string }> } {
  let response = context 
    ? `${context}\n\n${JSON.stringify(data, null, 2)}`
    : JSON.stringify(data, null, 2);
  
  if (syncWarning) {
    response = `⚠️ ${syncWarning}\n\n${response}`;
  }
  
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
  `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call BEFORE responding when you learn something worth keeping.`,
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
            
            // Push after write
            const syncResult = await tryPushSync();
            
            return formatSuccess(
              { id: thought.id, content: thought.content, updated: true },
              `✅ Updated note "${id}"`,
              syncResult.warning
            );
          }
        } catch {
          // ID doesn't exist, will create new
        }
      }
      
      // Create new thought
      const thought = await client.createThought(content, { id });
      
      // Push after write
      const syncResult = await tryPushSync();
      
      return formatSuccess(
        { id: thought.id, content: thought.content, created: true },
        `✅ Saved note "${thought.id}"`,
        syncResult.warning
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
  `Recall what you know about this user and topic.

You may have valuable context from previous conversations:
- Past preferences and decisions
- Ongoing situations or goals
- Previous recommendations you made

Always worth checking - takes milliseconds, could save back-and-forth.`,
  {
    query: z.string().describe('What to search for, or "*" to list all notes'),
    limit: z.number().min(1).max(50).default(10).describe("Maximum results to return"),
  },
  async ({ query, limit }) => {
    try {
      // Pull before read to get latest from remote
      const syncResult = await tryPullSync();
      
      // Special case: list all
      if (query === "*") {
        const result = await client.listThoughts();
        if (result.count === 0) {
        return formatSuccess(
          { count: 0, notes: [] },
          `📭 No notes yet. Use indra_remember to save some!`,
          syncResult.warning
        );
        }
      return formatSuccess(
        { count: result.count, notes: result.thoughts },
        `📋 Found ${result.count} note(s):`,
        syncResult.warning
      );
      }
      
      // Semantic search
      const result = await client.search(query, limit);
      if (result.count === 0) {
      return formatSuccess(
        { query, count: 0, results: [] },
        `📭 No notes found matching "${query}"`,
        syncResult.warning
      );
      }
    return formatSuccess(
      { query, count: result.count, results: result.results },
      `🔍 Found ${result.count} note(s) matching "${query}":`,
      syncResult.warning
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
      
      // Check remote configuration
      let remoteInfo: { configured: boolean; name?: string; url?: string } = { configured: false };
      try {
        const remotes = await client.remoteList();
        if (remotes.count > 0 && remotes.remotes[0]) {
          remoteInfo = {
            configured: true,
            name: remotes.remotes[0].name,
            url: remotes.remotes[0].url,
          };
        }
      } catch {
        // No remotes configured
      }
      
      // Check auth status
      const authStatus = hasAuth() 
        ? "authenticated (API key set)" 
        : "not authenticated (local-only mode)";
      
      return formatSuccess(
        { 
          database: status.database,
          branch: status.branch,
          noteCount: thoughts.count,
          dirty: status.dirty,
          remote: remoteInfo,
          auth: authStatus,
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
  
  console.error(`[indra_db_mcp] Starting server v0.1.24...`);
  console.error(`[indra_db_mcp] Database path: ${client.getDatabasePath()}`);
  console.error(`[indra_db_mcp] API URL: ${client.getApiUrl()}`);
  if (client.isDevMode()) {
    console.error(`[indra_db_mcp] ⚠️  DEV MODE ACTIVE`);
  }
  
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
