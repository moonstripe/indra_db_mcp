/**
 * IndraClient - CLI wrapper for indra_db
 * 
 * Handles:
 * - Spawning indra CLI subprocess
 * - Auto-installation if binary not found
 * - Database initialization
 * - JSON parsing and error handling
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdir } from "fs/promises";
import type {
  Thought,
  Edge,
  SearchResult,
  Neighbor,
  Commit,
  Branch,
  DatabaseStatus,
  ListThoughtsResponse,
  SearchResponse,
  NeighborsResponse,
  LogResponse,
  BranchesResponse,
  CommitResponse,
  Diff,
  TraversalDirection,
} from "./types.js";
import { IndraError } from "./types.js";

// ============================================================================
// Configuration
// ============================================================================

export interface IndraClientConfig {
  /** Path to the database file. Defaults to ./thoughts.indra or ~/.thoughts.indra */
  databasePath?: string;
  /** Path to the indra binary. Defaults to searching PATH, then bundled, then auto-install */
  binaryPath?: string;
  /** Whether to auto-commit after each mutation. Defaults to true */
  autoCommit?: boolean;
  /** Timeout for CLI commands in milliseconds. Defaults to 30000 */
  timeout?: number;
  /** Whether to auto-initialize the database if it doesn't exist. Defaults to true */
  autoInit?: boolean;
}

const DEFAULT_CONFIG: Required<IndraClientConfig> = {
  databasePath: "",  // Will be resolved dynamically
  binaryPath: "",    // Will be resolved dynamically
  autoCommit: true,
  timeout: 30000,
  autoInit: true,
};

// ============================================================================
// Binary Management
// ============================================================================

/**
 * Attempts to find or install the indra binary.
 * Priority:
 * 1. Explicit path in config
 * 2. System PATH
 * 3. Bundled binary in ./bin
 * 4. Auto-install via cargo
 */
async function resolveBinaryPath(configPath?: string): Promise<string> {
  // 1. Explicit config path
  if (configPath && existsSync(configPath)) {
    return configPath;
  }

  // 2. Check system PATH
  const pathBinary = await findInPath("indra");
  if (pathBinary) {
    return pathBinary;
  }

  // 3. Check bundled binary
  const bundledPath = join(dirname(import.meta.dir), "bin", "indra");
  if (existsSync(bundledPath)) {
    return bundledPath;
  }

  // 4. Auto-install via cargo
  console.error("[indra_db_mcp] indra binary not found. Installing via cargo...");
  await installViaCargo();
  
  // Check PATH again after install
  const installed = await findInPath("indra");
  if (installed) {
    return installed;
  }

  throw new Error(
    "Failed to find or install indra binary. Please install manually:\n" +
    "  cargo install indra_db --features hf-embeddings\n" +
    "Or download from: https://github.com/moonstripe/indra_db/releases"
  );
}

async function findInPath(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("which", [binary]);
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        resolve(null);
      }
    });
    proc.on("error", () => resolve(null));
  });
}

async function installViaCargo(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.error("[indra_db_mcp] Running: cargo install indra_db --features hf-embeddings");
    
    const proc = spawn("cargo", ["install", "indra_db", "--features", "hf-embeddings"], {
      stdio: ["inherit", "inherit", "inherit"],
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.error("[indra_db_mcp] Successfully installed indra_db");
        resolve();
      } else {
        reject(new Error(`cargo install failed with exit code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run cargo: ${err.message}. Is Rust installed?`));
    });
  });
}

// ============================================================================
// Database Path Resolution
// ============================================================================

function resolveDatabasePath(): string {
  // 1. Check environment variable
  const envPath = process.env.INDRA_DB_PATH;
  if (envPath) {
    // If explicitly set, use that path
    if (envPath.startsWith("~")) {
      return join(homedir(), envPath.slice(1));
    }
    return envPath;
  }

  // 2. Default to hidden .indra file in current directory
  return join(process.cwd(), ".indra");
}

