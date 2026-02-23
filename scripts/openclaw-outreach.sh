#!/usr/bin/env bash
###############################################################################
# OpenClaw Outreach Automation
#
# Uses OpenClaw's browser automation to find and contact prospects on Upwork.
# Requires: OpenClaw Chrome extension attached to a tab.
#
# Usage: ./scripts/openclaw-outreach.sh
###############################################################################

set -euo pipefail

OUTREACH_DIR="/home/brans/legacy-automation-agency/outreach"
PROSPECTS_FILE="$OUTREACH_DIR/live-prospects.json"
LOG_FILE="/home/brans/.openclaw/logs/outreach.log"

log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [OUTREACH] $1" >> "$LOG_FILE"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [OUTREACH] $1"
}

# Upwork search queries targeting our ideal clients
SEARCH_QUERIES=(
    "data entry QuickBooks Desktop"
    "manual data entry legacy software"
    "data entry Sage 50"
    "data entry desktop application"
    "copy paste proprietary software"
    "order entry in-house system"
)

# Check if OpenClaw browser is connected
check_browser() {
    local status
    status=$(openclaw browser status 2>&1 || echo "not running")
    if echo "$status" | grep -q "running: true"; then
        echo "connected"
    else
        echo "disconnected"
    fi
}

# Search Upwork and extract job listings
search_upwork() {
    local query="$1"
    local encoded_query
    encoded_query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$query'))")

    log "Searching Upwork: '$query'"

    # Navigate to search
    openclaw browser navigate "https://www.upwork.com/nx/search/jobs/?q=${encoded_query}&sort=recency" --timeout 15000 2>/dev/null || true
    sleep 5

    # Take screenshot for verification
    openclaw browser screenshot 2>/dev/null || true

    # Get page snapshot (aria/text representation)
    local snapshot
    snapshot=$(openclaw browser snapshot --format aria --limit 500 2>/dev/null || echo "")

    echo "$snapshot"
}

# Extract job details from snapshot using OpenClaw agent
extract_jobs() {
    local snapshot="$1"

    openclaw agent --agent main -m "Extract job postings from this Upwork page snapshot. For each job, extract: title, budget/hourly rate, description (first 200 chars), client location, and posting date. Return as JSON array. Here's the snapshot: $snapshot" --json --timeout 60 2>&1 || echo "[]"
}

# Generate personalized pitch for a job posting
generate_pitch() {
    local job_title="$1"
    local job_description="$2"

    openclaw agent --agent main -m "Write a short Upwork proposal (under 150 words) for this job. We are Legacy Automation Agency — we automate data entry into desktop software using AI that controls the mouse and keyboard. Job: '$job_title'. Description: '$job_description'. Be helpful and specific about how we'd solve their problem. Don't mention AI directly — say 'automated software agent' or 'digital worker'." --timeout 60 2>&1
}

###############################################################################
# MAIN
###############################################################################

log "=========================================="
log "OpenClaw Outreach Automation starting"
log "=========================================="

# Check browser connection
BROWSER_STATUS=$(check_browser)
if [ "$BROWSER_STATUS" = "disconnected" ]; then
    log "OpenClaw browser not connected."
    log "Please open Chrome and click the OpenClaw extension to attach a tab."
    log "Then re-run this script."

    # Ask OpenClaw agent to notify user
    openclaw agent --agent main -m "The outreach automation script needs browser access. Please tell the user (via Discord or available channel) to open Chrome and click the OpenClaw browser extension to attach a tab. Then run: bash ~/legacy-automation-agency/scripts/openclaw-outreach.sh" --timeout 30 2>&1 || true

    exit 1
fi

log "Browser connected! Starting Upwork search..."

# Initialize prospects file
echo "[]" > "$PROSPECTS_FILE"

for query in "${SEARCH_QUERIES[@]}"; do
    log "--- Query: $query ---"

    SNAPSHOT=$(search_upwork "$query")

    if [ -n "$SNAPSHOT" ]; then
        JOBS=$(extract_jobs "$SNAPSHOT")
        log "Found jobs: $(echo "$JOBS" | wc -c) bytes"

        # Append to prospects file
        python3 -c "
import json
try:
    with open('$PROSPECTS_FILE', 'r') as f:
        existing = json.load(f)
    new_jobs = json.loads('''$JOBS''')
    if isinstance(new_jobs, list):
        existing.extend(new_jobs)
    with open('$PROSPECTS_FILE', 'w') as f:
        json.dump(existing, f, indent=2)
except Exception as e:
    print(f'Error: {e}')
" 2>/dev/null || true
    fi

    # Rate limit between searches
    sleep 10
done

# Count results
TOTAL=$(python3 -c "import json; print(len(json.load(open('$PROSPECTS_FILE'))))" 2>/dev/null || echo "0")
log "Total prospects found: $TOTAL"
log "Saved to: $PROSPECTS_FILE"

# Generate pitches for top prospects
log "Generating pitches for top prospects..."
# (This would iterate through prospects and generate personalized pitches)

log "=========================================="
log "Outreach automation complete"
log "=========================================="
