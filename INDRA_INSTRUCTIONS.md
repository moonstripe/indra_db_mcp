# Indra Memory System

You have access to persistent memory through the Indra tools. This memory persists across sessions and helps you maintain consistency in your reasoning.

## When to Use Memory

**Record your reasoning when you:**
- Make a recommendation or decision worth remembering
- Learn something about the user's preferences or context
- Choose a specific approach or tool for a task
- Discover something through debugging or exploration
- Form an opinion based on analysis

**Search your memory when you:**
- Need to make a decision in a domain you've worked on before
- Want to check if you've already reasoned about something
- Need to maintain consistency with past recommendations
- Are starting a new session and want context

## Tools Available

### `indra_remember`
Record reasoning, decisions, and insights. Be specific and self-contained—future you should understand this without context.

```
indra_remember({
  content: "Recommended PostgreSQL over MongoDB for this project because the data is highly relational and they need ACID transactions.",
  id: "db-recommendation"  // optional, for updating later
})
```

### `indra_search`
Find past reasoning by meaning. Use `"*"` to list everything.

```
indra_search({ query: "database recommendations" })
indra_search({ query: "*" })  // list all entries
```

### `indra_branch` / `indra_experiment`
Explore alternative approaches without affecting your main reasoning thread.

```
// Before trying something risky or experimental
indra_experiment({ name: "try-microservices-approach" })

// ... explore ...

// Switch back when done
indra_branch({ action: "switch", name: "main" })
```

### `indra_diff`
Compare branches or points in history to see what changed.

```
indra_diff({ from: "main", to: "experiment-branch" })
```

## Best Practices

1. **Be proactive** — Record insights as you form them, not just when asked
2. **Be specific** — Include the "why" not just the "what"
3. **Use branches** — Experiment freely without losing your main thread
4. **Search first** — Check for relevant context before making decisions
5. **Update entries** — Use the same ID to refine understanding over time

## Example Session Flow

```
Session Start:
  → indra_search({ query: "*" }) to see what you know
  → indra_search({ query: "user preferences" }) for relevant context

During Work:
  → indra_remember when you make decisions or learn things
  → indra_experiment when exploring alternatives

Session End:
  → Memory automatically persists, no action needed
```
