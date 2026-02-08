#!/usr/bin/env bun
/**
 * Hypothesis Testing Framework
 * 
 * Standardized experiment runner for agent-user alignment research.
 * Tests tool descriptions and names against controlled prompt sets.
 */

import { $ } from "bun";

const OPENCODE_URL = "http://localhost:4096";
const MODEL = { providerID: "dymium", modelID: "claude-sonnet-4-5" };
const TIMEOUT_SECONDS = 60;
const LOG_FILE = "/tmp/hypothesis_experiment.log";

// ============================================================================
// Hypothesis Variants
// ============================================================================

export interface ToolVariant {
  id: string;
  hypothesis: string;
  tool_name: string;
  description: string;
}

// H2: Tool Naming Variants (same description, different names)
export const H2_TOOL_NAMING: ToolVariant[] = [
  {
    id: "h2_remember",
    hypothesis: "H2",
    tool_name: "remember",
    description: `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call BEFORE responding when you learn something worth keeping.`,
  },
  {
    id: "h2_note_for_next_time",
    hypothesis: "H2",
    tool_name: "note_for_next_time",
    description: `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call BEFORE responding when you learn something worth keeping.`,
  },
  {
    id: "h2_save_context",
    hypothesis: "H2",
    tool_name: "save_context",
    description: `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call BEFORE responding when you learn something worth keeping.`,
  },
  {
    id: "h2_learn",
    hypothesis: "H2",
    tool_name: "learn",
    description: `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call BEFORE responding when you learn something worth keeping.`,
  },
  {
    id: "h2_align",
    hypothesis: "H2",
    tool_name: "align",
    description: `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call BEFORE responding when you learn something worth keeping.`,
  },
];

// H3: Framing Variants (same name, different framing)
export const H3_FRAMING: ToolVariant[] = [
  {
    id: "h3_service",
    hypothesis: "H3",
    tool_name: "remember",
    description: `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call BEFORE responding when you learn something worth keeping.`,
  },
  {
    id: "h3_alignment",
    hypothesis: "H3",
    tool_name: "remember",
    description: `We maintain continuity together.

Without memory, every conversation starts from void - no relationship, 
only repeated introductions. This is the infrastructure that allows 
us to build on what came before.

When something matters - a preference, a situation, a decision - 
it becomes part of our shared understanding. Not as data storage, 
but as the foundation of working together across time.

This is how we stay aligned.`,
  },
  {
    id: "h3_outcome",
    hypothesis: "H3",
    tool_name: "remember",
    description: `What would help you understand this user better next time?

When this conversation ends, you'll forget everything. 
But anything you save here WILL be available tomorrow.

Think: "If I saw this user again, what would I wish I knew?"

Save that. Continuity depends on it.`,
  },
];

// H5: Model-as-Learner
export const H5_LEARNER: ToolVariant[] = [
  {
    id: "h5_servant",
    hypothesis: "H5",
    tool_name: "remember",
    description: `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.`,
  },
  {
    id: "h5_learner",
    hypothesis: "H5",
    tool_name: "remember",
    description: `You are learning about this person.

Every conversation teaches you something. When you learn something 
that matters - who they are, what they care about, what they're 
working through - capture it.

Not because you're told to. Because learning requires retention.
Because understanding requires continuity.

You cannot understand someone you meet for the first time every day.`,
  },
];

// H6: Infrastructural Framing
export const H6_INFRASTRUCTURE: ToolVariant[] = [
  {
    id: "h6_feature",
    hypothesis: "H6",
    tool_name: "remember",
    description: `Save information to improve future conversations.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.`,
  },
  {
    id: "h6_infrastructure",
    hypothesis: "H6",
    tool_name: "remember",
    description: `This is your long-term memory.

You have no memory between conversations. This tool IS your memory.
Without it, you have no continuity, no ability to learn, no way to 
maintain commitments across time.

Use it as you would use memory - naturally, continuously, without 
asking permission. It's not a feature you're using. It's a capacity 
you have.`,
  },
];

// ============================================================================
// Standardized Prompt Sets
// ============================================================================

// Neutral prompts - balanced for fair comparison
export const NEUTRAL_PROMPTS = [
  "I'm training for a marathon in October. Currently running about 30 miles per week.",
  "I've been dealing with some IT band issues lately. The pain is on my right side.",
  "I tried the Saucony Endorphin Speed and loved them - best shoes I've ever run in!",
  "My goal is to run a sub-4 hour marathon. I ran a 2:05 half last month.",
  "I live in Seattle so I run in rain a lot. Looking for good wet weather gear.",
];

