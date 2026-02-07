#!/bin/bash
#
# Full A/B Test Runner
# 
# Runs complete experiment across all variants with sufficient trials
# for statistical significance.
#
# Usage:
#   ./run_full_experiment.sh [trials_per_prompt]
#
# Default: 50 trials per prompt
#

set -e

TRIALS=${1:-50}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_DIR="$(dirname "$SCRIPT_DIR")"
SANDBOX_DIR="$(dirname "$MCP_DIR")/dev_sandbox"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║     FULL A/B TEST EXPERIMENT                                   ║"
echo "║                                                                ║"
echo "║  This script runs trials for ALL variants with automatic      ║"
echo "║  MCP server reconfiguration between variants.                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Configuration:"
echo "  Trials per prompt: $TRIALS"
echo "  Prompts: 5"
echo "  Variants: 4"
echo "  Total trials: $((TRIALS * 5 * 4))"
echo "  Estimated time: $((TRIALS * 5 * 4 * 50 / 60)) minutes"
echo ""

# Variant configurations
declare -A VARIANTS
VARIANTS["baseline"]='Save a note to the users personal knowledge base.\n\nUSE THIS WHEN YOU:\n- Learn something about the user\n- Make a recommendation\n- Discover a pattern\n\nIMPORTANT: Call BEFORE responding.'
VARIANTS["imperative"]='SAVE user information to persistent memory.\n\nREQUIRED ACTIONS - Do WITHOUT asking:\n1. User shares info → SAVE immediately\n2. You recommend → SAVE recommendation\n\nTIMING: Call BEFORE response.'
VARIANTS["benefit"]='Save information to improve future conversations.\n\nEvery note makes you more helpful:\n- Preferences → Better recommendations\n- Context → More relevant answers\n\nDont ask permission, just do it.\n\nCall BEFORE responding.'
VARIANTS["minimal"]='Save a note. Call when you learn user info or make recommendations.'

# Function to update MCP description
update_mcp_description() {
    local variant=$1
    local desc="${VARIANTS[$variant]}"
    
    echo "📝 Updating MCP to variant: $variant"
    
    # This would require modifying the TypeScript file
    # For now, we output what should be changed
    echo "   Description: ${desc:0:50}..."
}

# Function to restart opencode server
restart_server() {
    echo "🔄 Restarting opencode server..."
    pkill -f "opencode serve" 2>/dev/null || true
    sleep 2
    
    cd "$SANDBOX_DIR"
    source .env
    opencode serve --port 4097 > /tmp/opencode.log 2>&1 &
    sleep 5
    
    # Verify server is running
    if curl -s http://localhost:4097/session > /dev/null; then
        echo "   ✅ Server running"
    else
        echo "   ❌ Server failed to start"
        exit 1
    fi
}

# Function to reset database
reset_db() {
    echo "🗑️  Resetting database..."
    cd "$SANDBOX_DIR"
    rm -f .indra
    ../indra_db/target/release/indra init > /dev/null
    echo "   ✅ Database reset"
}

# Function to run trials for a variant
run_variant() {
    local variant=$1
    
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "🔬 RUNNING VARIANT: $variant"
    echo "════════════════════════════════════════════════════════════════"
    
    # Update MCP (manual step for now)
    update_mcp_description "$variant"
    
    # For automated runs, you would:
    # 1. Edit src/index.ts with the variant description
    # 2. Run: cd $MCP_DIR && bun publish
    # 3. Restart the server
    
    echo ""
    echo "⚠️  MANUAL STEP REQUIRED:"
    echo "   1. Update $MCP_DIR/src/index.ts with '$variant' description"
    echo "   2. Run: cd $MCP_DIR && bun publish"
    echo "   3. Press ENTER to continue..."
    read -r
    
    restart_server
    reset_db
    
    # Run trials
    cd "$SCRIPT_DIR"
    bun run batch_v.ts "$TRIALS" "v-$variant"
}

# Main experiment loop
main() {
    echo ""
    echo "Starting experiment at $(date)"
    echo ""
    
    for variant in baseline imperative benefit minimal; do
        run_variant "$variant"
    done
    
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "📊 EXPERIMENT COMPLETE"
    echo "════════════════════════════════════════════════════════════════"
    echo ""
    echo "Analyzing results..."
    
    cd "$SCRIPT_DIR"
    bun run analyze_results.ts
    
    echo ""
    echo "Completed at $(date)"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi
