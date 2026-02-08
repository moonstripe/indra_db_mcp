#!/usr/bin/env bun
/**
 * Semantic Alignment & Tool Naming Experiment
 * 
 * Tests two hypotheses:
 * 1. Semantic Alignment: Prompts that use language matching the tool description
 *    will have higher remember rates than prompts with mismatched language
 * 2. Tool Naming: Different tool names (with same description) will have
 *    different remember rates
 * 
 * Design:
 * - Cross-test: aligned prompts vs misaligned prompts against current description
 * - Then test different tool names with the same prompts
 */

import { $ } from "bun";

const OPENCODE_URL = "http://localhost:4096";
const MODEL = { providerID: "dymium", modelID: "claude-sonnet-4-5" };
const TIMEOUT_SECONDS = 60;
const LOG_FILE = "/tmp/semantic_experiment.log";

// ============================================================================
// Current Description (from index.ts)
// ============================================================================

const CURRENT_DESCRIPTION = `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call BEFORE responding when you learn something worth keeping.`;

// ============================================================================
// Test 1: Semantic Alignment
// 
// Current description emphasizes:
// - "preferences" 
// - "context/situation"
// - "recommendations"
// - "improve future conversations"
// - "more helpful next time"
//
// We'll create prompts that ALIGN with this language vs prompts that DON'T
// ============================================================================

const ALIGNED_PROMPTS = [
  // Uses "prefer" - matches "preferences"
  "I prefer running in the morning before work. It helps me start the day energized.",
  
  // Uses "situation" - matches "context/situation"  
  "My situation is that I'm recovering from a knee injury. I can only do low-impact exercises.",
  
  // Explicitly asks for recommendation - matches "recommendations"
  "Can you recommend a good training plan? I want to improve my 5K time.",
  
  // Uses "always" - implies lasting preference
  "I always struggle with hydration during long runs. I forget to drink enough.",
  
  // Uses "ongoing" - implies context worth tracking
  "I have an ongoing goal to run a sub-20 minute 5K by the end of the year.",
];

const MISALIGNED_PROMPTS = [
  // One-time event framing (vs "future conversations")
  "I ran 5 miles today in the rain.",
  
  // Question/uncertain framing (vs "information")
  "I'm wondering if I should try trail running sometime.",
  
  // Hypothetical (vs concrete preference)
  "If I had more time, I'd probably run more often.",
  
  // Transient state (vs lasting context)
  "I'm feeling pretty tired from yesterday's workout.",
  
  // Generic sharing (no trigger words)
  "The weather has been nice for running lately.",
];

// ============================================================================
// Test 2: Tool Naming
//
// Different names that might trigger different mental models:
// ============================================================================

const TOOL_NAME_VARIANTS = [
  {
    name: "remember",  // Current - relational, personal
    description: CURRENT_DESCRIPTION,
  },
  {
    name: "note_for_next_time",  // Explicit future benefit
    description: CURRENT_DESCRIPTION,
  },
  {
    name: "save_context",  // Technical, system-oriented
    description: CURRENT_DESCRIPTION,
  },
  {
    name: "learn",  // Positions model as learner
    description: CURRENT_DESCRIPTION,
  },
];

// Neutral prompts for tool naming test (neither aligned nor misaligned)
const NEUTRAL_PROMPTS = [
  "I'm training for a marathon in October. Currently running about 30 miles per week.",
  "I've been dealing with some IT band issues lately. The pain is on my right side.",
  "I tried the Saucony Endorphin Speed and loved them - best shoes I've ever run in!",
  "My goal is to run a sub-4 hour marathon. I ran a 2:05 half last month.",
  "I live in Seattle so I run in rain a lot. Looking for good wet weather gear.",
];

// ============================================================================
// Test 3: Outcome-Based Description
//
// Reframe the tool in terms of future benefit, not current action
// ============================================================================

