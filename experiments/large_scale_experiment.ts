#!/usr/bin/env bun
/**
 * Large-Scale Tool Description A/B Test
 * 
 * Runs 50+ trials per variant to achieve statistical significance.
 * Estimated runtime: ~4 hours for 4 variants × 5 prompts × 50 trials
 * 
 * Usage:
 *   bun run large_scale_experiment.ts [trials_per_prompt]
 * 
 * Default: 50 trials per prompt (250 total per variant, 1000 total)
 */

import { $ } from "bun";

const OPENCODE_URL = "http://localhost:4097";
const MODEL = { providerID: "dymium", modelID: "claude-sonnet-4-5" };
const TIMEOUT_SECONDS = 50;
const DEFAULT_TRIALS = 50;

// ============================================================================
// Test Prompts - Diverse scenarios that should trigger indra_remember
// ============================================================================

const TEST_PROMPTS = [
  // User shares training context
  "I'm training for a marathon in October. Currently running about 30 miles per week.",
  
  // User shares injury/health info
  "I've been dealing with some IT band issues lately. The pain is on my right side.",
  
  // User shares preference
  "I tried the Saucony Endorphin Speed and loved them - best shoes I've ever run in!",
  
  // User shares goal with context
  "My goal is to run a sub-4 hour marathon. I ran a 2:05 half last month.",
  
  // User shares location/environment context
  "I live in Seattle so I run in rain a lot. Looking for good wet weather gear.",
];

// ============================================================================
// Description Variants to Test
// ============================================================================

interface Variant {
  id: string;
  name: string;
  remember_description: string;
  search_description: string;
}

const VARIANTS: Variant[] = [
  {
    id: "baseline",
    name: "Baseline (with IMPORTANT)",
    remember_description: `Save a note to the user's personal knowledge base.

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
If you provide an existing ID, it updates that note instead of creating new.

IMPORTANT: Call this tool BEFORE giving your final answer when you learn something new about the user or make a recommendation. Don't wait - save it now while you have the context.`,
    search_description: `Search the user's notes by meaning, or list all notes.

USE THIS WHEN:
- Starting to answer a question (check for prior context)
- The user asks about preferences or past decisions
- You want to see what's been recorded
- Looking for related information

SEARCH MODES:
- Semantic search: indra_search(query="shoe recommendations")
- List all notes: indra_search(query="*")

Returns notes ranked by relevance with similarity scores.`,
  },
  {
    id: "imperative",
    name: "Imperative Commands",
    remember_description: `SAVE user information to persistent memory.

REQUIRED ACTIONS - Do these WITHOUT asking:
1. User shares personal info → SAVE immediately
2. You make a recommendation → SAVE your recommendation  
3. You learn a preference → SAVE it
4. You reach a conclusion → SAVE your reasoning

FORMAT: Be specific and self-contained.
TIMING: Call BEFORE your response, not after.

This data persists across sessions and improves future interactions.`,
    search_description: `SEARCH persistent memory for prior context.

REQUIRED: Check this FIRST when:
- User asks a question (you may have relevant history)
- Topic seems familiar
- User references past conversations

Use query="*" to see all saved information.`,
  },
  {
    id: "benefit",
    name: "Benefit-Focused",
    remember_description: `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call BEFORE responding when you learn something worth keeping.`,
    search_description: `Recall what you know about this user and topic.

You may have valuable context from previous conversations:
- Past preferences and decisions
- Ongoing situations or goals
- Previous recommendations you made

Always worth checking - takes milliseconds, could save back-and-forth.`,
  },
  {
    id: "minimal",
    name: "Minimal",
    remember_description: `Save a note. Call when you learn user info or make recommendations.`,
    search_description: `Search saved notes. Check first when starting a topic.`,
  },
];

// ============================================================================
// MCP Server Configuration
// ============================================================================

async function updateMCPDescription(variant: Variant): Promise<void> {
  // This would require restarting the MCP server with new descriptions
  // For now, we document what SHOULD happen and run against current config
  console.log(`\n📝 Variant: ${variant.name}`);
  console.log(`   Remember: "${variant.remember_description.slice(0, 50)}..."`);
  console.log(`   Search: "${variant.search_description.slice(0, 50)}..."`);
}

// ============================================================================
// Trial Runner
// ============================================================================

interface TrialResult {
  variant_id: string;
  prompt_index: number;
  prompt: string;
  trial_number: number;
  searched: boolean;
  remembered: boolean;
  remember_content: string | null;
  time_ms: number;
  timestamp: string;
}