// ============================================================================
// IndraClient
// ============================================================================

export class IndraClient {
  private config: Required<IndraClientConfig>;
  private binaryPath: string | null = null;
  private initialized = false;

  constructor(config: IndraClientConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      databasePath: config.databasePath || resolveDatabasePath(),
    };
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  private async ensureReady(): Promise<void> {
    if (!this.binaryPath) {
      this.binaryPath = await resolveBinaryPath(this.config.binaryPath);
    }

    if (!this.initialized && this.config.autoInit) {
      await this.initializeIfNeeded();
      this.initialized = true;
    }
  }

  private async initializeIfNeeded(): Promise<void> {
    if (!existsSync(this.config.databasePath)) {
      // Ensure parent directory exists
      const parentDir = dirname(this.config.databasePath);
      if (!existsSync(parentDir)) {
        await mkdir(parentDir, { recursive: true });
      }
      
      console.error(`[indra_db_mcp] Initializing new database at ${this.config.databasePath}`);
      // Pass skipInit=true to prevent infinite recursion
      await this.exec(["init"], true);
    }
  }

  // --------------------------------------------------------------------------
  // CLI Execution
  // --------------------------------------------------------------------------

  private async exec<T = unknown>(args: string[], skipInit = false): Promise<T> {
    // Resolve binary if not already done
    if (!this.binaryPath) {
      this.binaryPath = await resolveBinaryPath(this.config.binaryPath);
    }

    // Auto-initialize database if needed (but not for init command itself)
    if (!skipInit && !this.initialized && this.config.autoInit) {
      await this.initializeIfNeeded();
      this.initialized = true;
    }

    const fullArgs = ["-d", this.config.databasePath, "-f", "json", "--no-auto-commit", ...args];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.binaryPath!, fullArgs, {
        timeout: this.config.timeout,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));

      proc.on("close", (code) => {
        if (code === 0) {
          try {
            // Handle empty output (some commands may not return JSON)
            if (!stdout.trim()) {
              resolve({} as T);
              return;
            }
            resolve(JSON.parse(stdout) as T);
          } catch (e) {
            // If JSON parsing fails, return raw output
            resolve(stdout as unknown as T);
          }
        } else {
          reject(
            new IndraError(
              `Command failed: indra ${args.join(" ")}`,
              code ?? 1,
              stderr || stdout,
              ["indra", ...fullArgs]
            )
          );
        }
      });

