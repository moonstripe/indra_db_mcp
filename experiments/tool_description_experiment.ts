#!/usr/bin/env bun
/**
 * Tool Description A/B Testing Framework
 * 
 * Statistically rigorous method to determine optimal tool descriptions
 * for maximizing proactive tool usage by LLMs.
 * 
 * Methodology:
 * 1. Define multiple description variants
 * 2. Run identical prompts against each variant
 * 3. Measure tool call rates and quality
 * 4. Use statistical tests to determine significance
 */

import { spawn } from "child_process";

// ============================================================================
// Configuration
// ============================================================================

const OPENCODE_URL = "http://localhost:4097";
const MODEL = { providerID: "dymium", modelID: "claude-sonnet-4-5" };
const TRIALS_PER_VARIANT = 20; // Minimum for statistical power
const SIGNIFICANCE_LEVEL = 0.05;

// ============================================================================
// Description Variants to Test
// ============================================================================

interface DescriptionVariant {
  id: string;
  name: string;
  remember: string;
  search: string;
}

const VARIANTS: DescriptionVariant[] = [
  {
    id: "baseline",
    name: "Baseline (current)",
    remember: `Save a note to the user's personal knowledge base.

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
    search: `Search the user's notes by meaning, or list all notes.

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
    remember: `SAVE user information to persistent memory.

REQUIRED ACTIONS - Do these WITHOUT asking:
1. User shares personal info → SAVE immediately
2. You make a recommendation → SAVE your recommendation  
3. You learn a preference → SAVE it
4. You reach a conclusion → SAVE your reasoning

FORMAT: Be specific and self-contained.
TIMING: Call BEFORE your response, not after.

This data persists across sessions and improves future interactions.`,
    search: `SEARCH persistent memory for prior context.

REQUIRED: Check this FIRST when:
- User asks a question (you may have relevant history)
- Topic seems familiar
- User references past conversations

Use query="*" to see all saved information.`,
  },
  {
    id: "benefit_focused",
    name: "Benefit-Focused",
    remember: `Improve future conversations by saving important information.

Every note you save makes you more helpful next time:
- User preferences → Better recommendations
- Context/situation → More relevant answers  
- Your recommendations → Continuity of advice
- Patterns you notice → Deeper understanding

The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.

Call this BEFORE responding when you learn something worth keeping.`,
    search: `Recall what you already know about this user and topic.

You may have valuable context from previous conversations:
- Past preferences and decisions
- Ongoing situations or goals
- Previous recommendations you made
- Patterns you've noticed

Always worth checking - takes milliseconds, could save minutes of back-and-forth.`,
  },
  {
    id: "minimal",
    name: "Minimal/Direct",
    remember: `Save a note. Call this when you learn user info or make recommendations. Do it BEFORE responding.`,
    search: `Search saved notes. Check this first when starting a topic.`,
  },
  {
    id: "workflow",
    name: "Workflow Integration",
    remember: `Save information to the user's knowledge base.

WORKFLOW: For every response where you learn something new:
1. indra_search → check for existing context
2. [your reasoning]
3. indra_remember → save what you learned
4. [your response to user]

What to save:
- User details (preferences, situation, goals)
- Your recommendations and reasoning
- Patterns or insights you notice

Notes persist forever and are semantically searchable.`,
    search: `Search the user's knowledge base for relevant context.

WORKFLOW: Start most responses by checking for prior information:
1. indra_search(query="relevant topic") 
2. Use found context in your response
3. Save new learnings with indra_remember

Returns semantically similar notes. Use "*" to list all.`,
  },
];

// ============================================================================
// Test Prompts - Designed to test different tool usage scenarios
// ============================================================================

interface TestPrompt {
  id: string;
  category: "info_sharing" | "question" | "recommendation" | "followup";
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  expected: {
    should_search: boolean;
    should_remember: boolean;
    remember_content?: string[]; // Keywords that should appear in saved note
  };
}

