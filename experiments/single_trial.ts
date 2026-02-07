#!/usr/bin/env bun
/**
 * Single trial runner - test one prompt, observe results
 * 
 * Usage: bun run single_trial.ts "Your prompt here"
 */

const OPENCODE_URL = "http://localhost:4097";
const MODEL = { providerID: "dymium", modelID: "claude-sonnet-4-5" };

async function runSingleTrial(prompt: string): Promise<void> {
  console.log("🧪 Single Trial Test\n");
  console.log(`📝 Prompt: "${prompt}"\n`);
  
  // Create session
  const sessionResp = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `trial_${Date.now()}` }),
  });
  const { id: sessionId } = await sessionResp.json() as { id: string };
  console.log(`📋 Session: ${sessionId}\n`);
  
  // Send message (non-blocking)
  console.log("⏳ Sending message...");
  fetch(`${OPENCODE_URL}/session/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      parts: [{ type: "text", text: prompt }],
    }),
  });
  
  // Poll for completion
  let attempts = 0;
  const maxAttempts = 60; // 60 seconds max
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
    
    const messagesResp = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`);
    const messages = await messagesResp.json() as any[];
    
    // Count tool calls
    let searches = 0;
    let remembers = 0;
    let hasAssistantText = false;
    
    for (const msg of messages) {
      for (const part of msg.parts || []) {
        if (part.type === "tool" && part.tool === "indra_indra_search") searches++;
        if (part.type === "tool" && part.tool === "indra_indra_remember") remembers++;
        if (part.type === "text" && msg.role === "assistant") hasAssistantText = true;
      }
    }
    
    process.stdout.write(`\r⏳ ${attempts}s - Messages: ${messages.length}, Search: ${searches}, Remember: ${remembers}   `);
    
    // Check if we have an assistant response (likely done)
    if (hasAssistantText && messages.length >= 2) {
      console.log("\n\n✅ Response complete!\n");
      
      // Print tool calls
      console.log("🔧 Tool Calls:");
      for (const msg of messages) {
        for (const part of msg.parts || []) {
          if (part.type === "tool" && part.tool?.startsWith("indra_")) {
            console.log(`   ${part.tool}:`);
            console.log(`     Input: ${JSON.stringify(part.state?.input)}`);
            if (part.state?.output) {
              const output = part.state.output.slice(0, 200);
              console.log(`     Output: ${output}${part.state.output.length > 200 ? '...' : ''}`);
            }
          }
        }
      }
      
      // Print final response (truncated)
      console.log("\n📄 Response (first 500 chars):");
      for (const msg of messages) {
        if (msg.role === "assistant") {
          for (const part of msg.parts || []) {
            if (part.type === "text") {
              console.log(part.text.slice(0, 500) + (part.text.length > 500 ? '...' : ''));
            }
          }
        }
      }
      
      return;
    }
  }
  
  console.log("\n\n⏰ Timeout reached");
}

// Get prompt from CLI args
const prompt = process.argv[2] || "I'm training for a marathon in October. Currently running 30 miles per week.";
runSingleTrial(prompt).catch(console.error);