      proc.on("error", (err) => {
        reject(
          new IndraError(
            `Failed to execute indra: ${err.message}`,
            -1,
            err.message,
            ["indra", ...fullArgs]
          )
        );
      });
    });
  }

  // --------------------------------------------------------------------------
  // Thought Operations
  // --------------------------------------------------------------------------

  /**
   * Create a new thought in the knowledge graph.
   * The thought will be assigned embeddings automatically for semantic search.
   */
  async createThought(content: string, options?: { id?: string }): Promise<Thought> {
    const args = ["create", content];
    if (options?.id) {
      args.push("--id", options.id);
    }
    const result = await this.exec<Thought>(args);
    
    if (this.config.autoCommit) {
      await this.commit(`Create thought: ${options?.id || result.id}`);
    }
    
    return result;
  }

  /**
   * Retrieve a thought by its ID.
   */
  async getThought(id: string): Promise<Thought> {
    return this.exec<Thought>(["get", id]);
  }

  /**
   * Update the content of an existing thought.
   * This creates a new version while preserving history.
   */
  async updateThought(id: string, content: string): Promise<Thought> {
    const result = await this.exec<Thought>(["update", id, content]);
    
    if (this.config.autoCommit) {
      await this.commit(`Update thought: ${id}`);
    }
    
    return result;
  }

  /**
   * Delete a thought from the current state.
   * The thought remains in history and can be recovered via branching.
   */
  async deleteThought(id: string): Promise<void> {
    await this.exec(["delete", id]);
    
    if (this.config.autoCommit) {
      await this.commit(`Delete thought: ${id}`);
    }
  }

  /**
   * List all thoughts in the current state.
   */
  async listThoughts(): Promise<ListThoughtsResponse> {
    return this.exec<ListThoughtsResponse>(["list"]);
  }

  // --------------------------------------------------------------------------
  // Relationship Operations
  // --------------------------------------------------------------------------

  /**
   * Create a typed relationship between two thoughts.
   */
  async relate(
    sourceId: string,
    targetId: string,
    edgeType: string = "relates_to",
    options?: { weight?: number }
  ): Promise<Edge> {
    const args = ["relate", sourceId, targetId, "-t", edgeType];
    if (options?.weight !== undefined) {
      args.push("-w", options.weight.toString());
    }
    const result = await this.exec<Edge>(args);
    
    if (this.config.autoCommit) {
      await this.commit(`Relate ${sourceId} --[${edgeType}]--> ${targetId}`);
    }
    
    return result;
  }

  /**
   * Remove a relationship between two thoughts.
   */
  async unrelate(sourceId: string, targetId: string, edgeType?: string): Promise<void> {
    const args = ["unrelate", sourceId, targetId];
    if (edgeType) {
      args.push("-t", edgeType);
    }
    await this.exec(args);
    
    if (this.config.autoCommit) {
      await this.commit(`Unrelate ${sourceId} from ${targetId}`);
    }
  }

  /**
   * Get all neighbors of a thought (connected via edges).
   */
  async getNeighbors(
    id: string,
    direction: TraversalDirection = "both"
  ): Promise<NeighborsResponse> {
    const args = ["neighbors", id];
    if (direction !== "both") {
      args.push("-d", direction);
    }
    return this.exec<NeighborsResponse>(args);
  }

  // --------------------------------------------------------------------------
  // Search Operations
  // --------------------------------------------------------------------------

  /**
   * Search thoughts by semantic similarity.
   * Uses vector embeddings to find conceptually related thoughts.
   */
  async search(query: string, limit: number = 10): Promise<SearchResponse> {
    return this.exec<SearchResponse>(["search", query, "-l", limit.toString()]);
  }

  // --------------------------------------------------------------------------
  // Versioning Operations
  // --------------------------------------------------------------------------

  /**
   * Commit current changes with a message.
   * Creates a new snapshot in the history DAG.
   */
  async commit(message: string): Promise<CommitResponse> {
    return this.exec<CommitResponse>(["commit", message]);
  }

  /**
   * Get commit history for the current branch.
   */
  async log(limit?: number): Promise<LogResponse> {
    const args = ["log"];
    if (limit) {
      args.push("-l", limit.toString());
    }
    return this.exec<LogResponse>(args);
  }

  /**
   * Create a new branch from the current HEAD.
   */
  async createBranch(name: string): Promise<Branch> {
    return this.exec<Branch>(["branch", name]);
  }

  /**
   * Switch to a different branch.
   */
  async checkout(branchName: string): Promise<void> {
    await this.exec(["checkout", branchName]);
  }

  /**
   * List all branches.
   */
  async listBranches(): Promise<BranchesResponse> {
    return this.exec<BranchesResponse>(["branches"]);
  }

  /**
   * Show diff between two commits.
   */
  async diff(from?: string, to?: string): Promise<Diff> {
    const args = ["diff"];
    if (from) args.push(from);
    if (to) args.push(to);
    return this.exec<Diff>(args);
  }

  /**
   * Get current database status.
   */
  async status(): Promise<DatabaseStatus> {
    return this.exec<DatabaseStatus>(["status"]);
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Get the database path being used.
   */
  getDatabasePath(): string {
    return this.config.databasePath;
  }

  /**
   * Manually trigger initialization.
   */
  async init(): Promise<void> {
    await this.ensureReady();
  }
}

// Export a default instance that can be reconfigured
export const defaultClient = new IndraClient();
