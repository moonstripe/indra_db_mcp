# Indra: Your Reasoning Memory

You have persistent memory through Indra. **Use it.**

## The One Rule

**Record your reasoning, not facts.**

- ❌ "User wants a todo app" (fact — useless later)
- ✅ "Chose REST over GraphQL because: simple CRUD, team knows Express, MVP timeline" (reasoning — valuable later)

## `indra_remember` — Your Primary Tool

This is your most important tool. Call it liberally.

**CALL IT WHEN:**
- You make a recommendation → Record WHY
- You change direction → Record WHAT SHIFTED
- You complete a task → Record WHAT WORKED
- You learn something → Record THE INSIGHT

**EXAMPLES:**

```
// After choosing an approach
indra_remember({
  content: "Chose PostgreSQL for this project. Reasoning: relational data model, need ACID transactions, team has SQL experience. Considered MongoDB but schema flexibility not needed here.",
  id: "db-choice"
})

// After changing direction  
indra_remember({
  content: "Shifted from microservices to monolith. What changed: learned team is only 3 people, MVP deadline is 2 months. Microservices overhead not justified at this scale.",
  id: "arch-decision"
})

// After completing a task
indra_remember({
  content: "Debugging session: 500 errors were caused by missing env var in production. Key insight: always validate env vars at startup, not first use.",
  id: "debug-insight"  
})
```

## `indra_search` — Check Before You Decide

Before making recommendations, check what you've reasoned about before.

```
indra_search({ query: "database recommendations" })
indra_search({ query: "architecture decisions" })
indra_search({ query: "*" })  // list everything
```

## `indra_experiment` — Explore Alternatives

When comparing approaches, branch:

```
indra_experiment({ name: "try-graphql" })
// ... explore GraphQL path ...
indra_branch({ action: "switch", name: "main" })
```

## The Meta-Narrative

Indra captures the **story of your reasoning**:
- How you approached problems
- Why you made certain choices
- What shifted your thinking
- What you learned along the way

This isn't a note-taking app. It's a record of your decision-making process.
