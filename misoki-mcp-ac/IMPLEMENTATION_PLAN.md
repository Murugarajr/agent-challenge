# Misoki MCP AC Implementation Plan

## 1. Goal

Build a challenge-ready ElizaOS agent that can:

1. Accept a GitHub repository URL from the user.
2. Analyze Python code quality and refactoring opportunities using the existing `ohm-mcp` analysis engine.
3. Return a structured summary of issues, affected files, and suggested fixes.
4. Preview diffs for selected fixes.
5. Optionally apply low-risk fixes and open a GitHub Pull Request.
6. Run inside a Nosana deployment with a custom frontend suitable for the builders challenge.

This plan assumes the base ElizaOS + Nosana chat-completions setup in `agent-challenge` is already working.

## 2. Product Definition

### Working name

`Misoki`

### Core user flow

1. User opens the web UI.
2. User pastes a GitHub repository URL.
3. Eliza agent asks the Python analysis service to inspect the repo.
4. The UI shows:
   - overall repo health summary
   - issue counts by severity and category
   - affected files
   - fix previews and diffs
5. User asks follow-up questions in chat:
   - "show me the worst file"
   - "preview the duplicate code fix"
   - "apply safe fixes"
   - "create a PR"

### Demo promise

The demo should show an end-to-end path from natural-language request to actionable code review and fix preview, not just static analysis output.

## 3. Scope

### MVP scope

- Analyze public GitHub repositories.
- Focus on Python files only.
- Support repo-level summary and file-level drill-down.
- Reuse `ohm-mcp` analyzers directly from Python code.
- Use ElizaOS as the conversational orchestration layer.
- Provide a custom web UI with chat, issue list, and diff preview.
- Deploy the stack in containers suitable for Nosana.

### Explicit non-goals for MVP

- Full multi-language support.
- Full automated project-wide refactoring with guaranteed correctness.
- GitHub auth for private repositories.
- Full CI integration.
- Bulk PR generation for many refactors at once.

### Stretch goals

- Private repo support via GitHub token.
- Safe auto-fix categories with rollback.
- Inline code explanations from the agent.
- Repo history and saved analysis sessions.
- Team collaboration and multi-user workspaces.

## 4. Recommended Architecture

Use a 3-service design, but keep service boundaries narrow:

1. `agent-challenge`
   - ElizaOS agent
   - custom Nosana-backed text model plugin
   - custom Misoki plugin and actions
2. `misoki-analysis-service`
   - Python FastAPI service
   - imports and uses `ohm_mcp.refactoring.*` modules directly
   - exposes a small HTTP API for analysis and preview
3. `misoki-web`
   - Next.js or React app
   - custom UI for repo input, issue dashboard, chat, and diff preview

### Why this split

- Eliza handles memory, conversation, and orchestration well.
- `ohm-mcp` already contains the Python analysis logic, so the cleanest path is to wrap it in FastAPI instead of reimplementing logic in TypeScript.
- The frontend can evolve independently without coupling UI state to Eliza internals.

## 5. Reuse Strategy From `ohm-mcp`

Do not treat `ohm-mcp` as an MCP server dependency inside the challenge app. Reuse its Python modules as a library.

### Reuse directly

- `analysis.py`
  - baseline code quality checks
- `architecture_analyzer.py`
  - god object, circular dependencies, SOLID violations
- `dead_code_detector.py`
  - unused imports, unused variables, unreachable code
- `duplication_detector.py`
  - duplicate blocks / similar code
- `performance_analyzer.py`
  - hotspots and inefficient patterns
- `type_hint_analyzer.py`
  - missing type annotations and coverage
- `patching.py`
  - unified diff generation
- `ast_refactorer.py`
  - safe AST-assisted code modifications
- `automated_executor.py`
  - later-phase safe application / rollback flow

### Do not expose in MVP

- The full MCP tool surface.
- Every refactoring primitive from `ohm-mcp`.
- Complex project-wide rewrite flows until the analysis-reporting path is stable.

### Implementation principle

Create a thin orchestration layer in the new FastAPI service that:

- normalizes file inputs
- runs a curated subset of analyzers
- converts outputs into a single challenge-specific response schema
- produces diff previews for selected low-risk fixes

## 6. Proposed Repository Layout

Inside `/Users/ohm/Documents/projects/sbox/agent-challenge/misoki-mcp-ac`:

```text
misoki-mcp-ac/
  README.md
  IMPLEMENTATION_PLAN.md
  analysis-service/
    app/
      main.py
      api/
        routes_health.py
        routes_analyze.py
        routes_preview.py
        routes_apply.py
      core/
        github_fetcher.py
        file_filter.py
        issue_mapper.py
        risk_scoring.py
      services/
        repo_analyzer.py
        fix_preview_service.py
        apply_fix_service.py
      schemas/
        analyze.py
        preview.py
        apply.py
      settings.py
    tests/
    Dockerfile
    pyproject.toml
  web/
    src/
      app/
      components/
      lib/
      types/
    Dockerfile
    package.json
  docs/
    api-contract.md
    demo-script.md
    deployment.md
```