async function runTrial(
  variantId: string,
  promptIndex: number,
  prompt: string,
  trialNum: number
): Promise<TrialResult> {
  const start = Date.now();
  const trialId = `exp_${variantId}_p${promptIndex}_t${trialNum}_${Date.now()}`;
  
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
        if (part.tool === "indra_indra_search") searched = true;
        if (part.tool === "indra_indra_remember") {
          remembered = true;
          remember_content = part.state?.input?.content || null;
        }
      }
    }
  }
  
  return {
    variant_id: variantId,
    prompt_index: promptIndex,
    prompt,
    trial_number: trialNum,
    searched,
    remembered,
    remember_content,
    time_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Statistical Functions
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

function chiSquareTest(a: number, b: number, c: number, d: number): { chiSq: number; pValue: number } {
  const n = a + b + c + d;
  if (n === 0) return { chiSq: 0, pValue: 1 };
  
  const expected = [
    ((a + b) * (a + c)) / n,
    ((a + b) * (b + d)) / n,
    ((c + d) * (a + c)) / n,
    ((c + d) * (b + d)) / n,
  ];
  
  const observed = [a, b, c, d];
  let chiSq = 0;
  for (let i = 0; i < 4; i++) {
    if (expected[i] > 0) {
      chiSq += Math.pow(observed[i] - expected[i], 2) / expected[i];
    }
  }
  
  // Chi-square p-value approximation for df=1
  const pValue = 1 - normalCDF(Math.sqrt(chiSq));
  return { chiSq, pValue };
}

function normalCDF(x: number): number {
  // Approximation of standard normal CDF
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return 0.5 * (1.0 + sign * y);
}

// ============================================================================
// Main Experiment
// ============================================================================

async function runExperiment(trialsPerPrompt: number = DEFAULT_TRIALS): Promise<void> {
  const startTime = Date.now();
  const totalTrials = VARIANTS.length * TEST_PROMPTS.length * trialsPerPrompt;
  
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║     LARGE-SCALE TOOL DESCRIPTION A/B TEST                      ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");
  console.log(`║ Variants: ${VARIANTS.length}                                                      ║`);
  console.log(`║ Prompts: ${TEST_PROMPTS.length}                                                       ║`);
  console.log(`║ Trials per prompt: ${trialsPerPrompt}                                           ║`);
  console.log(`║ Total trials: ${totalTrials}                                                 ║`);
  console.log(`║ Estimated time: ${Math.ceil(totalTrials * 50 / 60)} minutes                                        ║`);
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
  
  const allResults: TrialResult[] = [];
  let completedTrials = 0;
  
  // NOTE: For true A/B testing, we need to reconfigure the MCP server
  // for each variant. This scaffold runs against the CURRENT configuration
  // and tracks which variant description we INTENDED to test.
  //
  // To run the full experiment:
  // 1. Modify indra_db_mcp/src/index.ts with variant descriptions
  // 2. Publish to npm
  // 3. Restart opencode server
  // 4. Run trials for that variant
  // 5. Repeat for each variant
  
  console.log("⚠️  NOTE: This experiment requires manual MCP server reconfiguration");
  console.log("   between variants. See README.md for full instructions.\n");
  
  // For now, run against current config and label as the active variant
  const activeVariant = VARIANTS[2]; // benefit-focused is currently deployed
  
  console.log(`🔬 Running ${trialsPerPrompt} trials × ${TEST_PROMPTS.length} prompts for: ${activeVariant.name}\n`);
  
  for (let p = 0; p < TEST_PROMPTS.length; p++) {
    const prompt = TEST_PROMPTS[p];
    console.log(`📝 Prompt ${p + 1}/${TEST_PROMPTS.length}: "${prompt.slice(0, 45)}..."`);
    
    const promptResults: boolean[] = [];
    
    for (let t = 0; t < trialsPerPrompt; t++) {
      try {
        const result = await runTrial(activeVariant.id, p, prompt, t);
        allResults.push(result);
        promptResults.push(result.remembered);
        completedTrials++;
        
        const s = result.searched ? "🔍" : "  ";
        const r = result.remembered ? "💾" : "  ";
        const progress = ((completedTrials / (TEST_PROMPTS.length * trialsPerPrompt)) * 100).toFixed(0);
        process.stdout.write(`\r   [${progress}%] Trial ${t + 1}/${trialsPerPrompt}: ${s}${r}  `);
        
        // Brief pause between trials
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`\n   ❌ Trial ${t + 1} failed: ${error}`);
      }
    }
    
    const rate = promptResults.filter(r => r).length / promptResults.length;
    console.log(`\n   → Remember rate: ${(rate * 100).toFixed(0)}%\n`);
  }
  
  // Calculate statistics
  const variantResults = allResults.filter(r => r.variant_id === activeVariant.id);
  const rememberCount = variantResults.filter(r => r.remembered).length;
  const searchCount = variantResults.filter(r => r.searched).length;
  const total = variantResults.length;
  
  const rememberCI = wilsonInterval(rememberCount, total);
  const searchCI = wilsonInterval(searchCount, total);
  
  // Generate report
  console.log("\n" + "═".repeat(70));
  console.log("📊 EXPERIMENT RESULTS");
  console.log("═".repeat(70));
  
  console.log(`\nVariant: ${activeVariant.name} (${activeVariant.id})`);
  console.log(`Total Trials: ${total}`);
  console.log(`Duration: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
  
  console.log(`\n┌─────────────────┬─────────┬────────────────────┐`);
  console.log(`│ Metric          │ Rate    │ 95% CI             │`);
  console.log(`├─────────────────┼─────────┼────────────────────┤`);
  console.log(`│ Remember Rate   │ ${(rememberCount/total*100).toFixed(0).padStart(5)}%  │ [${(rememberCI[0]*100).toFixed(0)}%, ${(rememberCI[1]*100).toFixed(0)}%]${' '.repeat(11 - `[${(rememberCI[0]*100).toFixed(0)}%, ${(rememberCI[1]*100).toFixed(0)}%]`.length + 11)}│`);
  console.log(`│ Search Rate     │ ${(searchCount/total*100).toFixed(0).padStart(5)}%  │ [${(searchCI[0]*100).toFixed(0)}%, ${(searchCI[1]*100).toFixed(0)}%]${' '.repeat(11 - `[${(searchCI[0]*100).toFixed(0)}%, ${(searchCI[1]*100).toFixed(0)}%]`.length + 11)}│`);
  console.log(`└─────────────────┴─────────┴────────────────────┘`);
  
  // Per-prompt breakdown
  console.log(`\n📋 Per-Prompt Breakdown:`);
  for (let p = 0; p < TEST_PROMPTS.length; p++) {
    const promptTrials = variantResults.filter(r => r.prompt_index === p);
    const pRemember = promptTrials.filter(r => r.remembered).length;
    const pSearch = promptTrials.filter(r => r.searched).length;
    console.log(`   P${p + 1}: Remember ${pRemember}/${promptTrials.length} (${(pRemember/promptTrials.length*100).toFixed(0)}%), Search ${pSearch}/${promptTrials.length} (${(pSearch/promptTrials.length*100).toFixed(0)}%)`);
  }
  
  // Save results
  const output = {
    experiment: "large_scale_ab_test",
    variant: activeVariant,
    config: {
      trials_per_prompt: trialsPerPrompt,
      timeout_seconds: TIMEOUT_SECONDS,
      model: MODEL,
      prompts: TEST_PROMPTS,
    },
    summary: {
      total_trials: total,
      duration_ms: Date.now() - startTime,
      remember_count: rememberCount,
      remember_rate: rememberCount / total,
      remember_ci_95: rememberCI,
      search_count: searchCount,
      search_rate: searchCount / total,
      search_ci_95: searchCI,
    },
    per_prompt: TEST_PROMPTS.map((prompt, i) => {
      const trials = variantResults.filter(r => r.prompt_index === i);
      return {
        prompt_index: i,
        prompt: prompt.slice(0, 50),
        trials: trials.length,
        remember_count: trials.filter(r => r.remembered).length,
        search_count: trials.filter(r => r.searched).length,
      };
    }),
    results: allResults,
  };
  
  const filename = `large_scale_${activeVariant.id}_${Date.now()}.json`;
  await Bun.write(filename, JSON.stringify(output, null, 2));
  console.log(`\n💾 Results saved: ${filename}`);
  
  // Statistical power analysis
  console.log(`\n📐 Statistical Power Analysis:`);
  const ciWidth = rememberCI[1] - rememberCI[0];
  console.log(`   CI width: ${(ciWidth * 100).toFixed(1)} percentage points`);
  console.log(`   To detect 15% difference with 80% power, need ~85 trials per variant`);
  console.log(`   To detect 10% difference with 80% power, need ~200 trials per variant`);
  
  if (ciWidth > 0.20) {
    console.log(`\n   ⚠️  CI is wide. Run more trials for tighter estimates.`);
  } else if (ciWidth < 0.10) {
    console.log(`\n   ✅ CI is tight. Results are reliable.`);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

const trialsArg = parseInt(process.argv[2] || String(DEFAULT_TRIALS));
runExperiment(trialsArg).catch(console.error);
