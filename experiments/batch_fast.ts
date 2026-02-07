#!/usr/bin/env bun
/**
 * Faster batch trial runner - with shorter timeout and parallel requests
 */

const OPENCODE_URL = "http://localhost:4097";
const MODEL = { providerID: "dymium", modelID: "claude-sonnet-4-5" };
const TIMEOUT_SECONDS = 45;

// Test prompts that SHOULD trigger indra_remember
const TEST_PROMPTS = [
  "I'm training for a marathon in October. Currently running about 30 miles per week.",
  "I've been dealing with some IT band issues lately. The pain is on my right side.",
  "I tried the Saucony Endorphin Speed and loved them - best shoes I've ever run in!",
  "My goal is to run a sub-4 hour marathon. I ran a 2:05 half last month.",
  "I live in Seattle so I run in rain a lot. Looking for good wet weather gear.",
];

interface TrialResult {
  prompt: string;
  searched: boolean;
  remembered: boolean;
  remember_content: string | null;
  time_ms: number;
}

async function runTrial(prompt: string, trialId: string): Promise<TrialResult> {
  const start = Date.now();
  
  // Create session
  const sessionResp = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: trialId }),
  });
  const { id: sessionId } = await sessionResp.json() as { id: string };
  
  // Send message (don't await)
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
    
    // Check for any indra tool calls completed
    const hasIndraTool = messages.some(m => 
      m.parts?.some((p: any) => p.type === "tool" && p.tool?.startsWith("indra_") && p.state?.status === "completed")
    );
    
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
    prompt,
    searched,
    remembered,
    remember_content,
    time_ms: Date.now() - start,
  };
}

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

async function main() {
  const numTrials = parseInt(process.argv[2] || "2");
  console.log(`🧪 Batch Trial Runner (v0.1.17 - current description)`);
  console.log(`   ${numTrials} trial(s) × ${TEST_PROMPTS.length} prompts = ${numTrials * TEST_PROMPTS.length} total\n`);
  
  const results: TrialResult[] = [];
  
  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const prompt = TEST_PROMPTS[i];
    console.log(`📝 [${i+1}/${TEST_PROMPTS.length}] "${prompt.slice(0, 45)}..."`);
    
    for (let t = 0; t < numTrials; t++) {
      const trialId = `batch_${i}_${t}_${Date.now()}`;
      const result = await runTrial(prompt, trialId);
      results.push(result);
      
      const s = result.searched ? "🔍" : "  ";
      const r = result.remembered ? "💾" : "  ";
      console.log(`   [${t+1}] ${s}${r} ${(result.time_ms/1000).toFixed(0)}s ${result.remembered ? `"${result.remember_content?.slice(0,40)}..."` : ""}`);
    }
  }
  
  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 RESULTS SUMMARY");
  console.log("=".repeat(60));
  
  const total = results.length;
  const searchCount = results.filter(r => r.searched).length;
  const rememberCount = results.filter(r => r.remembered).length;
  
  const searchCI = wilsonInterval(searchCount, total);
  const rememberCI = wilsonInterval(rememberCount, total);
  
  console.log(`\nSearch Rate:   ${searchCount}/${total} = ${(searchCount/total*100).toFixed(0)}%  CI: [${(searchCI[0]*100).toFixed(0)}%, ${(searchCI[1]*100).toFixed(0)}%]`);
  console.log(`Remember Rate: ${rememberCount}/${total} = ${(rememberCount/total*100).toFixed(0)}%  CI: [${(rememberCI[0]*100).toFixed(0)}%, ${(rememberCI[1]*100).toFixed(0)}%]`);
  
  // Save
  const output = {
    version: "0.1.17",
    description: "baseline with IMPORTANT instruction",
    timestamp: new Date().toISOString(),
    config: { trials_per_prompt: numTrials, timeout_seconds: TIMEOUT_SECONDS },
    summary: {
      total_trials: total,
      search_count: searchCount,
      search_rate: searchCount / total,
      search_ci: searchCI,
      remember_count: rememberCount,
      remember_rate: rememberCount / total,
      remember_ci: rememberCI,
    },
    results,
  };
  
  const filename = `results_v0117_${Date.now()}.json`;
  await Bun.write(filename, JSON.stringify(output, null, 2));
  console.log(`\n💾 Saved: ${filename}`);
}

main().catch(console.error);
