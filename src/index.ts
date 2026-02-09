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
  version: "0.1.26",
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
      
      // Get branch info
      let branchInfo: { current: string; count: number } = { current: status.branch, count: 1 };
      try {
        const branches = await client.listBranches();
        branchInfo = {
          current: branches.current,
          count: branches.branches.length,
        };
      } catch {
        // Branching info unavailable
      }
      
      // Check auth status
      const authStatus = hasAuth() 
        ? "authenticated (API key set)" 
        : "not authenticated (local-only mode)";
      
      return formatSuccess(
        { 
          database: status.database,
          branch: branchInfo.current,
          branchCount: branchInfo.count,
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
// TOOL: indra_branch - Create or switch branches for parallel explorations
// ============================================================================

server.tool(
  "indra_branch",
  `Create parallel versions of memory for exploring different directions.

Branches let you:
- Explore "what if" scenarios without losing the original
- Keep separate contexts (e.g., "work" vs "personal" projects)
- Experiment with reorganizing notes safely

Create a branch BEFORE making changes you might want to undo.
Think of it like saving a game before a risky decision.

Common patterns:
- "experiment-feature-x" for trying new ideas
- "backup-before-cleanup" before reorganizing
- Context-specific names like "project-alpha" or "q1-planning"`,
  {
    action: z.enum(["create", "switch", "list"]).describe("What to do: create new branch, switch to existing, or list all"),
    name: z.string().optional().describe("Branch name (required for create/switch)"),
  },
  async ({ action, name }) => {
    try {
      switch (action) {
        case "create": {
          if (!name) {
            return formatError(new Error("Branch name required for 'create' action"));
          }
          const branch = await client.createBranch(name);
          const syncResult = await tryPushSync();
          return formatSuccess(
            { name: branch.name, commit: branch.commit_hash, created: true },
            `🌿 Created branch "${name}" - you're now on this branch`,
            syncResult.warning
          );
        }
        
        case "switch": {
          if (!name) {
            return formatError(new Error("Branch name required for 'switch' action"));
          }
          await client.checkout(name);
          // Pull to get latest from this branch
          const syncResult = await tryPullSync();
          const thoughts = await client.listThoughts();
          return formatSuccess(
            { branch: name, switched: true, noteCount: thoughts.count },
            `🔀 Switched to branch "${name}" (${thoughts.count} notes)`,
            syncResult.warning
          );
        }
        
        case "list": {
          const result = await client.listBranches();
          const branchList = result.branches.map(b => ({
            name: b.name,
            current: b.name === result.current,
            commit: b.commit_hash.substring(0, 8),
          }));
          return formatSuccess(
            { current: result.current, count: result.branches.length, branches: branchList },
            `🌳 ${result.branches.length} branch(es), current: "${result.current}"`
          );
        }
      }
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_history - View and navigate version history
// ============================================================================

server.tool(
  "indra_history",
  `See how the user's notes have evolved over time.

Use this to:
- Understand what changed and when
- Find when a particular note was added/modified
- Review the user's thinking patterns over time

Each change is automatically saved with a timestamp.
The history is preserved across branches.`,
  {
    limit: z.number().min(1).max(100).default(10).describe("Maximum commits to show"),
  },
  async ({ limit }) => {
    try {
      const result = await client.log(limit);
      const commits = result.commits.map(c => ({
        hash: c.hash.substring(0, 8),
        message: c.message,
        timestamp: c.timestamp,
      }));
      return formatSuccess(
        { branch: result.branch, count: result.count, commits },
        `📜 Recent history (${result.count} commits):`
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_diff - Compare versions to see what changed
// ============================================================================

server.tool(
  "indra_diff",
  `Compare two points in history to see exactly what changed.

Use this to:
- Understand what was added, removed, or modified
- Review changes between branches
- Debug when something went wrong ("what did I change?")

Helpful for understanding the impact of experiments before merging.`,
  {
    from: z.string().optional().describe("Starting commit hash or branch name (defaults to previous commit)"),
    to: z.string().optional().describe("Ending commit hash or branch name (defaults to current HEAD)"),
  },
  async ({ from, to }) => {
    try {
      const result = await client.diff(from, to);
      
      const summary = {
        added: result.added.length,
        removed: result.removed.length,
        modified: result.modified.length,
        edges_added: result.edges_added.length,
        edges_removed: result.edges_removed.length,
      };
      
      return formatSuccess(
        {
          summary,
          added: result.added.map(t => ({ id: t.id, content: t.content })),
          removed: result.removed.map(t => ({ id: t.id, content: t.content })),
          modified: result.modified.map(m => ({
            id: m.after.id,
            before: m.before.content,
            after: m.after.content,
          })),
        },
        `📊 Changes ${from ? `from ${from}` : "from previous commit"} ${to ? `to ${to}` : "to HEAD"}:`
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_experiment - Quick sandbox for trying ideas
// ============================================================================

server.tool(
  "indra_experiment",
  `Create a safe sandbox to try ideas without affecting the main timeline.

This is a shortcut that:
1. Creates a new branch with a descriptive name
2. Switches to it automatically
3. Returns a reminder of what branch you're on

Perfect for:
- "What if I reorganize these notes this way?"
- "Let me try a different approach"
- "I want to explore this tangent without losing my main thread"

When done experimenting, use indra_branch to switch back to main.`,
  {
    name: z.string().describe("Descriptive name for this experiment (e.g., 'reorganize-projects', 'alternative-approach')"),
  },
  async ({ name }) => {
    try {
      // Create and checkout happens in one command
      const branch = await client.createBranch(name);
      const syncResult = await tryPushSync();
      const thoughts = await client.listThoughts();
      
      return formatSuccess(
        { 
          branch: name, 
          noteCount: thoughts.count,
          reminder: `You're now in experiment "${name}". Changes here won't affect main.`,
        },
        `🧪 Created experiment branch "${name}" (${thoughts.count} notes)`,
        syncResult.warning
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
  
  console.error(`[indra_db_mcp] Starting server v0.1.26...`);
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
