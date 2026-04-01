# Misoki Demo Script

This script walks through the end-to-end demo for the Nosana × ElizaOS builders challenge.

## Prerequisites

- Analysis service running on `http://localhost:8000`
- ElizaOS agent running on `http://localhost:3000`
- Web frontend running on `http://localhost:8080`
- (Optional) `GITHUB_TOKEN` set for higher API rate limits
- (Optional) `MISOKI_GITHUB_TOKEN` set for PR creation

## Demo Flow

### 1. Open the Web UI

Navigate to `http://localhost:8080`. You'll see the Misoki landing page with a repo input form and feature cards.

### 2. Analyze a Repository

Paste a public Python repo URL and click **Analyse**:

```
https://github.com/pallets/click
```

The UI shows a progress indicator while the analysis runs. The analysis service fetches Python files from GitHub, runs AST-based analyzers (architecture, dead code, duplication, performance, type hints), and returns structured results.

### 3. Explore the Results

The results page shows:

- **Severity cards** — critical/warning/info counts at a glance
- **Category breakdown** — issue counts per analysis category with color bars
- **Affected files** — file tree on the left sidebar showing which files have issues
- **Issue list** — center panel with searchable, filterable issue rows
- **Commit and branch** — top status bar shows the analyzed commit SHA and branch

Click a file in the sidebar to filter issues to that file.

### 4. Preview a Fix

For issues marked as fixable (unused imports, unused variables), click the **Preview fix** button on the issue row.

A Monaco diff editor overlay appears showing:
- Side-by-side original vs. modified code
- Risk level badge (low/medium/high)
- The fix_id for reference

### 5. Apply Safe Fixes

Click the **Apply Safe Fixes** button in the top status bar. This:
- Collects all fixable issues from the analysis
- Sends them to `POST /apply/fixes`
- Shows an overlay with applied/skipped results and the combined diff

### 6. Chat with the Agent

Click **Ask Agent** to open the chat panel. The agent is automatically primed with the analyzed repo URL.

Try these follow-up commands:
- `"Show me the worst file"` — shows file with the densest cluster of findings
- `"Explain the top critical issue"` — provides a detailed explanation of a specific finding
- `"Create a refactor plan"` — generates a prioritized remediation plan
- `"Apply safe fixes"` — applies fixes through the agent (requires agent to have completed background analysis)
- `"Create PR"` — prepares a draft pull request with applied patches

### 7. (Optional) Create a Pull Request

After applying safe fixes, say `"Create PR"` in the chat. If `MISOKI_GITHUB_TOKEN` is configured with write access, the agent will:
1. Create a new branch (`misoki/{repo}-safe-fixes-{date}`)
2. Push patched files to the branch
3. Open a draft pull request
4. Return the PR URL

## Demo Tips

- Use a small repo (< 20 Python files) for a fast demo cycle
- Good demo repos: `pallets/click`, `psf/requests`, `pydantic/pydantic`
- The analysis typically takes 10–30 seconds depending on repo size and GitHub rate limits
- If the Nosana LLM endpoint is slow, the direct UI buttons (Analyse, Preview, Apply) still work independently of the agent

## Talking Points

1. **Architecture**: 3-tier design — ElizaOS agent for orchestration, Python FastAPI for AST analysis, Next.js for the UI
2. **Reuse**: The analysis engine reuses `ohm-mcp` Python modules directly — no reimplementation
3. **Decentralized**: Runs on Nosana GPU infrastructure for LLM inference
4. **Actionable**: Goes beyond static analysis — shows diffs, applies fixes, creates PRs
5. **Conversational**: Natural language follow-up through the ElizaOS chat interface
