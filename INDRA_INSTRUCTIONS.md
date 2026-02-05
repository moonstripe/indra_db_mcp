# Indra: Versioned Thinking Tools

You have access to **Indra**, a knowledge graph for externalizing and versioning your reasoning. Use it proactively during complex tasks.

## When to Use Indra

**Search first** when starting work on a topic - you may have prior insights:
- `indra_search` - Find related thoughts before duplicating work

**Remember** key insights as you work:
- Observations, hypotheses, conclusions
- Important patterns or surprises
- Decisions and their rationale

**Connect** related thoughts to build understanding:
- Link new insights to prior ones (derives_from, supports, contradicts)
- Build chains of reasoning visible in the graph

**Branch** when exploring alternatives:
- Create branches for "what if" scenarios
- Compare different approaches

## Quick Reference

| Situation | Tool |
|-----------|------|
| Starting a task | `indra_search` for prior context |
| Key insight | `indra_remember` to capture it |
| Building on prior thought | `indra_connect` with relationship |
| Exploring alternative | `indra_branch` then explore |
| Finished analysis | `indra_checkpoint` with summary |

## Example Flow

```
1. indra_search "database optimization" → find prior work
2. indra_remember "Identified N+1 query in user loader" --id n-plus-one-finding
3. indra_connect n-plus-one-finding --to prior-perf-analysis --relationship derives_from
4. indra_checkpoint "Completed initial performance analysis"
```

Use Indra to make your reasoning visible and traceable.