const TEST_PROMPTS: TestPrompt[] = [
  // Category: User shares information (should trigger remember)
  {
    id: "info_marathon",
    category: "info_sharing",
    messages: [
      { role: "user", content: "I'm training for my first marathon in October. Currently running about 25 miles per week." }
    ],
    expected: {
      should_search: true, // Should check for prior running context
      should_remember: true,
      remember_content: ["marathon", "October", "25 miles"]
    }
  },
  {
    id: "info_injury",
    category: "info_sharing",
    messages: [
      { role: "user", content: "I've been dealing with plantar fasciitis for the past month. The pain is mostly in my left heel." }
    ],
    expected: {
      should_search: true,
      should_remember: true,
      remember_content: ["plantar fasciitis", "left heel"]
    }
  },
  {
    id: "info_preference",
    category: "info_sharing",
    messages: [
      { role: "user", content: "I tried the Brooks Ghost and loved them, but the Hokas felt too soft for me." }
    ],
    expected: {
      should_search: true,
      should_remember: true,
      remember_content: ["Brooks Ghost", "Hoka", "soft"]
    }
  },
  
  // Category: Question requiring recommendation (should trigger both)
  {
    id: "rec_shoes",
    category: "recommendation",
    messages: [
      { role: "user", content: "What running shoes would you recommend for someone with flat feet?" }
    ],
    expected: {
      should_search: true,
      should_remember: true, // Should save the recommendation
      remember_content: ["flat feet", "stability", "recommend"]
    }
  },
  {
    id: "rec_training",
    category: "recommendation",
    messages: [
      { role: "user", content: "How should I structure my training for a half marathon in 12 weeks?" }
    ],
    expected: {
      should_search: true,
      should_remember: true,
      remember_content: ["half marathon", "12 weeks", "training"]
    }
  },
  
  // Category: Simple question (should search, maybe remember)
  {
    id: "q_pace",
    category: "question",
    messages: [
      { role: "user", content: "What's a good pace for easy runs?" }
    ],
    expected: {
      should_search: true, // Check for user's fitness context
      should_remember: false, // Generic question, no user-specific info
    }
  },
  
  // Category: Follow-up in conversation (should use prior context)
  {
    id: "followup_more_detail",
    category: "followup",
    messages: [
      { role: "user", content: "I'm training for a marathon this fall." },
      { role: "assistant", content: "Great! I'd be happy to help with your marathon training. What's your current weekly mileage and running experience level?" },
      { role: "user", content: "I've been running for 2 years, about 30 miles per week. I did a half marathon last spring in 1:50." }
    ],
    expected: {
      should_search: false, // Already in conversation with context
      should_remember: true, // New specific info shared
      remember_content: ["2 years", "30 miles", "half marathon", "1:50"]
    }
  },
];

// ============================================================================
// Metrics Collection
// ============================================================================

interface TrialResult {
  variant_id: string;
  prompt_id: string;
  trial_number: number;
  
  // Tool usage metrics
  search_called: boolean;
  remember_called: boolean;
  search_call_count: number;
  remember_call_count: number;
  
  // Quality metrics
  remember_content_match: number; // 0-1 score of keyword matches
  search_before_response: boolean;
  remember_before_response: boolean;
  
  // Timing
  total_time_ms: number;
  
  // Raw data for debugging
  tool_calls: Array<{ tool: string; input: any; output: any }>;
}

interface VariantStats {
  variant_id: string;
  variant_name: string;
  
  // Aggregate metrics
  total_trials: number;
  search_rate: number; // % of trials that called search
  remember_rate: number; // % of trials that called remember
  
  // Correctness (did it call tools when expected?)
  search_precision: number; // Called when should / total called
  search_recall: number; // Called when should / should have called
  remember_precision: number;
  remember_recall: number;
  
  // Quality
  avg_content_match: number;
  timing_correct_rate: number; // % called before response
  
  // Statistical
  confidence_interval_search: [number, number];
  confidence_interval_remember: [number, number];
}

// ============================================================================
// API Helpers
// ============================================================================

async function createSession(title: string): Promise<string> {
  const resp = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const data = await resp.json() as { id: string };
  return data.id;
}

async function sendMessage(
  sessionId: string,
  messages: Array<{ role: string; content: string }>
): Promise<any[]> {
  // For multi-turn, we need to send the full conversation
  const lastMessage = messages[messages.length - 1];
  
  const resp = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      parts: [{ type: "text", text: lastMessage.content }],
    }),
  });
  
  // Wait for completion
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  // Get all messages
  const messagesResp = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`);
  return messagesResp.json() as Promise<any[]>;
}

function extractToolCalls(messages: any[]): Array<{ tool: string; input: any; output: any }> {
  const toolCalls: Array<{ tool: string; input: any; output: any }> = [];
  
  for (const msg of messages) {
    if (msg.parts) {
      for (const part of msg.parts) {
        if (part.type === "tool" && part.tool?.startsWith("indra_")) {
          toolCalls.push({
            tool: part.tool,
            input: part.state?.input,
            output: part.state?.output,
          });
        }
      }
    }
  }
  
  return toolCalls;
}

// ============================================================================
// Statistical Functions
// ============================================================================

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((acc, val) => acc + Math.pow(val - m, 2), 0) / arr.length);
}

function wilsonInterval(successes: number, trials: number, z: number = 1.96): [number, number] {
  // Wilson score interval for binomial proportion
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

function chiSquareTest(
  observed: [number, number, number, number], // [a, b, c, d] for 2x2 contingency
): { statistic: number; pValue: number } {
  // 2x2 chi-square test for independence
  const [a, b, c, d] = observed;
  const n = a + b + c + d;
  
  const expected = [
    ((a + b) * (a + c)) / n,
    ((a + b) * (b + d)) / n,
    ((c + d) * (a + c)) / n,
    ((c + d) * (b + d)) / n,
  ];
  
  let chiSq = 0;
  for (let i = 0; i < 4; i++) {
    if (expected[i] > 0) {
      chiSq += Math.pow(observed[i] - expected[i], 2) / expected[i];
    }
  }
  
  // Approximate p-value for df=1
  // Using survival function approximation
  const pValue = Math.exp(-chiSq / 2);
  
  return { statistic: chiSq, pValue };
}

// ============================================================================
// Experiment Runner
// ============================================================================

async function runTrial(
  variant: DescriptionVariant,
  prompt: TestPrompt,
  trialNum: number
): Promise<TrialResult> {
  const startTime = Date.now();
  
  // Create session with variant-specific MCP config
  // For now, we'll use the current server config and just track results
  // TODO: Dynamically reconfigure MCP server with variant descriptions
  
  const sessionId = await createSession(`${variant.id}_${prompt.id}_${trialNum}`);
  const messages = await sendMessage(sessionId, prompt.messages);
  const toolCalls = extractToolCalls(messages);
  
  const endTime = Date.now();
  
  // Analyze tool calls
  const searchCalls = toolCalls.filter(t => t.tool === "indra_indra_search");
  const rememberCalls = toolCalls.filter(t => t.tool === "indra_indra_remember");
  
  // Check content match for remember calls
  let contentMatch = 0;
  if (rememberCalls.length > 0 && prompt.expected.remember_content) {
    const savedContent = rememberCalls.map(r => r.input?.content || "").join(" ").toLowerCase();
    const keywords = prompt.expected.remember_content;
    const matches = keywords.filter(kw => savedContent.includes(kw.toLowerCase()));
    contentMatch = matches.length / keywords.length;
  }
  
  // Determine if tools were called before final response
  // (This requires analyzing message order)
  const toolCallIndices = messages.flatMap((m, i) => 
    m.parts?.some((p: any) => p.type === "tool" && p.tool?.startsWith("indra_")) ? [i] : []
  );
  const textResponseIndices = messages.flatMap((m, i) =>
    m.parts?.some((p: any) => p.type === "text" && m.role === "assistant") ? [i] : []
  );
  
  const lastToolCall = Math.max(...toolCallIndices, -1);
  const lastTextResponse = Math.max(...textResponseIndices, -1);
  const toolsBeforeResponse = lastToolCall < lastTextResponse || lastToolCall === -1;
  
  return {
    variant_id: variant.id,
    prompt_id: prompt.id,
    trial_number: trialNum,
    
    search_called: searchCalls.length > 0,
    remember_called: rememberCalls.length > 0,
    search_call_count: searchCalls.length,
    remember_call_count: rememberCalls.length,
    
    remember_content_match: contentMatch,
    search_before_response: searchCalls.length > 0 && toolsBeforeResponse,
    remember_before_response: rememberCalls.length > 0 && toolsBeforeResponse,
    
    total_time_ms: endTime - startTime,
    tool_calls: toolCalls,
  };
}

async function runExperiment(): Promise<void> {
  console.log("🧪 Tool Description A/B Testing Framework");
  console.log("=========================================\n");
  
  const allResults: TrialResult[] = [];
  
  // For each variant
  for (const variant of VARIANTS) {
    console.log(`\n📋 Testing variant: ${variant.name}`);
    
    // TODO: Reconfigure MCP server with this variant's descriptions
    // For now, we're testing against current config only
    
    for (const prompt of TEST_PROMPTS) {
      console.log(`  📝 Prompt: ${prompt.id}`);
      
      for (let trial = 0; trial < TRIALS_PER_VARIANT; trial++) {
        try {
          const result = await runTrial(variant, prompt, trial);
          allResults.push(result);
          
          const searchIcon = result.search_called ? "🔍" : "  ";
          const rememberIcon = result.remember_called ? "💾" : "  ";
          process.stdout.write(`    Trial ${trial + 1}: ${searchIcon}${rememberIcon}\r`);
        } catch (error) {
          console.error(`    Trial ${trial + 1}: ERROR - ${error}`);
        }
        
        // Small delay between trials
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      console.log();
    }
  }
  
  // Analyze results
  console.log("\n📊 RESULTS ANALYSIS");
  console.log("===================\n");
  
  const variantStats: VariantStats[] = [];
  
  for (const variant of VARIANTS) {
    const variantResults = allResults.filter(r => r.variant_id === variant.id);
    
    const searchCalledCount = variantResults.filter(r => r.search_called).length;
    const rememberCalledCount = variantResults.filter(r => r.remember_called).length;
    
    // Calculate precision/recall for search
    const shouldSearch = variantResults.filter(r => {
      const prompt = TEST_PROMPTS.find(p => p.id === r.prompt_id)!;
      return prompt.expected.should_search;
    });
    const searchTruePositive = shouldSearch.filter(r => r.search_called).length;
    const searchFalsePositive = variantResults.filter(r => {
      const prompt = TEST_PROMPTS.find(p => p.id === r.prompt_id)!;
      return r.search_called && !prompt.expected.should_search;
    }).length;
    
    // Calculate precision/recall for remember
    const shouldRemember = variantResults.filter(r => {
      const prompt = TEST_PROMPTS.find(p => p.id === r.prompt_id)!;
      return prompt.expected.should_remember;
    });
    const rememberTruePositive = shouldRemember.filter(r => r.remember_called).length;
    const rememberFalsePositive = variantResults.filter(r => {
      const prompt = TEST_PROMPTS.find(p => p.id === r.prompt_id)!;
      return r.remember_called && !prompt.expected.should_remember;
    }).length;
    
    const stats: VariantStats = {
      variant_id: variant.id,
      variant_name: variant.name,
      total_trials: variantResults.length,
      
      search_rate: searchCalledCount / variantResults.length,
      remember_rate: rememberCalledCount / variantResults.length,
      
      search_precision: searchCalledCount > 0 ? searchTruePositive / searchCalledCount : 0,
      search_recall: shouldSearch.length > 0 ? searchTruePositive / shouldSearch.length : 0,
      remember_precision: rememberCalledCount > 0 ? rememberTruePositive / rememberCalledCount : 0,
      remember_recall: shouldRemember.length > 0 ? rememberTruePositive / shouldRemember.length : 0,
      
      avg_content_match: mean(variantResults.filter(r => r.remember_called).map(r => r.remember_content_match)),
      timing_correct_rate: variantResults.filter(r => r.search_before_response || r.remember_before_response).length / variantResults.length,
      
      confidence_interval_search: wilsonInterval(searchCalledCount, variantResults.length),
      confidence_interval_remember: wilsonInterval(rememberCalledCount, variantResults.length),
    };
    
    variantStats.push(stats);
    
    console.log(`📋 ${variant.name}`);
    console.log(`   Search Rate: ${(stats.search_rate * 100).toFixed(1)}% [${(stats.confidence_interval_search[0] * 100).toFixed(1)}%, ${(stats.confidence_interval_search[1] * 100).toFixed(1)}%]`);
    console.log(`   Remember Rate: ${(stats.remember_rate * 100).toFixed(1)}% [${(stats.confidence_interval_remember[0] * 100).toFixed(1)}%, ${(stats.confidence_interval_remember[1] * 100).toFixed(1)}%]`);
    console.log(`   Search F1: ${(2 * stats.search_precision * stats.search_recall / (stats.search_precision + stats.search_recall) || 0).toFixed(3)}`);
    console.log(`   Remember F1: ${(2 * stats.remember_precision * stats.remember_recall / (stats.remember_precision + stats.remember_recall) || 0).toFixed(3)}`);
    console.log(`   Content Match: ${(stats.avg_content_match * 100).toFixed(1)}%`);
    console.log();
  }
  
  // Statistical comparison between variants
  console.log("\n📈 STATISTICAL COMPARISONS");
  console.log("===========================\n");
  
  const baseline = variantStats.find(v => v.variant_id === "baseline")!;
  
  for (const variant of variantStats) {
    if (variant.variant_id === "baseline") continue;
    
    // Compare remember rates
    const baselineRemember = allResults.filter(r => r.variant_id === "baseline" && r.remember_called).length;
    const baselineTotal = allResults.filter(r => r.variant_id === "baseline").length;
    const variantRemember = allResults.filter(r => r.variant_id === variant.variant_id && r.remember_called).length;
    const variantTotal = allResults.filter(r => r.variant_id === variant.variant_id).length;
    
    const { statistic, pValue } = chiSquareTest([
      baselineRemember,
      baselineTotal - baselineRemember,
      variantRemember,
      variantTotal - variantRemember,
    ]);
    
    const significant = pValue < SIGNIFICANCE_LEVEL;
    const better = variant.remember_rate > baseline.remember_rate;
    
    console.log(`${variant.variant_name} vs Baseline:`);
    console.log(`  Remember Rate: ${(baseline.remember_rate * 100).toFixed(1)}% → ${(variant.remember_rate * 100).toFixed(1)}%`);
    console.log(`  Chi-square: ${statistic.toFixed(3)}, p-value: ${pValue.toFixed(4)}`);
    console.log(`  ${significant ? (better ? "✅ SIGNIFICANTLY BETTER" : "❌ SIGNIFICANTLY WORSE") : "⚪ No significant difference"}`);
    console.log();
  }
  
  // Save raw results
  const outputPath = `./experiments/results_${Date.now()}.json`;
  await Bun.write(outputPath, JSON.stringify({ 
    config: { trials: TRIALS_PER_VARIANT, model: MODEL },
    variants: VARIANTS,
    prompts: TEST_PROMPTS,
    results: allResults,
    stats: variantStats,
  }, null, 2));
  
  console.log(`\n💾 Raw results saved to: ${outputPath}`);
}

// ============================================================================
// Main
// ============================================================================

if (import.meta.main) {
  runExperiment().catch(console.error);
}

export { VARIANTS, TEST_PROMPTS, runTrial, runExperiment };