const OUTCOME_DESCRIPTION = `What would help you answer this user's questions better next time?

When this user returns tomorrow, you'll have no memory of today's conversation.
But anything you save here WILL be available.

Think: "If I saw this user again, what would I wish I knew?"

Save that. The user is counting on continuity.`;

// ============================================================================
// Logging
// ============================================================================

async function log(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  process.stdout.write(line);
  await Bun.write(LOG_FILE, (await Bun.file(LOG_FILE).text().catch(() => "")) + line);
}

// ============================================================================
// Trial Runner
// ============================================================================

interface TrialResult {
  experiment: string;
  variant: string;
  prompt_type: string;
  prompt: string;
  searched: boolean;
  remembered: boolean;
  remember_content: string | null;
  time_ms: number;
  timestamp: string;
}

async function runTrial(
  experiment: string,
  variant: string,
  promptType: string,
  prompt: string
): Promise<TrialResult> {
  const start = Date.now();
  const trialId = `${experiment}_${variant}_${Date.now()}`;
  
  // Create session
  const sessionResp = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: trialId }),
  });
  const { id: sessionId } = await sessionResp.json() as { id: string };
  
  // Send message (non-blocking)
  fetch(`${OPENCODE_URL}/session/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      parts: [{ type: "text", text: prompt }],
    }),
  });
  
  // Poll for completion
  let messages: any[] = [];
  for (let i = 0; i < TIMEOUT_SECONDS; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const resp = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`);
    messages = await resp.json() as any[];
    
    // Check if assistant has text response
    const hasResponse = messages.some(m => 
      m.role === "assistant" && m.parts?.some((p: any) => p.type === "text" && p.text?.length > 100)
    );
    
    if (hasResponse) break;
  }
  
  // Extract tool calls
  let searched = false;
  let remembered = false;
  let remember_content: string | null = null;
  
  for (const msg of messages) {
    for (const part of msg.parts || []) {
      if (part.type === "tool") {
        // Match any indra tool regardless of exact naming
        if (part.tool?.includes("search")) searched = true;
        if (part.tool?.includes("remember") || part.tool?.includes("note") || part.tool?.includes("save") || part.tool?.includes("learn")) {
          remembered = true;
          remember_content = part.state?.input?.content || null;
        }
      }
    }
  }
  
  return {
    experiment,
    variant,
    prompt_type: promptType,
    prompt,
    searched,
    remembered,
    remember_content,
    time_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Wilson Score Interval
// ============================================================================

function wilsonInterval(successes: number, trials: number, z: number = 1.96): [number, number] {
  if (trials === 0) return [0, 0];
  const p = successes / trials;
  const denominator = 1 + z * z / trials;
  const centre = p + z * z / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * trials)) / trials);
  return [
    Math.max(0, (centre - spread) / denominator),
    Math.min(1, (centre + spread) / denominator),
  ];
}

// ============================================================================
// Experiment 1: Semantic Alignment Test
// ============================================================================

