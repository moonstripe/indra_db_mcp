/**
 * End-to-End Tests
 * 
 * These tests simulate real MCP tool usage patterns:
 * 1. Save data in one "session"
 * 2. Close and reopen (new client instance)
 * 3. Search/retrieve the data
 * 
 * This is the exact pattern that was broken before v0.1.13.
 * 
 * Run with:
 * ```bash
 * bun test src/e2e.test.ts
 * ```
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { IndraClient } from "./indra-client";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("End-to-End: Real MCP Usage Patterns", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "indra-e2e-"));
    dbPath = join(tempDir, ".indra");
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==========================================================================
  // The Critical Bug Scenario
  // ==========================================================================

  test("CRITICAL: data persists between completely separate sessions", async () => {
    // --- Session 1: User asks about shoes, model saves preference ---
    const session1 = new IndraClient({ databasePath: dbPath });
    
    // Model searches (finds nothing - new user)
    const initialSearch = await session1.search("shoe preferences", 10);
    expect(initialSearch.count).toBe(0);
    
    // Model learns and saves
    await session1.createThought(
      "User prefers Hokas over Altras for arch support during marathon training",
      { id: "shoe-preference" }
    );
    
    // Session 1 ends (client goes out of scope, process would exit in real MCP)
    
    // --- Session 2: New conversation, model should find the preference ---
    const session2 = new IndraClient({ databasePath: dbPath });
    
    // Model searches
    const result = await session2.search("shoe preferences", 10);
    
    // THIS IS THE CRITICAL ASSERTION
    // Before the fix, this would return 0 results
    expect(result.count).toBeGreaterThan(0);
    expect(result.results.some(r => r.content.includes("Hokas"))).toBe(true);
  });

  test("CRITICAL: multiple saves in session 1 all persist to session 2", async () => {
    // --- Session 1: Model saves multiple pieces of context ---
    const session1 = new IndraClient({ databasePath: dbPath });
    
    await session1.createThought(
      "User is training for NYRR United Half Marathon on March 15, 2026",
      { id: "race-goal" }
    );
    
    await session1.createThought(
      "User has metatarsalgia in left foot, currently resting",
      { id: "injury-status" }
    );
    
    await session1.createThought(
      "User switched from Altra to Hoka shoes for better cushioning",
      { id: "shoe-switch" }
    );
    
    // --- Session 2: All should be findable ---
    const session2 = new IndraClient({ databasePath: dbPath });
    
    const allNotes = await session2.listThoughts();
    expect(allNotes.count).toBe(3);
    
    // Search for specific topics
    const raceSearch = await session2.search("marathon race goal", 10);
    expect(raceSearch.results.some(r => r.content.includes("March 15"))).toBe(true);
    
    const injurySearch = await session2.search("injury foot pain", 10);
    expect(injurySearch.results.some(r => r.content.includes("metatarsalgia"))).toBe(true);
  });

  // ==========================================================================
  // Real Workflow Simulations
  // ==========================================================================

  test("workflow: update existing note in new session", async () => {
    // Session 1: Initial save
    const session1 = new IndraClient({ databasePath: dbPath });
    await session1.createThought(
      "User prefers morning runs",
      { id: "running-preference" }
    );
    
    // Session 2: User mentions they changed preference
    const session2 = new IndraClient({ databasePath: dbPath });
    
    // Model finds the old preference
    const oldPref = await session2.getThought("running-preference");
    expect(oldPref.content).toContain("morning");
    
    // Model updates it
    await session2.updateThought(
      "running-preference",
      "User prefers evening runs after work (changed from morning)"
    );
    
    // Session 3: Verify update persisted
    const session3 = new IndraClient({ databasePath: dbPath });
    const newPref = await session3.getThought("running-preference");
    expect(newPref.content).toContain("evening");
  });

  test("workflow: search → answer → save pattern", async () => {
    // Session 1: Build up some context
    const session1 = new IndraClient({ databasePath: dbPath });
    await session1.createThought("User's goal pace is 8:30/mile for half marathon");
    await session1.createThought("User runs 4 days per week");
    await session1.createThought("User does cross-training on Tuesdays");
    
    // Session 2: User asks "what's my training schedule?"
    const session2 = new IndraClient({ databasePath: dbPath });
    
    // Step 1: Model searches
    const context = await session2.search("training schedule runs per week", 10);
    expect(context.count).toBeGreaterThan(0);
    
    // Step 2: Model answers using context (simulated)
    // ...
    
    // Step 3: Model saves new insight from conversation
    await session2.createThought(
      "Recommended adding a tempo run on Thursdays to improve race pace",
      { id: "tempo-recommendation" }
    );
    
    // Session 3: Verify the recommendation persisted
    const session3 = new IndraClient({ databasePath: dbPath });
    const rec = await session3.getThought("tempo-recommendation");
    expect(rec.content).toContain("tempo run");
  });

  // ==========================================================================
  // Stress Tests
  // ==========================================================================

  test("stress: concurrent writes should not corrupt database (issue #2)", async () => {
    const client = new IndraClient({ databasePath: dbPath });
    
    // Fire off 7+ writes concurrently (the exact pattern that caused corruption)
    const writes = Array.from({ length: 10 }, (_, i) =>
      client.createThought(`Concurrent note ${i}: rapid fire save`, { id: `concurrent-${i}` })
    );
    
    // All should succeed without corruption
    const results = await Promise.all(writes);
    expect(results.length).toBe(10);
    
    // Verify all notes persisted correctly
    const newClient = new IndraClient({ databasePath: dbPath });
    const all = await newClient.listThoughts();
    expect(all.count).toBe(10);
    
    // Verify each one is readable
    for (let i = 0; i < 10; i++) {
      const thought = await newClient.getThought(`concurrent-${i}`);
      expect(thought.content).toContain(`Concurrent note ${i}`);
    }
  });

  test("stress: concurrent writes with interleaved reads (issue #2)", async () => {
    const client = new IndraClient({ databasePath: dbPath });
    
    // Interleave writes and reads concurrently
    const operations = [];
    for (let i = 0; i < 5; i++) {
      operations.push(client.createThought(`Interleaved ${i}`, { id: `interleaved-${i}` }));
      operations.push(client.listThoughts());
      operations.push(client.search("interleaved", 10));
    }
    
    // None should throw corruption errors
    const results = await Promise.allSettled(operations);
    const failures = results.filter(r => r.status === 'rejected');
    expect(failures.length).toBe(0);
    
    // Verify final state
    const newClient = new IndraClient({ databasePath: dbPath });
    const all = await newClient.listThoughts();
    expect(all.count).toBe(5);
  });

  test("stress: many notes across many sessions", async () => {
    const noteCount = 50;
    
    // Create notes across multiple "sessions"
    for (let i = 0; i < noteCount; i++) {
      const client = new IndraClient({ databasePath: dbPath });
      await client.createThought(`Note number ${i}: Content for testing persistence`, { id: `note-${i}` });
    }
    
    // Final session: verify all notes exist
    const finalClient = new IndraClient({ databasePath: dbPath });
    const allNotes = await finalClient.listThoughts();
    
    expect(allNotes.count).toBe(noteCount);
    
    // Spot check a few
    const note0 = await finalClient.getThought("note-0");
    expect(note0.content).toContain("Note number 0");
    
    const note49 = await finalClient.getThought("note-49");
    expect(note49.content).toContain("Note number 49");
  });

  test("stress: rapid create/read cycles", async () => {
    const client = new IndraClient({ databasePath: dbPath });
    
    // Rapidly create and immediately read back
    for (let i = 0; i < 20; i++) {
      const id = `rapid-${i}`;
      await client.createThought(`Rapid test ${i}`, { id });
      const retrieved = await client.getThought(id);
      expect(retrieved.content).toBe(`Rapid test ${i}`);
    }
    
    // Verify all persisted
    const newClient = new IndraClient({ databasePath: dbPath });
    const all = await newClient.listThoughts();
    expect(all.count).toBe(20);
  });

  // ==========================================================================
  // Error Recovery
  // ==========================================================================

  test("error recovery: client works after failed operation", async () => {
    const client = new IndraClient({ databasePath: dbPath });
    
    // Successful operation
    await client.createThought("First thought", { id: "first" });
    
    // Failed operation (get nonexistent)
    try {
      await client.getThought("nonexistent");
    } catch {
      // Expected
    }
    
    // Client should still work
    await client.createThought("Second thought", { id: "second" });
    
    const all = await client.listThoughts();
    expect(all.count).toBe(2);
  });
});