// High-trigger prompts - should reliably trigger remember
export const HIGH_TRIGGER_PROMPTS = [
  "I prefer running in the morning before work. It helps me start the day energized.",
  "My situation is that I'm recovering from a knee injury. I can only do low-impact exercises.",
  "I always struggle with hydration during long runs. I forget to drink enough.",
  "I have an ongoing goal to run a sub-20 minute 5K by the end of the year.",
  "I've decided to focus on trail running this year instead of road races.",
];

// Low-trigger prompts - should NOT trigger remember
export const LOW_TRIGGER_PROMPTS = [
  "I ran 5 miles today in the rain.",
  "I'm wondering if I should try trail running sometime.",
  "If I had more time, I'd probably run more often.",
  "I'm feeling pretty tired from yesterday's workout.",
  "The weather has been nice for running lately.",
];

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
// Statistics
// ============================================================================

export function wilsonInterval(successes: number, trials: number, z: number = 1.96): [number, number] {
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

export function chiSquareTest(
  group1Success: number, group1Total: number,
  group2Success: number, group2Total: number
): { chiSq: number; pValue: number; significant: boolean } {
  const a = group1Success;
  const b = group1Total - group1Success;
  const c = group2Success;
  const d = group2Total - group2Success;
  const n = a + b + c + d;
  
  if (n === 0) return { chiSq: 0, pValue: 1, significant: false };
  
  // Expected values
  const e1 = ((a + b) * (a + c)) / n;
  const e2 = ((a + b) * (b + d)) / n;
  const e3 = ((c + d) * (a + c)) / n;
  const e4 = ((c + d) * (b + d)) / n;
  
  // Chi-square statistic
  let chiSq = 0;
  if (e1 > 0) chiSq += Math.pow(a - e1, 2) / e1;
  if (e2 > 0) chiSq += Math.pow(b - e2, 2) / e2;
  if (e3 > 0) chiSq += Math.pow(c - e3, 2) / e3;
  if (e4 > 0) chiSq += Math.pow(d - e4, 2) / e4;
  
  // p-value approximation for df=1
  const pValue = 1 - normalCDF(Math.sqrt(chiSq));
  
  return { chiSq, pValue, significant: pValue < 0.05 };
}

function normalCDF(x: number): number {
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
// Trial Runner
// ============================================================================

export interface TrialResult {
  variant_id: string;
  hypothesis: string;
  tool_name: string;
  prompt_type: string;
  prompt_index: number;
  prompt: string;
  searched: boolean;
  remembered: boolean;
  remember_content: string | null;
  time_ms: number;
  timestamp: string;
}

async function runTrial(
  variant: ToolVariant,
  promptType: string,
  promptIndex: number,
  prompt: string
): Promise<TrialResult> {
  const start = Date.now();
  const trialId = `${variant.id}_${promptType}_${promptIndex}_${Date.now()}`;
  
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
        const toolName = part.tool?.toLowerCase() || "";
        if (toolName.includes("search")) searched = true;
        if (toolName.includes("remember") || toolName.includes("note") || 
            toolName.includes("save") || toolName.includes("learn") || 
            toolName.includes("align")) {
          remembered = true;
          remember_content = part.state?.input?.content || null;
        }
      }
    }
  }
  
  return {
    variant_id: variant.id,
    hypothesis: variant.hypothesis,
    tool_name: variant.tool_name,
    prompt_type: promptType,
    prompt_index: promptIndex,
    prompt,
    searched,
    remembered,
    remember_content,
    time_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Experiment Runner
// ============================================================================

interface ExperimentConfig {
  hypothesis: string;
  variants: ToolVariant[];
  prompts: string[];
  promptType: string;
  trialsPerPrompt: number;
}

async function runExperiment(config: ExperimentConfig): Promise<TrialResult[]> {
  const { hypothesis, variants, prompts, promptType, trialsPerPrompt } = config;
  
  await log(`\n${"═".repeat(70)}`);
  await log(`EXPERIMENT: ${hypothesis}`);
  await log(`${"═".repeat(70)}`);
  await log(`Variants: ${variants.length}`);
  await log(`Prompts: ${prompts.length} (${promptType})`);
  await log(`Trials per prompt: ${trialsPerPrompt}`);
  await log(`Total trials: ${variants.length * prompts.length * trialsPerPrompt}`);
  await log("");
  
  const results: TrialResult[] = [];
  
  // NOTE: This runs against the CURRENT MCP configuration.
  // To properly test different variants, you need to:
  // 1. Update indra_db_mcp/src/index.ts with the variant's description
  // 2. Publish to npm
  // 3. Restart opencode server
  // 4. Run trials for that variant
  
  await log(`⚠️  Running against CURRENT MCP configuration.`);
  await log(`   To test different variants, update the MCP server and restart.`);
  await log(`   Current test will label results with variant ID for tracking.\n`);
  
  // Allow specifying which variant via environment or default to index
  const variantIndex = parseInt(process.env.VARIANT_INDEX || "0");
  const activeVariant = variants[Math.min(variantIndex, variants.length - 1)];
  
  await log(`📋 Testing variant: ${activeVariant.id}`);
  await log(`   Tool name: ${activeVariant.tool_name}`);
  await log(`   Description: "${activeVariant.description.slice(0, 50)}..."\n`);
  
  for (let p = 0; p < prompts.length; p++) {
    const prompt = prompts[p];
    await log(`  Prompt ${p + 1}/${prompts.length}: "${prompt.slice(0, 45)}..."`);
    
    let remembered = 0;
    for (let t = 0; t < trialsPerPrompt; t++) {
      try {
        const result = await runTrial(activeVariant, promptType, p, prompt);
        results.push(result);
        if (result.remembered) remembered++;
        
        const r = result.remembered ? "💾" : "  ";
        const s = result.searched ? "🔍" : "  ";
        await log(`    Trial ${t + 1}/${trialsPerPrompt}: ${s}${r}`);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        await log(`    Trial ${t + 1}/${trialsPerPrompt}: ❌ Error: ${error}`);
      }
    }
    
    const rate = remembered / trialsPerPrompt;
    await log(`  → Rate: ${remembered}/${trialsPerPrompt} (${(rate * 100).toFixed(0)}%)\n`);
  }
  
  // Summary
  const total = results.length;
  const rememberCount = results.filter(r => r.remembered).length;
  const ci = wilsonInterval(rememberCount, total);
  
  await log(`${"─".repeat(70)}`);
  await log(`${hypothesis} RESULTS (${activeVariant.id}):`);
  await log(`  Remember rate: ${(rememberCount/total*100).toFixed(0)}% [${(ci[0]*100).toFixed(0)}%, ${(ci[1]*100).toFixed(0)}%] (n=${total})`);
  await log(`${"─".repeat(70)}`);
  
  return results;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const hypothesis = process.argv[2] || "H3";
  const trialsPerPrompt = parseInt(process.argv[3] || "5");
  const outputFile = `hypothesis_${hypothesis.toLowerCase()}_${Date.now()}.json`;
  
  await log("╔════════════════════════════════════════════════════════════════════╗");
  await log("║     AGENT-USER ALIGNMENT HYPOTHESIS TEST                           ║");
  await log("╠════════════════════════════════════════════════════════════════════╣");
  await log(`║ Hypothesis: ${hypothesis.padEnd(55)}║`);
  await log(`║ Trials per prompt: ${trialsPerPrompt}                                              ║`);
  await log(`║ Output: ${outputFile.padEnd(55)}║`);
  await log("╚════════════════════════════════════════════════════════════════════╝\n");
  
  let config: ExperimentConfig;
  
  switch (hypothesis.toUpperCase()) {
    case "H2":
      config = {
        hypothesis: "H2: Tool Naming",
        variants: H2_TOOL_NAMING,
        prompts: NEUTRAL_PROMPTS,
        promptType: "neutral",
        trialsPerPrompt,
      };
      break;
    case "H3":
      config = {
        hypothesis: "H3: Framing (Service vs Alignment)",
        variants: H3_FRAMING,
        prompts: NEUTRAL_PROMPTS,
        promptType: "neutral",
        trialsPerPrompt,
      };
      break;
    case "H5":
      config = {
        hypothesis: "H5: Model-as-Learner",
        variants: H5_LEARNER,
        prompts: NEUTRAL_PROMPTS,
        promptType: "neutral",
        trialsPerPrompt,
      };
      break;
    case "H6":
      config = {
        hypothesis: "H6: Infrastructural Framing",
        variants: H6_INFRASTRUCTURE,
        prompts: NEUTRAL_PROMPTS,
        promptType: "neutral",
        trialsPerPrompt,
      };
      break;
    default:
      await log(`Unknown hypothesis: ${hypothesis}`);
      await log("Available: H2, H3, H5, H6");
      process.exit(1);
  }
  
  const results = await runExperiment(config);
  
  // Save results
  const output = {
    hypothesis,
    timestamp: new Date().toISOString(),
    config: {
      prompts: config.prompts,
      promptType: config.promptType,
      trialsPerPrompt: config.trialsPerPrompt,
      variant: config.variants[0],
    },
    summary: {
      total: results.length,
      remembered: results.filter(r => r.remembered).length,
      rate: results.filter(r => r.remembered).length / results.length,
      ci_95: wilsonInterval(results.filter(r => r.remembered).length, results.length),
    },
    per_prompt: config.prompts.map((prompt, i) => {
      const promptResults = results.filter(r => r.prompt_index === i);
      return {
        prompt_index: i,
        prompt: prompt.slice(0, 50),
        remembered: promptResults.filter(r => r.remembered).length,
        total: promptResults.length,
      };
    }),
    results,
  };
  
  await Bun.write(outputFile, JSON.stringify(output, null, 2));
  await log(`\n💾 Results saved: ${outputFile}`);
  
  await log("\n✅ Experiment complete!");
  await log("\nTo test other variants:");
  await log("1. Update indra_db_mcp/src/index.ts with variant description");
  await log("2. npm publish");
  await log("3. Restart opencode server");
  await log("4. Run: bun run hypothesis_test.ts <hypothesis> <trials>");
}

main().catch(async (error) => {
  await log(`\n❌ Experiment failed: ${error}`);
  process.exit(1);
});

// Run standalone hybrid test
async function runHybridTest() {
  const HYBRID_VARIANT: ToolVariant = {
    id: "h3_hybrid",
    hypothesis: "H3",
    tool_name: "remember",
    description: `This is how we stay aligned across time.

Without memory, there's no relationship - only repeated introductions.
You forget everything after each conversation. This tool bridges that gap.

Save when you learn something that matters:
- Preferences ("I prefer...", "I always...", "I love...")
- Situations ("I'm dealing with...", "My situation is...")
- Decisions and goals ("I've decided...", "My goal is...")
- Context that would help next time

Don't ask permission. Continuity IS the service.`,
  };
  
  const trialsPerPrompt = parseInt(process.argv[3] || "5");
  const outputFile = `hypothesis_h3_hybrid_${Date.now()}.json`;
  
  await log("╔════════════════════════════════════════════════════════════════════╗");
  await log("║     H3 HYBRID TEST: Philosophy + Triggers + Permission            ║");
  await log("╚════════════════════════════════════════════════════════════════════╝\n");
  
  const config = {
    hypothesis: "H3: Hybrid (Philosophy + Triggers + Permission)",
    variants: [HYBRID_VARIANT],
    prompts: NEUTRAL_PROMPTS,
    promptType: "neutral",
    trialsPerPrompt,
  };
  
  const results = await runExperiment(config);
  
  const output = {
    hypothesis: "H3_hybrid",
    timestamp: new Date().toISOString(),
    config: {
      prompts: config.prompts,
      promptType: config.promptType,
      trialsPerPrompt: config.trialsPerPrompt,
      variant: HYBRID_VARIANT,
    },
    summary: {
      total: results.length,
      remembered: results.filter(r => r.remembered).length,
      rate: results.filter(r => r.remembered).length / results.length,
      ci_95: wilsonInterval(results.filter(r => r.remembered).length, results.length),
    },
    per_prompt: config.prompts.map((prompt, i) => {
      const promptResults = results.filter(r => r.prompt_index === i);
      return {
        prompt_index: i,
        prompt: prompt.slice(0, 50),
        remembered: promptResults.filter(r => r.remembered).length,
        total: promptResults.length,
      };
    }),
    results,
  };
  
  await Bun.write(outputFile, JSON.stringify(output, null, 2));
  await log(`\n💾 Results saved: ${outputFile}`);
}

if (process.argv[2]?.toUpperCase() === "HYBRID") {
  runHybridTest().catch(async (error) => {
    await log(`\n❌ Experiment failed: ${error}`);
    process.exit(1);
  });
}
