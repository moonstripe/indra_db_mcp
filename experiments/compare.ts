#!/usr/bin/env bun
/**
 * Compare results across versions
 */

import { readdir } from "fs/promises";

interface Summary {
  total_trials: number;
  search_count: number;
  search_rate: number;
  search_ci: [number, number];
  remember_count: number;
  remember_rate: number;
  remember_ci: [number, number];
}

interface ResultFile {
  version: string;
  timestamp: string;
  summary: Summary;
}

async function main() {
  const files = (await readdir(".")).filter(f => f.startsWith("results_") && f.endsWith(".json"));
  
  const results: ResultFile[] = [];
  for (const file of files) {
    const data = await Bun.file(file).json();
    results.push(data);
  }
  
  // Sort by timestamp
  results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  console.log("📊 COMPARISON OF TOOL DESCRIPTION VARIANTS");
  console.log("==========================================\n");
  
  console.log("| Version | Remember Rate | 95% CI | Search Rate | 95% CI |");
  console.log("|---------|---------------|--------|-------------|--------|");
  
  for (const r of results) {
    const remRate = `${(r.summary.remember_rate * 100).toFixed(0)}%`;
    const remCI = `[${(r.summary.remember_ci[0] * 100).toFixed(0)}%, ${(r.summary.remember_ci[1] * 100).toFixed(0)}%]`;
    const searchRate = `${(r.summary.search_rate * 100).toFixed(0)}%`;
    const searchCI = `[${(r.summary.search_ci[0] * 100).toFixed(0)}%, ${(r.summary.search_ci[1] * 100).toFixed(0)}%]`;
    
    console.log(`| ${r.version.padEnd(18)} | ${remRate.padStart(5)} | ${remCI.padEnd(12)} | ${searchRate.padStart(5)} | ${searchCI.padEnd(12)} |`);
  }
  
  console.log("\n📈 ANALYSIS");
  console.log("===========\n");
  
  // Find best performer
  const sorted = [...results].sort((a, b) => b.summary.remember_rate - a.summary.remember_rate);
  console.log(`Best Remember Rate: ${sorted[0].version} (${(sorted[0].summary.remember_rate * 100).toFixed(0)}%)`);
  
  // Check for statistical significance
  const best = sorted[0];
  const baseline = results.find(r => r.version.includes("0.1.17")) || results[0];
  
  if (best !== baseline) {
    // Chi-square test
    const a = best.summary.remember_count;
    const b = best.summary.total_trials - a;
    const c = baseline.summary.remember_count;
    const d = baseline.summary.total_trials - c;
    const n = a + b + c + d;
    
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
    
    const pValue = Math.exp(-chiSq / 2); // Approximation
    
    console.log(`\nComparing ${best.version} vs ${baseline.version}:`);
    console.log(`  Chi-square: ${chiSq.toFixed(3)}`);
    console.log(`  p-value (approx): ${pValue.toFixed(4)}`);
    console.log(`  ${pValue < 0.05 ? "✅ SIGNIFICANT (p < 0.05)" : "⚪ Not significant"}`);
  }
  
  // Check if CIs overlap
  console.log("\n📐 CONFIDENCE INTERVAL OVERLAP");
  console.log("===============================\n");
  
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const r1 = results[i];
      const r2 = results[j];
      
      const overlap = !(r1.summary.remember_ci[1] < r2.summary.remember_ci[0] || 
                       r2.summary.remember_ci[1] < r1.summary.remember_ci[0]);
      
      console.log(`${r1.version} vs ${r2.version}: ${overlap ? "CIs overlap (no significant difference)" : "CIs DON'T overlap (significant!)"}`);
    }
  }
}

main().catch(console.error);
