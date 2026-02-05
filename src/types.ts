/**
 * Type definitions for indra_db - A content-addressed graph database for versioned thoughts
 * 
 * These types mirror the JSON output from the indra CLI tool.
 */

// ============================================================================
// Core Entities
// ============================================================================

/**
 * A thought is a versioned node in the knowledge graph.
 * Thoughts are content-addressed - their identity comes from their content hash.
 */
export interface Thought {
  /** Human-readable identifier for the thought */
  id: string;
  /** The actual content/text of the thought */
  content: string;
  /** Vector embedding for semantic search (if available) */
  embedding?: number[];
  /** Arbitrary metadata attached to the thought */
  metadata?: Record<string, unknown>;
  /** ISO 8601 timestamp of creation */
  created_at?: string;
  /** ISO 8601 timestamp of last update */
  updated_at?: string;
  /** Content hash (BLAKE3) */
  hash?: string;
}

/**
 * An edge represents a typed, weighted relationship between two thoughts.
 * Edges "float" - they connect to the latest version of nodes, not pinned hashes.
 */
export interface Edge {
  /** ID of the source thought */
  source: string;
  /** ID of the target thought */
  target: string;
  /** Type of relationship (e.g., "supports", "contradicts", "derives_from") */
  edge_type: string;
  /** Optional weight for the relationship (0.0 - 1.0) */
  weight?: number;
  /** Arbitrary metadata attached to the edge */
  metadata?: Record<string, unknown>;
}

/**
 * Built-in edge types with semantic meaning.
 * Custom types are also supported - use any string.
 */
export const EdgeTypes = {
  /** General relationship - when the connection exists but type is unclear */
  RELATES_TO: "relates_to",
  /** Evidence or support - this thought backs up another */
  SUPPORTS: "supports",
  /** Contradiction - this thought conflicts with another */
  CONTRADICTS: "contradicts",
  /** Derivation - this thought is derived/evolved from another */
  DERIVES_FROM: "derives_from",
  /** Hierarchy - this thought is part of a larger concept */
  PART_OF: "part_of",
  /** Similarity - these thoughts express related ideas */
  SIMILAR_TO: "similar_to",
  /** Causation - this thought causes/leads to another */
  CAUSES: "causes",
  /** Temporal ordering - this thought precedes another in time */
  PRECEDES: "precedes",
} as const;

export type EdgeType = (typeof EdgeTypes)[keyof typeof EdgeTypes] | string;

// ============================================================================
// Search & Traversal
// ============================================================================

/**
 * A search result with similarity score.
 * Higher scores indicate greater semantic similarity to the query.
 */
export interface SearchResult {
  /** The matching thought */
  thought: Thought;
  /** Similarity score (typically 0.0 - 1.0, higher is more similar) */
  score: number;
}

/**
 * A neighbor in the graph with the connecting edge.
 */
export interface Neighbor {
  /** The neighboring thought */
  thought: Thought;
  /** The edge connecting to this neighbor */
  edge: Edge;
}

/**
 * Direction for graph traversal.
 */
export type TraversalDirection = "outgoing" | "incoming" | "both";

// ============================================================================
// Versioning (Git-like)
// ============================================================================

/**
 * A commit represents a snapshot of the database at a point in time.
 * Like git, commits are content-addressed and form a DAG.
 */
export interface Commit {
  /** Content hash of this commit */
  hash: string;
  /** Human-readable commit message */
  message: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Hash of parent commit (if any) */
  parent?: string;
  /** Hash of the tree (merkle trie root) */
  tree_hash?: string;
}

/**
 * A branch is a named pointer to a commit.
 */
export interface Branch {
  /** Branch name */
  name: string;
  /** Hash of the commit this branch points to */
  commit_hash: string;
  /** Whether this is the current HEAD branch */
  is_current?: boolean;
}

/**
 * Diff information between two commits.
 */
export interface Diff {
  /** Thoughts added */
  added: Thought[];
  /** Thoughts removed */
  removed: Thought[];
  /** Thoughts modified (before/after pairs) */
  modified: Array<{ before: Thought; after: Thought }>;
  /** Edges added */
  edges_added: Edge[];
  /** Edges removed */
  edges_removed: Edge[];
}

// ============================================================================
// Database Status
// ============================================================================

/**
 * Current status of the database.
 */
export interface DatabaseStatus {
  /** Current branch name */
  branch: string;
  /** Database file path */
  database: string;
  /** Whether there are uncommitted changes */
  dirty: boolean;
}

// ============================================================================
// CLI Response Wrappers
// ============================================================================

export interface ListThoughtsResponse {
  count: number;
  thoughts: Array<{
    id: string;
    content: string;
    has_embedding: boolean;
    type?: string | null;
  }>;
}

export interface SearchResponse {
  query: string;
  count: number;
  results: Array<{
    id: string;
    content: string;
    score: number;
  }>;
}

export interface NeighborsResponse {
  thought_id: string;
  direction: TraversalDirection;
  count: number;
  neighbors: Neighbor[];
}

export interface LogResponse {
  branch: string;
  commits: Commit[];
}

export interface BranchesResponse {
  current: string;
  branches: Branch[];
}

export interface CommitResponse {
  hash: string;
  message: string;
  timestamp: string;
  changes: {
    thoughts_added: number;
    thoughts_modified: number;
    thoughts_removed: number;
    edges_added: number;
    edges_removed: number;
  };
}

// ============================================================================
// Error Types
// ============================================================================

export interface IndraErrorInfo {
  code: string;
  message: string;
  details?: string;
}

export class IndraError extends Error {
  public readonly exitCode: number;
  public readonly stderr: string;
  public readonly command: string[];
  public readonly errorCode?: string;

  constructor(
    message: string,
    exitCode: number,
    stderr: string,
    command: string[]
  ) {
    super(message);
    this.name = "IndraError";
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.command = command;
    
    // Try to extract error code from stderr
    const codeMatch = stderr.match(/error\[(\w+)\]/i);
    this.errorCode = codeMatch?.[1];
  }

  toJSON(): IndraErrorInfo {
    return {
      code: this.errorCode || "UNKNOWN",
      message: this.message,
      details: this.stderr,
    };
  }
}