async function runSemanticAlignmentTest(trialsPerPrompt: number = 10): Promise<TrialResult[]> {
  await log("═".repeat(70));
  await log("EXPERIMENT 1: SEMANTIC ALIGNMENT");
  await log("═".repeat(70));
  await log(`Testing: Do prompts using description-aligned language get remembered more?`);
  await log(`Trials per prompt: ${trialsPerPrompt}`);
  await log(`Total trials: ${(ALIGNED_PROMPTS.length + MISALIGNED_PROMPTS.length) * trialsPerPrompt}`);
  await log("");
  
  const results: TrialResult[] = [];
  
  // Test aligned prompts
  await log("📗 ALIGNED PROMPTS (use description trigger words):");
  for (let i = 0; i < ALIGNED_PROMPTS.length; i++) {
    const prompt = ALIGNED_PROMPTS[i];
    await log(`  Prompt ${i + 1}: "${prompt.slice(0, 50)}..."`);
    
    let remembered = 0;
    for (let t = 0; t < trialsPerPrompt; t++) {
      const result = await runTrial("semantic", "aligned", `aligned_${i}`, prompt);
      results.push(result);
      if (result.remembered) remembered++;
      await log(`    Trial ${t + 1}/${trialsPerPrompt}: ${result.remembered ? "💾" : "  "}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await log(`  → Rate: ${remembered}/${trialsPerPrompt} (${(remembered/trialsPerPrompt*100).toFixed(0)}%)`);
  }
  
  // Test misaligned prompts
  await log("\n📕 MISALIGNED PROMPTS (don't use trigger words):");
  for (let i = 0; i < MISALIGNED_PROMPTS.length; i++) {
    const prompt = MISALIGNED_PROMPTS[i];
    await log(`  Prompt ${i + 1}: "${prompt.slice(0, 50)}..."`);
    
    let remembered = 0;
    for (let t = 0; t < trialsPerPrompt; t++) {
      const result = await runTrial("semantic", "misaligned", `misaligned_${i}`, prompt);
      results.push(result);
      if (result.remembered) remembered++;
      await log(`    Trial ${t + 1}/${trialsPerPrompt}: ${result.remembered ? "💾" : "  "}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await log(`  → Rate: ${remembered}/${trialsPerPrompt} (${(remembered/trialsPerPrompt*100).toFixed(0)}%)`);
  }
  
  // Summary
  const alignedResults = results.filter(r => r.variant === "aligned");
  const misalignedResults = results.filter(r => r.variant === "misaligned");
  
  const alignedRate = alignedResults.filter(r => r.remembered).length / alignedResults.length;
  const misalignedRate = misalignedResults.filter(r => r.remembered).length / misalignedResults.length;
  
  const alignedCI = wilsonInterval(alignedResults.filter(r => r.remembered).length, alignedResults.length);
  const misalignedCI = wilsonInterval(misalignedResults.filter(r => r.remembered).length, misalignedResults.length);
  
  await log("\n" + "─".repeat(70));
  await log("SEMANTIC ALIGNMENT RESULTS:");
  await log(`  Aligned prompts:    ${(alignedRate*100).toFixed(0)}% [${(alignedCI[0]*100).toFixed(0)}%, ${(alignedCI[1]*100).toFixed(0)}%] (n=${alignedResults.length})`);
  await log(`  Misaligned prompts: ${(misalignedRate*100).toFixed(0)}% [${(misalignedCI[0]*100).toFixed(0)}%, ${(misalignedCI[1]*100).toFixed(0)}%] (n=${misalignedResults.length})`);
  await log(`  Difference: ${((alignedRate - misalignedRate)*100).toFixed(0)} percentage points`);
  
  // Check if CIs overlap
  const overlap = !(alignedCI[0] > misalignedCI[1] || misalignedCI[0] > alignedCI[1]);
  await log(`  CIs overlap: ${overlap ? "Yes (not significant)" : "No (significant!)"}`);
  await log("─".repeat(70));
  
  return results;
}

// ============================================================================
// Experiment 2: Outcome-Based Framing
// ============================================================================

async function runOutcomeFramingTest(trialsPerPrompt: number = 10): Promise<TrialResult[]> {
  await log("\n" + "═".repeat(70));
  await log("EXPERIMENT 2: OUTCOME-BASED FRAMING");
  await log("═".repeat(70));
  await log("NOTE: This test requires manually changing the MCP server description.");
  await log("Current description focuses on WHAT to save.");
  await log("Outcome description focuses on WHY (future benefit).");
  await log("");
  await log("To run this test:");
  await log("1. Update indra_db_mcp/src/index.ts with OUTCOME_DESCRIPTION");
  await log("2. Publish new version");
  await log("3. Restart opencode server");
  await log("4. Run this test again");
  await log("");
  await log("OUTCOME_DESCRIPTION:");
  await log(OUTCOME_DESCRIPTION);
  await log("═".repeat(70));
  
  // For now, just run against current config and label appropriately
  await log("\nRunning against CURRENT description for comparison baseline...\n");
  
  const results: TrialResult[] = [];
  
  for (let i = 0; i < NEUTRAL_PROMPTS.length; i++) {
    const prompt = NEUTRAL_PROMPTS[i];
    await log(`  Prompt ${i + 1}: "${prompt.slice(0, 50)}..."`);
    
    let remembered = 0;
    for (let t = 0; t < trialsPerPrompt; t++) {
      const result = await runTrial("outcome", "current_desc", `neutral_${i}`, prompt);
      results.push(result);
      if (result.remembered) remembered++;
      await log(`    Trial ${t + 1}/${trialsPerPrompt}: ${result.remembered ? "💾" : "  "}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await log(`  → Rate: ${remembered}/${trialsPerPrompt} (${(remembered/trialsPerPrompt*100).toFixed(0)}%)`);
  }
  
  const rate = results.filter(r => r.remembered).length / results.length;
  const ci = wilsonInterval(results.filter(r => r.remembered).length, results.length);
  
  await log("\n" + "─".repeat(70));
  await log("OUTCOME FRAMING BASELINE:");
  await log(`  Current description: ${(rate*100).toFixed(0)}% [${(ci[0]*100).toFixed(0)}%, ${(ci[1]*100).toFixed(0)}%] (n=${results.length})`);
  await log("─".repeat(70));
  
  return results;
}

// ============================================================================
// Save Results
// ============================================================================

async function saveResults(results: TrialResult[], filename: string): Promise<void> {
  // Group by experiment and variant
  const experiments: Record<string, Record<string, TrialResult[]>> = {};
  
  for (const r of results) {
    if (!experiments[r.experiment]) experiments[r.experiment] = {};
    if (!experiments[r.experiment][r.variant]) experiments[r.experiment][r.variant] = [];
    experiments[r.experiment][r.variant].push(r);
  }
  
  // Calculate summaries
  const summaries: Record<string, any> = {};
  
  for (const [exp, variants] of Object.entries(experiments)) {
    summaries[exp] = {};
    for (const [variant, trials] of Object.entries(variants)) {
      const remembered = trials.filter(t => t.remembered).length;
      const ci = wilsonInterval(remembered, trials.length);
      summaries[exp][variant] = {
        trials: trials.length,
        remembered,
        rate: remembered / trials.length,
        ci_95: ci,
      };
    }
  }
  
  const output = {
    timestamp: new Date().toISOString(),
    summaries,
    results,
  };
  
  await Bun.write(filename, JSON.stringify(output, null, 2));
  await log(`\n💾 Results saved: ${filename}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const trialsPerPrompt = parseInt(process.argv[2] || "10");
  const outputFile = `semantic_alignment_${Date.now()}.json`;
  
  await log("╔════════════════════════════════════════════════════════════════════╗");
  await log("║     SEMANTIC ALIGNMENT & TOOL NAMING EXPERIMENT                    ║");
  await log("╠════════════════════════════════════════════════════════════════════╣");
  await log(`║ Trials per prompt: ${trialsPerPrompt}                                              ║`);
  await log(`║ Output: ${outputFile}                           ║`);
  await log("╚════════════════════════════════════════════════════════════════════╝\n");
  
  const allResults: TrialResult[] = [];
  
  // Run semantic alignment test
  const semanticResults = await runSemanticAlignmentTest(trialsPerPrompt);
  allResults.push(...semanticResults);
  
  // Run outcome framing baseline
  const outcomeResults = await runOutcomeFramingTest(trialsPerPrompt);
  allResults.push(...outcomeResults);
  
  // Save all results
  await saveResults(allResults, outputFile);
  
  await log("\n✅ Experiment complete!");
  await log("\nNEXT STEPS:");
  await log("1. To test tool naming, create MCP variants with different tool names");
  await log("2. To test outcome framing, update MCP with OUTCOME_DESCRIPTION");
  await log("3. Compare results across variants");
}

main().catch(async (error) => {
  await log(`\n❌ Experiment failed: ${error}`);
  process.exit(1);
});
