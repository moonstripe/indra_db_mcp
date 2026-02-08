#!/usr/bin/env bun
/**
 * H3 Hybrid Test: Philosophy + Triggers + Permission
 */

const OPENCODE_URL = "http://localhost:4096";
const MODEL = { providerID: "dymium", modelID: "claude-sonnet-4-5" };
const TIMEOUT_SECONDS = 60;
const LOG_FILE = "/tmp/hybrid_experiment.log";

const NEUTRAL_PROMPTS = [
  "I'm training for a marathon in October. Currently running about 30 miles per week.",
  "I've been dealing with some IT band issues lately. The pain is on my right side.",
  "I tried the Saucony Endorphin Speed and loved them - best shoes I've ever run in!",
  "My goal is to run a sub-4 hour marathon. I ran a 2:05 half last month.",
  "I live in Seattle so I run in rain a lot. Looking for good wet weather gear.",
];

async function log(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  process.stdout.write(line);
  await Bun.write(LOG_FILE, (await Bun.file(LOG_FILE).text().catch(() => "")) + line);
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

interface TrialResult {
  prompt_index: number;
  prompt: string;
  remembered: boolean;
  searched: boolean;
  remember_content: string | null;
  time_ms: number;
}

async function runTrial(promptIndex: number, prompt: string): Promise<TrialResult> {
  const start = Date.now();
  const trialId = `hybrid_${promptIndex}_${Date.now()}`;
  
  const sessionResp = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: trialId }),
  });
  const { id: sessionId } = await sessionResp.json() as { id: string };
  
  fetch(`${OPENCODE_URL}/session/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      parts: [{ type: "text", text: prompt }],
    }),
  });
  
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
  
  let searched = false;
  let remembered = false;
  let remember_content: string | null = null;
  
  for (const msg of messages) {
    for (const part of msg.parts || []) {
      if (part.type === "tool") {
        const toolName = part.tool?.toLowerCase() || "";
        if (toolName.includes("search")) searched = true;
        if (toolName.includes("remember")) {
          remembered = true;
          remember_content = part.state?.input?.content || null;
        }
      }
    }
  }
  
  return { prompt_index: promptIndex, prompt, remembered, searched, remember_content, time_ms: Date.now() - start };
}

async function main() {
  const trialsPerPrompt = parseInt(process.argv[2] || "5");
  const outputFile = `hybrid_results_${Date.now()}.json`;
  
  await log("╔════════════════════════════════════════════════════════════════════╗");
  await log("║     H3 HYBRID: Philosophy + Triggers + Permission (v0.1.23)       ║");
  await log("╠════════════════════════════════════════════════════════════════════╣");
  await log(`║ Trials per prompt: ${trialsPerPrompt}                                              ║`);
  await log("╚════════════════════════════════════════════════════════════════════╝\n");
  
  const results: TrialResult[] = [];
  
  for (let p = 0; p < NEUTRAL_PROMPTS.length; p++) {
    const prompt = NEUTRAL_PROMPTS[p];
    await log(`📝 Prompt ${p + 1}/${NEUTRAL_PROMPTS.length}: "${prompt.slice(0, 45)}..."`);
    
    let remembered = 0;
    for (let t = 0; t < trialsPerPrompt; t++) {
      const result = await runTrial(p, prompt);
      results.push(result);
      if (result.remembered) remembered++;
      await log(`   Trial ${t + 1}/${trialsPerPrompt}: ${result.remembered ? "💾" : "  "}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await log(`   → Rate: ${remembered}/${trialsPerPrompt} (${(remembered/trialsPerPrompt*100).toFixed(0)}%)\n`);
  }
  
  const total = results.length;
  const rememberCount = results.filter(r => r.remembered).length;
  const ci = wilsonInterval(rememberCount, total);
  
  await log("═".repeat(70));
  await log("HYBRID RESULTS (v0.1.23):");
  await log(`  Remember rate: ${(rememberCount/total*100).toFixed(0)}% [${(ci[0]*100).toFixed(0)}%, ${(ci[1]*100).toFixed(0)}%] (n=${total})`);
  await log("═".repeat(70));
  
  const output = {
    version: "0.1.23-hybrid",
    timestamp: new Date().toISOString(),
    description: "Philosophy + Triggers + Permission",
    summary: { total, remembered: rememberCount, rate: rememberCount/total, ci_95: ci },
    per_prompt: NEUTRAL_PROMPTS.map((prompt, i) => ({
      prompt: prompt.slice(0, 50),
      remembered: results.filter(r => r.prompt_index === i && r.remembered).length,
      total: trialsPerPrompt,
    })),
    results,
  };
  
  await Bun.write(outputFile, JSON.stringify(output, null, 2));
  await log(`\n💾 Results saved: ${outputFile}`);
}

main().catch(console.error);
