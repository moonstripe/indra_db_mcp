# Tool Description A/B Testing Framework

A statistically rigorous framework for determining optimal MCP tool descriptions that maximize proactive tool usage by LLMs.

## Problem

LLMs don't proactively use tools like `indra_remember` even when tool descriptions suggest they should. The challenge is finding description language that triggers automatic, proactive usage during reasoning - not just reactive usage when explicitly asked.

## Quick Start

```bash
# Quick test (2 trials per prompt, ~8 minutes)
bun run batch_v.ts 2 "my-variant"

# Medium test (10 trials per prompt, ~40 minutes)  
bun run batch_v.ts 10 "my-variant"

# Large scale test (50 trials, ~3.5 hours)
bun run large_scale_experiment.ts 50

# Analyze all results
bun run analyze_results.ts

# Compare specific results
bun run compare.ts
```

## Initial Results (Feb 2026)

| Variant | Remember Rate | 95% CI | n |
|---------|---------------|--------|---|
| v0.1.17 (baseline) | 70% | [40%, 89%] | 10 |
| v0.1.18 (imperative) | 80% | [49%, 94%] | 10 |
| v0.1.19 (benefit) | 100% | [72%, 100%] | 10 |
| v0.1.20 (minimal) | 35% | [18%, 57%] | 20 |
| v0.1.21 (benefit) | 60% | [39%, 78%] | 20 |

**Key Finding**: No statistically significant differences detected (all CIs overlap). Need ~85 trials per variant to detect 15% difference with 80% power.

## Methodology

### 1. Hypothesis Testing

**Null Hypothesis (H₀)**: Different tool description variants have no effect on tool usage rates.

**Alternative Hypothesis (H₁)**: Certain description variants significantly increase proactive tool usage.

### 2. Experimental Design

- **Independent Variable**: Tool description text
- **Dependent Variables**:
  - Remember call rate (% of prompts triggering `indra_remember`)
  - Search call rate (% of prompts triggering `indra_search`)
  - Content quality (are saved notes useful?)

### 3. Test Prompts

5 prompts designed to trigger `indra_remember`:

1. Marathon training info (goal + current state)
2. Injury/health info (IT band issues)
3. Product preference (shoe review)
4. Goal with evidence (marathon goal + half time)
5. Location/environment (Seattle rain running)

### 4. Statistical Analysis

- **Confidence Intervals**: Wilson score intervals (accurate for proportions)
- **Significance Testing**: Chi-square test for 2x2 contingency tables
- **Power Analysis**: Calculate required sample size for desired effect detection

## Scripts

| Script | Purpose |
|--------|---------|
| `batch_v.ts` | Run N trials for a single variant |
| `large_scale_experiment.ts` | Full experiment with 50+ trials |
| `compare.ts` | Quick comparison of result files |
| `analyze_results.ts` | Aggregate analysis across all experiments |
| `single_trial.ts` | Debug a single prompt interactively |
| `run_full_experiment.sh` | Automated full A/B test (requires manual MCP updates) |

## Variants Tested

### 1. Baseline (with IMPORTANT)
```
Save a note to the user's personal knowledge base.
USE THIS WHEN YOU: [list of triggers]
IMPORTANT: Call this tool BEFORE giving your final answer...
```

### 2. Imperative Commands
```
SAVE user information to persistent memory.
REQUIRED ACTIONS - Do these WITHOUT asking:
1. User shares personal info → SAVE immediately
...
```

### 3. Benefit-Focused (Current)
```
Save information to improve future conversations.
Every note you save makes you more helpful next time...
The user set up this system because they WANT you to remember things.
Saving notes IS the service - don't ask permission, just do it.
```

### 4. Minimal
```
Save a note. Call when you learn user info or make recommendations.
```

## Running Full Experiment

For statistically significant results, run the full experiment:

```bash
# Option 1: Automated (requires manual MCP updates between variants)
./run_full_experiment.sh 50

# Option 2: Manual per-variant
# 1. Update src/index.ts with variant description
# 2. bun publish
# 3. Restart opencode server
# 4. bun run batch_v.ts 50 "variant-name"
# 5. Repeat for each variant
```

## Sample Size Calculations

To detect a difference of Δ with 80% power (α=0.05):

| Effect Size (Δ) | Required n per variant |
|-----------------|------------------------|
| 20% | ~50 trials |
| 15% | ~85 trials |
| 10% | ~200 trials |

Current experiments with n=10-20 can only reliably detect ~30% differences.

## File Structure

```
experiments/
├── README.md                    # This file
├── batch_v.ts                   # Quick trial runner
├── large_scale_experiment.ts    # Full experiment
├── compare.ts                   # Result comparison
├── analyze_results.ts           # Aggregate analysis
├── single_trial.ts              # Single prompt debugger
├── run_full_experiment.sh       # Automation script
└── results_*.json               # Experiment results
```

## Interpreting Results

### Significant Improvement (p < 0.05)
1. Verify effect size is meaningful (>10% absolute improvement)
2. Check confidence intervals don't overlap
3. Run additional trials to confirm

### No Significant Difference
1. Need more trials (current experiments underpowered)
2. Description text may not be the limiting factor
3. Consider testing other interventions (system prompts, model choice)

## Future Work

1. **More trials**: Run 50+ trials per variant for statistical power
2. **Multi-model testing**: Compare Claude Sonnet vs Opus vs GPT-4
3. **Prompt diversity**: Test with more varied prompt types
4. **Automated MCP switching**: Build infrastructure for true A/B testing
5. **Longitudinal effects**: Does behavior change over conversation length?