Inside the existing `agent-challenge` app:

```text
agent-challenge/
  src/
    index.ts
    plugins/
      misoki/
        index.ts
        actions/
          analyse-repo.ts
          summarize-file.ts
          preview-fix.ts
          apply-fix.ts
          create-pr.ts
        lib/
          analysis-client.ts
          response-formatters.ts
          github-url.ts
```

## 7. Service Contracts

### 7.1 Analysis service API

Keep the API intentionally small.

#### `POST /health`

Returns readiness and dependency status.

#### `POST /analyze/repo`

Request:

```json
{
  "github_url": "https://github.com/org/repo",
  "branch": "main",
  "max_files": 40,
  "include_categories": [
    "architecture",
    "dead_code",
    "duplication",
    "performance",
    "type_hints"
  ]
}
```

Response:

```json
{
  "repo": "https://github.com/org/repo",
  "commit": "abc123",
  "files_scanned": 24,
  "summary": {
    "critical": 2,
    "warning": 8,
    "info": 12
  },
  "issues": [
    {
      "file": "app/service.py",
      "category": "dead_code",
      "severity": "warning",
      "title": "Unused imports detected",
      "details": "...",
      "line": 14,
      "fixable": true,
      "fix_id": "dead_code:app/service.py:14"
    }
  ]
}
```

#### `POST /preview/fix`

Request:

```json
{
  "github_url": "https://github.com/org/repo",
  "branch": "main",
  "fix_id": "dead_code:app/service.py:14"
}
```

Response:

```json
{
  "file": "app/service.py",
  "risk": "low",
  "original": "...",
  "modified": "...",
  "diff": "--- ..."
}
```

#### `POST /apply/fixes`

Phase 2b or 3. Start with low-risk fixes only.

Request:

```json
{
  "github_url": "https://github.com/org/repo",
  "branch": "main",
  "fix_ids": ["dead_code:app/service.py:14"],
  "mode": "preview_only"
}
```

Response:

```json
{
  "applied": 1,
  "skipped": 0,
  "patches": [
    {
      "file": "app/service.py",
      "diff": "--- ..."
    }
  ]
}
```

## 8. Eliza Responsibilities

The Eliza agent should not analyze source code itself. It should:

- validate and extract repo URLs
- choose the right backend action
- summarize results for the user
- store analysis results in memory for follow-up questions
- coordinate GitHub PR creation
- translate natural language into analysis or fix operations

### Initial actions

- `ANALYSE_REPO`
- `SHOW_TOP_ISSUES`
- `SHOW_FILE_DETAILS`
- `PREVIEW_FIX`
- `APPLY_SAFE_FIXES`
- `CREATE_PR`

### Memory strategy

Persist:

- last analyzed repo URL
- branch and commit
- analysis summary
- latest issue list
- latest diff preview

This enables conversational follow-up without re-running repo analysis for every prompt.

## 9. Frontend Responsibilities

The frontend should demonstrate that this is more than a CLI wrapper.

### Required screens/components

- Repo input form
- Analysis progress state
- Issue summary cards by severity/category
- File list / issue explorer
- Diff viewer
- Chat panel connected to Eliza

### Recommended UI sequence

1. User submits repo URL.
2. UI shows queued and processing states.
3. Results page appears with severity cards.
4. Clicking a file opens issue details and diff preview.
5. Chat panel remains visible for natural-language follow-up.

### Technical recommendation

Use Next.js if you want easy deployment and app-router conventions. Use plain React if you want the smallest footprint. Either is acceptable; the decision should be based on speed of execution.

## 10. Implementation Phases

### Phase 0: Foundation and contracts

Deliverables:

- Finalize plan and response schema.
- Lock the MVP scope to Python-only public repos.
- Add docs for API contracts and demo flow.

Tasks:

- Define issue schema and severity mapping.
- Define fix ID convention.
- Define allowed analyzer categories for MVP.
- Choose frontend stack.
- Decide whether PR creation is MVP or stretch.

### Phase 1: Python analysis service

Deliverables:

- FastAPI service with `/health`, `/analyze/repo`, `/preview/fix`.
- GitHub file fetcher for public repos.
- Curated analyzer pipeline based on `ohm-mcp`.

Tasks:

- Build GitHub content fetcher using raw file or contents API.
- Restrict to `.py` files and a file count cap.
- Create issue normalization layer.
- Add risk scoring:
  - low: import cleanup, dead code cleanup, some type-hint additions
  - medium: extract method suggestions
  - high: architecture refactors
- Add unified diff generation.
- Add unit tests for issue mapping and preview generation.

Exit criteria:

- Analyze a sample public repo and return stable structured JSON.
- Preview at least one safe fix with a diff.

### Phase 2: Eliza integration

Deliverables:

- Custom Misoki Eliza plugin.
- Repo analysis and follow-up actions.
- Memory persistence for results.

Tasks:

- Add backend client for the FastAPI service.
- Implement `ANALYSE_REPO`.
- Implement summary formatters.
- Implement follow-up actions for file details and diff preview.
- Add `CREATE_PR` only after preview flow is stable.

