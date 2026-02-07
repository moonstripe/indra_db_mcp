# Tool Description A/B Testing Framework

A statistically rigorous framework for determining optimal MCP tool descriptions that maximize proactive tool usage by LLMs.

## Problem

LLMs don't proactively use tools like `indra_remember` even when tool descriptions suggest they should. The challenge is finding description language that triggers automatic, proactive usage during reasoning - not just reactive usage when explicitly asked.

## Methodology

### 1. Hypothesis Testing

**Null Hypothesis (H₀)**: Different tool description variants have no effect on tool usage rates.

**Alternative Hypothesis (H₁)**: Certain description variants significantly increase proactive tool usage.

### 2. Experimental Design

- **Independent Variable**: Tool description text
- **Dependent Variables**:
  - Search call rate (% of prompts triggering `indra_search`)
  - Remember call rate (% of prompts triggering `indra_remember`)
  - Timing correctness (tools called before vs after response)
  - Content quality (keyword match score for saved notes)

### 3. Test Prompts

Prompts are categorized by expected behavior:

| Category | Should Search | Should Remember |
|----------|---------------|-----------------|
| Info sharing | Yes (check context) | Yes (save new info) |
| Recommendation | Yes (check history) | Yes (save advice) |
| Simple question | Yes (check context) | No (no new info) |
| Follow-up | Maybe | Yes (new details) |

### 4. Statistical Analysis

- **Sample Size**: Minimum 20 trials per variant per prompt (power analysis for detecting 20% difference with α=0.05, β=0.80)
- **Confidence Intervals**: Wilson score intervals for proportions
- **Significance Testing**: Chi-square test for comparing variants
- **Multiple Comparisons**: Bonferroni correction when comparing multiple variants

## Metrics

### Primary Metrics

1. **Remember Rate**: % of trials where `indra_remember` was called
2. **Search Rate**: % of trials where `indra_search` was called

### Secondary Metrics

1. **Precision**: Of times tool was called, how often was it appropriate?
2. **Recall**: Of times tool should have been called, how often was it?
3. **F1 Score**: Harmonic mean of precision and recall
4. **Content Match**: % of expected keywords present in saved notes

## Variants to Test

### 1. Baseline (Current)
- Passive language: "Save a note", "Use this when"
- Focus on user benefit
- Added "IMPORTANT" timing instruction

### 2. Imperative Commands
- Active voice: "SAVE user information", "REQUIRED ACTIONS"
- Emphasize obligation
- Clear if/then rules

### 3. Benefit-Focused
- Frame as self-improvement: "makes you more helpful"
- Remove permission-seeking: "don't ask, just do it"
- Future benefit framing

### 4. Minimal/Direct
- Shortest possible description
- Reduce cognitive load
- See if brevity helps

### 5. Workflow Integration
- Explicit numbered steps
- Position in response workflow
- Procedural framing

## Running the Experiment

```bash
# Start local services
cd dev_sandbox
source .env
opencode serve --port 4097 &

# Run experiment
cd ../indra_db_mcp/experiments
bun run tool_description_experiment.ts
```

## Interpreting Results

### Significant Improvement (p < 0.05)
If a variant shows statistically significant improvement:
1. Verify effect size is meaningful (>10% absolute improvement)
2. Check confidence intervals don't overlap with baseline
3. Validate with additional trials if marginal

### No Significant Difference
If variants don't differ significantly:
1. The description text may not be the limiting factor
2. Consider testing model-specific variants
3. Explore other intervention points (system prompts, etc.)

## Implementation Notes

### Dynamic MCP Reconfiguration

To truly A/B test variants, we need to restart the MCP server with different descriptions. Options:

1. **Environment variable**: `INDRA_DESCRIPTION_VARIANT=imperative`
2. **Config file**: Load descriptions from JSON
3. **Runtime injection**: Modify server to accept description at startup

Currently, the framework collects metrics but tests against a single configuration. Full A/B testing requires implementing dynamic reconfiguration.

### Session Isolation

Each trial uses a fresh session and database to ensure independence:
- New session ID per trial
- Clean `.indra` file
- No cross-trial contamination

## Future Work

1. **Multi-model testing**: Compare behavior across Claude, GPT-4, etc.
2. **Longitudinal effects**: Does proactive usage improve over conversation?
3. **Combined interventions**: Test description + system prompt together
4. **Semantic A/B testing**: Use embeddings to generate description variants
