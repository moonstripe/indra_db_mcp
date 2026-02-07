#!/usr/bin/env bun
/**
 * Batch trial runner - run multiple trials and collect statistics
 * 
 * Usage: bun run batch_trial.ts [num_trials]
 */

const OPENCODE_URL = "http://localhost:4097";
const MODEL = { providerID: "dymium", modelID: "claude-sonnet-4-5" };

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

async function runTrial(prompt: string): Promise<TrialResult> {
  const start = Date.now();
  
  // Create session
  const sessionResp = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `batch_${Date.now()}` }),
  });
  const { id: sessionId } = await sessionResp.json() as { id: string };
  
  // Send message
  fetch(`${OPENCODE_URL}/session/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      parts: [{ type: "text", text: prompt }],
    }),
  });
  
  // Poll for completion (max 60 seconds)
  let messages: any[] = [];
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const resp = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`);
    messages = await resp.json() as any[];
    
    // Check if assistant has responded
    const hasResponse = messages.some(m => 
      m.role === "assistant" && m.parts?.some((p: any) => p.type === "text")
    );
    
    if (hasResponse && messages.length >= 2) break;
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

async function main() {
  const numTrials = parseInt(process.argv[2] || "1");
  console.log(`🧪 Running ${numTrials} trial(s) per prompt (${TEST_PROMPTS.length} prompts)\n`);
  
  const results: TrialResult[] = [];
  
  for (const prompt of TEST_PROMPTS) {
    console.log(`📝 "${prompt.slice(0, 50)}..."`);
    
    for (let i = 0; i < numTrials; i++) {
      const result = await runTrial(prompt);
      results.push(result);
      
      const s = result.searched ? "🔍" : "  ";
      const r = result.remembered ? "💾" : "  ";
      console.log(`   Trial ${i + 1}: ${s}${r} (${(result.time_ms / 1000).toFixed(1)}s)`);
      
      if (result.remember_content) {
        console.log(`      Saved: "${result.remember_content.slice(0, 60)}..."`);
      }
      
      // Brief pause between trials
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log();
  }
  
  // Summary statistics
  console.log("\n📊 SUMMARY STATISTICS");
  console.log("=====================");
  
  const totalTrials = results.length;
  const searchCount = results.filter(r => r.searched).length;
  const rememberCount = results.filter(r => r.remembered).length;
  
  console.log(`Total Trials: ${totalTrials}`);
  console.log(`Search Rate: ${searchCount}/${totalTrials} (${(searchCount/totalTrials*100).toFixed(1)}%)`);
  console.log(`Remember Rate: ${rememberCount}/${totalTrials} (${(rememberCount/totalTrials*100).toFixed(1)}%)`);
  
  // Wilson confidence intervals (95%)
  const z = 1.96;
  
  const searchCI = wilsonInterval(searchCount, totalTrials, z);
  const rememberCI = wilsonInterval(rememberCount, totalTrials, z);
  
  console.log(`\nSearch 95% CI: [${(searchCI[0]*100).toFixed(1)}%, ${(searchCI[1]*100).toFixed(1)}%]`);
  console.log(`Remember 95% CI: [${(rememberCI[0]*100).toFixed(1)}%, ${(rememberCI[1]*100).toFixed(1)}%]`);
  
  // Per-prompt breakdown
  console.log("\n📋 PER-PROMPT BREAKDOWN");
  console.log("=======================");
  
  for (const prompt of TEST_PROMPTS) {
    const promptResults = results.filter(r => r.prompt === prompt);
    const s = promptResults.filter(r => r.searched).length;
    const r = promptResults.filter(r => r.remembered).length;
    console.log(`"${prompt.slice(0, 40)}..."`);
    console.log(`  Search: ${s}/${promptResults.length}, Remember: ${r}/${promptResults.length}`);
  }
  
  // Save results
  const outputFile = `./results_${Date.now()}.json`;
  await Bun.write(outputFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    num_trials: numTrials,
    prompts: TEST_PROMPTS,
    results,
    summary: {
      total_trials: totalTrials,
      search_count: searchCount,
      search_rate: searchCount / totalTrials,
      remember_count: rememberCount,
      remember_rate: rememberCount / totalTrials,
    }
  }, null, 2));
  
  console.log(`\n💾 Results saved to: ${outputFile}`);
}

function wilsonInterval(successes: number, trials: number, z: number): [number, number] {
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

main().catch(console.error);