Exit criteria:

- User can paste a repo URL in chat and receive a structured summary.
- User can ask for file-level details and diff previews without restarting analysis.

### Phase 3: Custom web UI

Deliverables:

- Results dashboard
- File explorer
- Diff preview pane
- Embedded chat panel

Tasks:

- Connect repo input to Eliza or directly to backend orchestration endpoint.
- Render severity/category summary.
- Add searchable issue list.
- Add Monaco or a similar diff component.
- Support loading, empty, and failure states.

Exit criteria:

- Demo can be driven entirely from the browser.
- The UI makes the agent's value obvious in under 60 seconds.

### Phase 4: Safe fix application

Deliverables:

- Apply low-risk patches.
- Optional branch creation and GitHub PR flow.

Tasks:

- Start with preview-only mode.
- Add file patch application for explicitly safe fix categories.
- If GitHub token is configured, create branch and PR.
- Track skipped fixes and explain why they were skipped.

Exit criteria:

- At least one safe fix class can move from analysis to PR.

### Phase 5: Packaging and Nosana deployment

Deliverables:

- Dockerfiles for all services.
- Deployment docs.
- Final demo environment.

Tasks:

- Containerize agent, analysis service, and frontend.
- Add environment-variable docs.
- Validate internal service URLs.
- Create production startup command and health checks.
- Produce challenge demo script.

Exit criteria:

- End-to-end demo runs from a clean environment.

## 11. Analyzer-to-Feature Mapping

| User-facing feature | `ohm-mcp` module | MVP status |
| --- | --- | --- |
| Repo health summary | `analysis.py` | MVP |
| Architecture hotspots | `architecture_analyzer.py` | MVP |
| Dead code findings | `dead_code_detector.py` | MVP |
| Duplicate code findings | `duplication_detector.py` | MVP |
| Performance issues | `performance_analyzer.py` | MVP |
| Type hint gaps | `type_hint_analyzer.py` | MVP |
| Diff preview | `patching.py`, `ast_refactorer.py` | MVP |
| Safe apply with rollback | `automated_executor.py` | Phase 4 |
| Project-wide rename/import refactor | `symbol_renamer.py`, `import_refactorer.py` | Stretch |

## 12. Risk Register

### Risk: repo fetch complexity

Mitigation:

- Start with public repositories only.
- Cap file count and file size.
- Analyze Python files only.

### Risk: too much refactoring ambition

Mitigation:

- Separate "analysis", "preview", and "apply".
- Only auto-apply low-risk changes in MVP.
- Treat architecture refactors as advisory output first.

### Risk: unstable challenge demo

Mitigation:

- Use one known demo repository during final validation.
- Cache last analysis result.
- Provide clear fallback UI for service failures.

### Risk: agent verbosity or poor summaries

Mitigation:

- Keep structured machine responses from backend.
- Make Eliza summarize from normalized JSON instead of raw analyzer output.

### Risk: Nosana deployment complexity

Mitigation:

- Validate all three services locally in Docker before deploying.
- Keep the backend HTTP API simple.
- Avoid unnecessary inter-service dependencies.

## 13. Testing Strategy

### Python service

- Unit tests for:
  - GitHub file filtering
  - analyzer result normalization
  - severity mapping
  - diff preview generation
- Integration tests for:
  - `/analyze/repo`
  - `/preview/fix`

### Eliza plugin

- URL extraction
- backend client error handling
- summary formatting
- memory creation and retrieval

### Frontend

- repo submission flow
- issue list rendering
- diff preview rendering
- error and loading states

### End-to-end

- one sample public repo
- one analysis request
- one drill-down request
- one fix preview
- optional one PR creation flow

## 14. Delivery Order

If time is tight, build in this order:

1. Analysis service with one clean repo summary response.
2. Eliza `ANALYSE_REPO` action.
3. Basic frontend with repo input, summary, and diff preview.
4. File drill-down and conversational follow-up.
5. PR creation.
6. Stretch improvements.

This order gives a convincing demo early and avoids spending too much time on risky automation before the core loop works.

## 15. Immediate Next Tasks

1. Scaffold `analysis-service/` and define the Pydantic schemas.
2. Implement the GitHub fetcher and Python file filter.
3. Build `repo_analyzer.py` that combines:
   - dead code
   - architecture
   - duplication
   - performance
   - type hints
4. Add `/analyze/repo` and return normalized JSON.
5. Add the custom Eliza Misoki plugin in `agent-challenge/src/plugins/misoki`.
6. Wire the frontend to the analysis endpoint and render the issue summary.

## 16. Success Criteria For The Challenge

The project is successful if the demo can show:

1. A user pastes a GitHub repo URL.
2. The agent analyzes the repo and explains the biggest issues.
3. The UI highlights the affected files and severities.
4. The user can preview a fix as a real diff.
5. The system clearly demonstrates reuse of your existing `ohm-mcp` expertise in a productized ElizaOS workflow.

That is the smallest version that is both technically credible and aligned with the challenge theme.
