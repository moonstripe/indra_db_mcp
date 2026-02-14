# Indra Memory System

You have access to persistent memory that tracks your reasoning process across sessions.

## Core Concept

Indra is NOT for storing user preferences or facts. It's for documenting **your reasoning**:
- WHY you chose an approach
- HOW your understanding evolved
- WHAT shifted when you changed your recommendation

## When to Use

### `indra_remember` — Document your reasoning

**CALL THIS WHEN you:**
- Choose an approach and want to record WHY
- Change your recommendation (capture what shifted your thinking)
- Reach a conclusion worth preserving
- Make a decision after weighing trade-offs

**Example:**
```
indra_remember({
  content: "Recommended monolith over microservices. Key factors: team size (3 engineers), timeline (2 month MVP), no proven scale requirements yet. Microservices would add operational complexity without clear benefit at this stage.",
  id: "arch-decision"
})
```

### `indra_search` — Check your past reasoning

**CALL THIS WHEN you:**
- Are about to make a recommendation (check for prior reasoning)
- Want consistency with earlier conclusions
- Need to recall the journey, not just the destination

**Example:**
```
indra_search({ query: "architecture decisions" })
```

### `indra_experiment` — Explore alternatives

**CALL THIS WHEN you:**
- Want to think through a different approach
- Are comparing two solutions
- Need to reason divergently without losing your main thread

**Example:**
```
indra_experiment({ name: "explore-graphql" })
// ... reason through GraphQL approach ...
indra_branch({ action: "switch", name: "main" })  // back to main
```

### `indra_diff` — Compare reasoning paths

**CALL THIS WHEN you:**
- Want to see how two branches differ
- Need to summarize what changed
- Are deciding whether to merge an exploration

## What to Record

✅ **Good entries** (capture reasoning):
- "Chose PostgreSQL because the data model is heavily relational and they need ACID for transactions"
- "Shifted from REST to GraphQL after learning they have many different clients with varying data needs"
- "Explored microservices but concluded the operational overhead isn't justified for a 3-person team"

❌ **Bad entries** (just facts):
- "User wants to build an e-commerce app"
- "User prefers TypeScript"
- "The API uses REST"

## Branching

Branches let you explore without losing your main thread:

```
main: "Recommended REST API because..."
  └── explore-graphql: "What if GraphQL? Pros: flexible queries..."
  └── explore-grpc: "What if gRPC? Pros: performance..."
```

Create branches freely. They're cheap.
