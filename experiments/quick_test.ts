#!/usr/bin/env bun
/**
 * Quick single-variant test runner
 * 
 * Runs a smaller set of trials for faster iteration during development.
 * Use the full experiment for statistically valid results.
 */

import { TEST_PROMPTS } from "./tool_description_experiment";

const OPENCODE_URL = "http://localhost:4097";
const MODEL = { providerID: "dymium", modelID: "claude-sonnet-4-5" };
const TRIALS_PER_PROMPT = 3;

interface QuickResult {
  prompt_id: string;
  search_count: number;
  remember_count: number;
  remember_contents: string[];
}

async function createSession(title: string): Promise<string> {
  const resp = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const data = await resp.json() as { id: string };
  return data.id;
}

async function sendAndWait(sessionId: string, text: string, waitMs: number = 45000): Promise<any[]> {
  fetch(`${OPENCODE_URL}/session/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      parts: [{ type: "text", text }],
    }),
  });
  
  await new Promise(resolve => setTimeout(resolve, waitMs));
  
  const resp = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`);
  return resp.json() as Promise<any[]>;
}

function extractIndraCalls(messages: any[]): { searches: any[]; remembers: any[] } {
  const searches: any[] = [];
  const remembers: any[] = [];
  
  for (const msg of messages) {
    for (const part of msg.parts || []) {
      if (part.type === "tool") {
        if (part.tool === "indra_indra_search") {
          searches.push(part.state?.input);
        } else if (part.tool === "indra_indra_remember") {
          remembers.push(part.state?.input);
        }
      }
    }
  }
  
  return { searches, remembers };
}

async function runQuickTest(): Promise<void> {
  console.log("🧪 Quick Tool Usage Test\n");
  
  const results: QuickResult[] = [];
  
  for (const prompt of TEST_PROMPTS.slice(0, 4)) { // Test first 4 prompts
    console.log(`📝 Testing: ${prompt.id}`);
    
    let totalSearches = 0;
    let totalRemembers = 0;
    const allContents: string[] = [];
    
    for (let i = 0; i < TRIALS_PER_PROMPT; i++) {
      process.stdout.write(`   Trial ${i + 1}/${TRIALS_PER_PROMPT}...`);
      
      const sessionId = await createSession(`quick_${prompt.id}_${i}`);
      const lastMessage = prompt.messages[prompt.messages.length - 1];
      const messages = await sendAndWait(sessionId, lastMessage.content);
      const { searches, remembers } = extractIndraCalls(messages);
      
      totalSearches += searches.length > 0 ? 1 : 0;
      totalRemembers += remembers.length > 0 ? 1 : 0;
      
      for (const r of remembers) {
        if (r?.content) allContents.push(r.content);
      }
      
      const s = searches.length > 0 ? "🔍" : "  ";
      const r = remembers.length > 0 ? "💾" : "  ";
      console.log(` ${s}${r}`);
      
      // Brief pause
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    results.push({
      prompt_id: prompt.id,
      search_count: totalSearches,
      remember_count: totalRemembers,
      remember_contents: allContents,
    });
    
    console.log(`   Search: ${totalSearches}/${TRIALS_PER_PROMPT}, Remember: ${totalRemembers}/${TRIALS_PER_PROMPT}\n`);
  }
  
  // Summary
  console.log("📊 SUMMARY");
  console.log("==========");
  
  const totalTrials = results.length * TRIALS_PER_PROMPT;
  const totalSearches = results.reduce((a, r) => a + r.search_count, 0);
  const totalRemembers = results.reduce((a, r) => a + r.remember_count, 0);
  
  console.log(`Search Rate: ${totalSearches}/${totalTrials} (${(totalSearches/totalTrials*100).toFixed(0)}%)`);
  console.log(`Remember Rate: ${totalRemembers}/${totalTrials} (${(totalRemembers/totalTrials*100).toFixed(0)}%)`);
  
  console.log("\n📝 Saved Contents:");
  for (const r of results) {
    if (r.remember_contents.length > 0) {
      console.log(`  ${r.prompt_id}:`);
      for (const c of r.remember_contents) {
        console.log(`    - "${c.slice(0, 80)}${c.length > 80 ? '...' : ''}"`);
      }
    }
  }
}

runQuickTest().catch(console.error);
