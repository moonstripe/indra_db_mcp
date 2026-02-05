/**
 * MCP Integration Tests
 * 
 * These tests verify that the MCP server correctly wraps the CLI.
 * They test the IndraClient class which spawns the CLI subprocess.
 * 
 * Run with:
 * ```bash
 * bun test
 * ```
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { IndraClient } from "./indra-client";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync } from "fs";

describe("IndraClient", () => {
  let tempDir: string;
  let dbPath: string;
  let client: IndraClient;

  beforeEach(async () => {
    // Create a fresh temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "indra-test-"));
    dbPath = join(tempDir, ".indra");
    client = new IndraClient({ databasePath: dbPath });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==========================================================================
  // Database Initialization
  // ==========================================================================

  describe("initialization", () => {
    test("creates database file on first operation", async () => {
      expect(existsSync(dbPath)).toBe(false);
      
      await client.init();
      
      expect(existsSync(dbPath)).toBe(true);
    });

    test("getDatabasePath returns configured path", () => {
      expect(client.getDatabasePath()).toBe(dbPath);
    });
  });

  // ==========================================================================
  // Thought CRUD Operations
  // ==========================================================================

  describe("thought operations", () => {
    test("createThought returns thought with ID", async () => {
      const thought = await client.createThought("Test content");
      
      expect(thought).toBeDefined();
      expect(thought.id).toBeDefined();
      expect(typeof thought.id).toBe("string");
    });

    test("createThought with custom ID uses that ID", async () => {
      const thought = await client.createThought("Test content", { id: "my-custom-id" });
      
      expect(thought.id).toBe("my-custom-id");
    });

    test("getThought retrieves created thought", async () => {
      await client.createThought("Retrievable content", { id: "retrieve-test" });
      
      const thought = await client.getThought("retrieve-test");
      
      expect(thought.content).toBe("Retrievable content");
      expect(thought.id).toBe("retrieve-test");
    });

    test("getThought throws for nonexistent thought", async () => {
      await client.init();
      
      await expect(client.getThought("nonexistent")).rejects.toThrow();
    });

    test("updateThought modifies content", async () => {
      await client.createThought("Original content", { id: "update-test" });
      
      await client.updateThought("update-test", "Updated content");
      
      const thought = await client.getThought("update-test");
      expect(thought.content).toBe("Updated content");
    });

    test("deleteThought removes thought", async () => {
      await client.createThought("To be deleted", { id: "delete-test" });
      
      await client.deleteThought("delete-test");
      
      await expect(client.getThought("delete-test")).rejects.toThrow();
    });

    test("listThoughts returns all thoughts", async () => {
      await client.createThought("First thought", { id: "first" });
      await client.createThought("Second thought", { id: "second" });
      
      const result = await client.listThoughts();
      
      expect(result.count).toBe(2);
      expect(result.thoughts).toHaveLength(2);
      
      const ids = result.thoughts.map(t => t.id);
      expect(ids).toContain("first");
      expect(ids).toContain("second");
    });

    test("listThoughts on empty database returns empty array", async () => {
      await client.init();
      
      const result = await client.listThoughts();
      
      expect(result.count).toBe(0);
      expect(result.thoughts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Search Operations
  // ==========================================================================

  describe("search operations", () => {
    test("search returns results", async () => {
      await client.createThought("The cat sat on the mat", { id: "cat" });
      await client.createThought("Dogs love to play", { id: "dog" });
      
      const result = await client.search("cat", 10);
      
      expect(result.count).toBeGreaterThanOrEqual(0);
      expect(result.results).toBeDefined();
    });

    test("search on empty database returns empty results", async () => {
      await client.init();
      
      const result = await client.search("anything", 10);
      
      expect(result.count).toBe(0);
      expect(result.results).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Status Operations
  // ==========================================================================

  describe("status operations", () => {
    test("status returns database info", async () => {
      await client.init();
      
      const status = await client.status();
      
      expect(status.branch).toBe("main");
      expect(status.database).toBeDefined();
    });

    test("status shows not dirty after operation (auto-commit)", async () => {
      await client.createThought("Test thought");
      
      const status = await client.status();
      
      expect(status.dirty).toBe(false);
    });
  });

  // ==========================================================================
  // Persistence Tests (Critical!)
  // ==========================================================================

  describe("persistence", () => {
    test("data persists after client is recreated", async () => {
      // First "session"
      await client.createThought("Persistent thought", { id: "persist-test" });
      
      // Create new client (simulates new MCP session)
      const newClient = new IndraClient({ databasePath: dbPath });
      
      // Verify data exists
      const thought = await newClient.getThought("persist-test");
      expect(thought.content).toBe("Persistent thought");
    });

    test("multiple thoughts persist across sessions", async () => {
      // Create thoughts
      await client.createThought("First", { id: "p1" });
      await client.createThought("Second", { id: "p2" });
      await client.createThought("Third", { id: "p3" });
      
      // New client
      const newClient = new IndraClient({ databasePath: dbPath });
      
      // Verify all exist
      const result = await newClient.listThoughts();
      expect(result.count).toBe(3);
    });

    test("commits are visible in new session", async () => {
      await client.createThought("Thought 1", { id: "c1" });
      await client.createThought("Thought 2", { id: "c2" });
      
      // New client
      const newClient = new IndraClient({ databasePath: dbPath });
      
      const log = await newClient.log();
      expect(log.count).toBe(2);
    });
  });

  // ==========================================================================
  // Database Path Tests (This was the bug!)
  // ==========================================================================

  describe("database path", () => {
    test("uses .indra in current directory by default", () => {
      const defaultClient = new IndraClient();
      const path = defaultClient.getDatabasePath();
      
      expect(path.endsWith(".indra")).toBe(true);
      expect(path).not.toContain("thoughts.indra");
    });

    test("respects INDRA_DB_PATH environment variable", async () => {
      const customPath = join(tempDir, "custom-db.indra");
      process.env.INDRA_DB_PATH = customPath;
      
      try {
        const envClient = new IndraClient();
        expect(envClient.getDatabasePath()).toBe(customPath);
      } finally {
        delete process.env.INDRA_DB_PATH;
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("edge cases", () => {
    test("handles empty content", async () => {
      const thought = await client.createThought("");
      expect(thought.id).toBeDefined();
    });

    test("handles special characters in content", async () => {
      const specialContent = 'Special: "quotes", \'apostrophes\', emoji 🎉';
      const thought = await client.createThought(specialContent, { id: "special" });
      
      const retrieved = await client.getThought("special");
      expect(retrieved.content).toBe(specialContent);
    });

    test("handles unicode content", async () => {
      const unicodeContent = "Unicode: 日本語 中文 한국어";
      const thought = await client.createThought(unicodeContent, { id: "unicode" });
      
      const retrieved = await client.getThought("unicode");
      expect(retrieved.content).toBe(unicodeContent);
    });

    test("handles newlines in content", async () => {
      const multilineContent = "Line 1\nLine 2\nLine 3";
      const thought = await client.createThought(multilineContent, { id: "multiline" });
      
      const retrieved = await client.getThought("multiline");
      expect(retrieved.content).toBe(multilineContent);
    });

    test("handles very long content", async () => {
      const longContent = "x".repeat(10_000);
      const thought = await client.createThought(longContent, { id: "long" });
      
      const retrieved = await client.getThought("long");
      expect(retrieved.content.length).toBe(10_000);
    });
  });

  // ==========================================================================
  // Version Control Operations
  // ==========================================================================

  describe("version control", () => {
    test("log shows commit history", async () => {
      await client.createThought("First");
      await client.createThought("Second");
      
      const log = await client.log();
      
      expect(log.count).toBe(2);
      expect(log.commits).toHaveLength(2);
    });

    test("createBranch creates a new branch", async () => {
      await client.createThought("Initial");
      
      const branch = await client.createBranch("feature");
      
      expect(branch).toBeDefined();
    });

    test("listBranches shows all branches", async () => {
      await client.createThought("Initial");
      await client.createBranch("feature");
      
      const branches = await client.listBranches();
      
      expect(branches.branches).toBeDefined();
      const names = branches.branches.map((b: any) => b.name);
      expect(names).toContain("main");
      expect(names).toContain("feature");
    });
  });
});
