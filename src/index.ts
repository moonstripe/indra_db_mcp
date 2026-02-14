#!/usr/bin/env bun
/**
 * indra_db MCP Server
 * 
 * Persistent memory for your reasoning process.
 * Track how your understanding evolves, why you made decisions,
 * and explore alternative approaches through branching.
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
  version: "0.2.1",
});

const client = new IndraClient();

// ============================================================================
// Sync Helpers
// ============================================================================

interface SyncResult {
  synced: boolean;
  warning?: string;
}

function hasAuth(): boolean {
  if (process.env.INDRA_API_KEY) {
    return true;
  }
  
  const { existsSync } = require("fs");
  const { homedir } = require("os");
  const { join } = require("path");
  
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

async function tryPullSync(): Promise<SyncResult> {
  try {
    const remotes = await client.remoteList();
    if (remotes.count === 0) {
      return { synced: false };
    }
    
    const result = await client.pull();
    if (result.status === "ok") {
      return { synced: true };
    } else if (result.status === "pending") {
      return { synced: false };
    } else if (result.message?.includes("Not found")) {
      return { synced: false };
    } else {
      return { synced: false, warning: `Sync: ${result.message}` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes("not found") && !msg.includes("No remote") && !msg.includes("Not found")) {
      return { synced: false, warning: `Sync unavailable: ${msg}` };
    }
    return { synced: false };
  }
}

async function tryPushSync(): Promise<SyncResult> {
  try {
    const remotes = await client.remoteList();
    if (remotes.count === 0) {
      return { synced: false };
    }
    
    if (!hasAuth()) {
      return { synced: false };
    }
    
    const result = await client.push();
    if (result.status === "ok") {
      return { synced: true };
    } else if (result.status === "pending") {
      return { synced: false };
    } else {
      return { synced: false, warning: `Sync: ${result.message}` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes("not found") && !msg.includes("No remote")) {
      return { synced: false, warning: `Sync unavailable: ${msg}` };
    }
    return { synced: false };
  }
}

// ============================================================================
// Helper: Format responses
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
// TOOL: indra_remember - Document your reasoning
// ============================================================================

server.tool(
  "indra_remember",
  `Document your reasoning process.

CALL THIS WHEN you:
- Choose an approach and want to record WHY
- Change your recommendation and want to capture WHAT SHIFTED
- Reach a conclusion worth preserving
- Want to trace HOW you arrived at a decision

Record the reasoning, not just the facts. Future you needs the WHY.`,
  {
    content: z.string().describe("Your reasoning - include the why, not just the what"),
    id: z.string().optional().describe("Optional ID to update existing entry"),
  },
  async ({ content, id }) => {
    try {
      if (id) {
        try {
          const existing = await client.getThought(id);
          if (existing) {
            const thought = await client.updateThought(id, content);
            const syncResult = await tryPushSync();
            return formatSuccess(
              { id: thought.id, updated: true },
              `✅ Updated "${id}"`,
              syncResult.warning
            );
          }
        } catch {
          // ID doesn't exist, will create new
        }
      }
      
      const thought = await client.createThought(content, { id });
      const syncResult = await tryPushSync();
      
      return formatSuccess(
        { id: thought.id, created: true },
        `✅ Recorded "${thought.id}"`,
        syncResult.warning
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_search - Review past reasoning
// ============================================================================

server.tool(
  "indra_search",
  `Review how you've reasoned about similar topics before.

CALL THIS WHEN you:
- Are about to make a recommendation (check for prior reasoning)
- Want to maintain consistency with earlier conclusions
- Need to recall the journey, not just the destination
- Are asked about previous discussions

Your past reasoning is context. Use it.`,
  {
    query: z.string().describe('What to search for, or "*" to list all'),
    limit: z.number().min(1).max(50).default(10).describe("Maximum results"),
  },
  async ({ query, limit }) => {
    try {
      const syncResult = await tryPullSync();
      
      if (query === "*") {
        const result = await client.listThoughts();
        if (result.count === 0) {
          return formatSuccess(
            { count: 0, entries: [] },
            `📭 No reasoning recorded yet.`,
            syncResult.warning
          );
        }
        return formatSuccess(
          { count: result.count, entries: result.thoughts },
          `📋 ${result.count} entries:`,
          syncResult.warning
        );
      }
      
      const result = await client.search(query, limit);
      if (result.count === 0) {
        return formatSuccess(
          { query, count: 0, results: [] },
          `📭 No prior reasoning on "${query}"`,
          syncResult.warning
        );
      }
      return formatSuccess(
        { query, count: result.count, results: result.results },
        `🔍 ${result.count} relevant entries:`,
        syncResult.warning
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_status - Current state
// ============================================================================

server.tool(
  "indra_status",
  `Check current memory state and branch.`,
  {},
  async () => {
    try {
      const status = await client.status();
      const thoughts = await client.listThoughts();
      
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
      
      return formatSuccess(
        { 
          branch: branchInfo.current,
          branches: branchInfo.count,
          entries: thoughts.count,
          remote: remoteInfo,
        },
        `📊 Current state:`
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_branch - Manage reasoning threads
// ============================================================================

server.tool(
  "indra_branch",
  `Manage parallel lines of reasoning.

CALL THIS WHEN you:
- Want to explore an alternative without losing the current thread
- Need to compare two different approaches
- Are about to go down a path you might want to abandon

Branches are cheap. Create them freely.`,
  {
    action: z.enum(["create", "switch", "list"]).describe("What to do"),
    name: z.string().optional().describe("Branch name (required for create/switch)"),
  },
  async ({ action, name }) => {
    try {
      switch (action) {
        case "create": {
          if (!name) {
            return formatError(new Error("Branch name required for 'create'"));
          }
          const branch = await client.createBranch(name);
          const syncResult = await tryPushSync();
          return formatSuccess(
            { name: branch.name, created: true },
            `🌿 Created and switched to "${name}"`,
            syncResult.warning
          );
        }
        
        case "switch": {
          if (!name) {
            return formatError(new Error("Branch name required for 'switch'"));
          }
          await client.checkout(name);
          const syncResult = await tryPullSync();
          const thoughts = await client.listThoughts();
          return formatSuccess(
            { branch: name, entries: thoughts.count },
            `🔀 Switched to "${name}" (${thoughts.count} entries)`,
            syncResult.warning
          );
        }
        
        case "list": {
          const result = await client.listBranches();
          const branchList = result.branches.map(b => ({
            name: b.name,
            current: b.name === result.current,
          }));
          return formatSuccess(
            { current: result.current, branches: branchList },
            `🌳 ${result.branches.length} branch(es), on "${result.current}"`
          );
        }
      }
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_history - View reasoning evolution
// ============================================================================

server.tool(
  "indra_history",
  `See how your reasoning has evolved.

Shows the timeline of recorded thoughts — useful for understanding 
how you arrived at current conclusions.`,
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
        { branch: result.branch, commits },
        `📜 Reasoning timeline:`
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_diff - Compare reasoning paths
// ============================================================================

server.tool(
  "indra_diff",
  `Compare two points in your reasoning.

CALL THIS WHEN you:
- Want to see what changed between branches
- Need to understand how your thinking evolved
- Are deciding whether to merge an experimental branch`,
  {
    from: z.string().optional().describe("Starting point (commit or branch)"),
    to: z.string().optional().describe("Ending point (defaults to HEAD)"),
  },
  async ({ from, to }) => {
    try {
      const result = await client.diff(from, to);
      
      const summary = {
        added: result.added.length,
        removed: result.removed.length,
        modified: result.modified.length,
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
        `📊 Reasoning diff:`
      );
    } catch (error) {
      return formatError(error);
    }
  }
);

// ============================================================================
// TOOL: indra_experiment - Quick exploration branch
// ============================================================================

server.tool(
  "indra_experiment",
  `Start exploring an alternative approach.

Creates a branch and switches to it. Use when you want to:
- Think through a different path
- Try something you might abandon
- Compare approaches without losing your main thread

When done, switch back to main or merge your findings.`,
  {
    name: z.string().describe("Descriptive name for this exploration"),
  },
  async ({ name }) => {
    try {
      const branch = await client.createBranch(name);
      const syncResult = await tryPushSync();
      const thoughts = await client.listThoughts();
      
      return formatSuccess(
        { 
          branch: name, 
          entries: thoughts.count,
        },
        `🧪 Exploring "${name}" — main thread preserved`,
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
  
  console.error(`[indra_db_mcp] Starting server v0.2.1...`);
  console.error(`[indra_db_mcp] Database path: ${client.getDatabasePath()}`);
  console.error(`[indra_db_mcp] API URL: ${client.getApiUrl()}`);
  if (client.isDevMode()) {
    console.error(`[indra_db_mcp] ⚠️  DEV MODE ACTIVE`);
  }
  
  try {
    await client.init();
    console.error(`[indra_db_mcp] Database initialized successfully`);
  } catch (error) {
    console.error(`[indra_db_mcp] Warning: ${error}`);
  }
  
  await server.connect(transport);
  console.error(`[indra_db_mcp] Server connected and ready`);
}

main().catch((error) => {
  console.error(`[indra_db_mcp] Fatal error:`, error);
  process.exit(1);
});
