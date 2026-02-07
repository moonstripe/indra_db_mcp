#!/usr/bin/env bun
/**
 * Aggregate and analyze results from multiple experiment runs
 * 
 * Usage:
 *   bun run analyze_results.ts [pattern]
 * 
 * Examples:
 *   bun run analyze_results.ts                    # All results
 *   bun run analyze_results.ts large_scale       # Only large scale experiments
 *   bun run analyze_results.ts benefit           # Only benefit variant
 */

import { readdir } from "fs/promises";

interface ExperimentResult {
  variant?: { id: string; name: string };
  version?: string;
  summary: {
    total_trials: number;
    remember_count: number;
    remember_rate: number;
    remember_ci?: [number, number];
    remember_ci_95?: [number, number];
    search_count: number;
    search_rate: number;
    search_ci?: [number, number];
    search_ci_95?: [number, number];
  };
  timestamp?: string;
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

function chiSquarePValue(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  if (n === 0) return 1;
  
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
  
  // Approximation for df=1
  return Math.exp(-chiSq / 2);
}

async function main() {
  const pattern = process.argv[2] || "";
  
  // Find all result files
  const files = (await readdir("."))
    .filter(f => f.endsWith(".json") && f.includes("results") || f.includes("large_scale"))
    .filter(f => f.includes(pattern));
  
  if (files.length === 0) {
    console.log("No result files found matching pattern:", pattern || "(all)");
    return;
  }
  
  console.log("╔════════════════════════════════════════════════════════════════════╗");
  console.log("║           EXPERIMENT RESULTS ANALYSIS                              ║");
  console.log("╚════════════════════════════════════════════════════════════════════╝\n");
  
  // Load all results
  const experiments: { file: string; data: ExperimentResult }[] = [];
  for (const file of files) {
    try {
      const data = await Bun.file(file).json();
      experiments.push({ file, data });
    } catch (e) {
      console.log(`⚠️  Could not parse ${file}`);
    }
  }
  
  console.log(`📁 Loaded ${experiments.length} experiment files\n`);
  
  // Group by variant
  const byVariant: Map<string, { trials: number; remember: number; search: number }> = new Map();
  
  for (const { data } of experiments) {
    const variantId = data.variant?.id || data.version || "unknown";
    const existing = byVariant.get(variantId) || { trials: 0, remember: 0, search: 0 };
    
    existing.trials += data.summary.total_trials;
    existing.remember += data.summary.remember_count;
    existing.search += data.summary.search_count;
    
    byVariant.set(variantId, existing);
  }
  
  // Display aggregated results
  console.log("┌────────────────────────┬─────────┬─────────────┬───────────────────┐");
  console.log("│ Variant                │ Trials  │ Remember    │ 95% CI            │");
  console.log("├────────────────────────┼─────────┼─────────────┼───────────────────┤");
  
  const variantData: { id: string; trials: number; remember: number; search: number; ci: [number, number] }[] = [];
  
  for (const [variantId, stats] of byVariant) {
    const ci = wilsonInterval(stats.remember, stats.trials);
    variantData.push({ id: variantId, ...stats, ci });
    
    const rate = ((stats.remember / stats.trials) * 100).toFixed(0);
    const ciStr = `[${(ci[0] * 100).toFixed(0)}%, ${(ci[1] * 100).toFixed(0)}%]`;
    
    console.log(`│ ${variantId.padEnd(22)} │ ${String(stats.trials).padStart(7)} │ ${rate.padStart(5)}%      │ ${ciStr.padEnd(17)} │`);
  }
  
  console.log("└────────────────────────┴─────────┴─────────────┴───────────────────┘");
  
  // Statistical comparisons
  if (variantData.length >= 2) {
    console.log("\n📊 PAIRWISE COMPARISONS (Chi-Square Test)");
    console.log("─".repeat(70));
    
    // Sort by remember rate descending
    variantData.sort((a, b) => (b.remember / b.trials) - (a.remember / a.trials));
    
    const baseline = variantData[variantData.length - 1]; // Lowest performer as baseline
    
    for (const variant of variantData) {
      if (variant.id === baseline.id) continue;
      
      const a = variant.remember;
      const b = variant.trials - variant.remember;
      const c = baseline.remember;
      const d = baseline.trials - baseline.remember;
      
      const pValue = chiSquarePValue(a, b, c, d);
      const significant = pValue < 0.05;
      const rateA = ((a / variant.trials) * 100).toFixed(0);
      const rateB = ((c / baseline.trials) * 100).toFixed(0);
      
      const diff = (a / variant.trials) - (c / baseline.trials);
      const diffStr = diff > 0 ? `+${(diff * 100).toFixed(0)}%` : `${(diff * 100).toFixed(0)}%`;
      
      console.log(`\n${variant.id} vs ${baseline.id}:`);
      console.log(`  Remember: ${rateA}% vs ${rateB}% (${diffStr})`);
      console.log(`  p-value: ${pValue.toFixed(4)}`);
      console.log(`  ${significant ? "✅ SIGNIFICANT (p < 0.05)" : "⚪ Not significant"}`);
      
      // Check CI overlap
      const overlap = !(variant.ci[1] < baseline.ci[0] || baseline.ci[1] < variant.ci[0]);
      console.log(`  CIs ${overlap ? "overlap" : "DON'T overlap"}`);
    }
  }
  
  // Sample size recommendations
  console.log("\n📐 SAMPLE SIZE RECOMMENDATIONS");
  console.log("─".repeat(70));
  
  const avgRate = variantData.reduce((sum, v) => sum + v.remember / v.trials, 0) / variantData.length;
  
  // Using formula: n = 2 * (z_α + z_β)² * p(1-p) / δ²
  // For 80% power (z_β = 0.84) and α = 0.05 (z_α = 1.96)
  const z = 1.96 + 0.84;
  const p = avgRate;
  
  const n10 = Math.ceil(2 * z * z * p * (1 - p) / (0.10 * 0.10)); // 10% difference
  const n15 = Math.ceil(2 * z * z * p * (1 - p) / (0.15 * 0.15)); // 15% difference
  const n20 = Math.ceil(2 * z * z * p * (1 - p) / (0.20 * 0.20)); // 20% difference
  
  console.log(`\nBased on observed remember rate of ${(avgRate * 100).toFixed(0)}%:`);
  console.log(`  To detect 10% difference: ~${n10} trials per variant`);
  console.log(`  To detect 15% difference: ~${n15} trials per variant`);
  console.log(`  To detect 20% difference: ~${n20} trials per variant`);
  
  // Current power
  const minTrials = Math.min(...variantData.map(v => v.trials));
  const detectableDiff = Math.sqrt(2 * z * z * p * (1 - p) / minTrials);
  console.log(`\n  With current ${minTrials} trials, can detect ${(detectableDiff * 100).toFixed(0)}% difference`);
}

main().catch(console.error);
