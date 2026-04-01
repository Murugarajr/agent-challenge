# Misoki Analysis Service — API Contract

Base URL: `http://localhost:8000` (local) or `http://analysis-service:8000` (Docker)

## `GET /health`

Returns readiness and dependency status.

**Response `200`**

```json
{
  "status": "ok",
  "service": "misoki-analysis-service",
  "ohm_mcp_src": "/path/to/ohm-mcp/src"
}
```

---

## `POST /analyze/repo`

Analyze a public GitHub Python repository for code quality issues.

**Request body**

| Field                | Type       | Required | Default                                                        | Description                          |
| -------------------- | ---------- | -------- | -------------------------------------------------------------- | ------------------------------------ |
| `github_url`         | string     | yes      |                                                                | Public GitHub repo URL               |
| `branch`             | string     | no       | repo's default branch                                          | Branch to analyze                    |
| `max_files`          | int (1–200)| no       | 40                                                             | Max Python files to scan             |
| `include_categories` | string[]   | no       | `["architecture","dead_code","duplication","performance","type_hints"]` | Analysis categories to run |

```json
{
  "github_url": "https://github.com/pallets/flask",
  "branch": "main",
  "max_files": 20,
  "include_categories": ["dead_code", "architecture"]
}
```

**Response `200`**

```json
{
  "repo": "https://github.com/pallets/flask",
  "branch": "main",
  "commit": "abc1234...",
  "files_scanned": 15,
  "skipped_files": 3,
  "categories": {
    "architecture": 2,
    "dead_code": 5
  },
  "summary": {
    "critical": 1,
    "warning": 4,
    "info": 2
  },
  "issues": [
    {
      "file": "src/flask/app.py",
      "category": "dead_code",
      "severity": "warning",
      "title": "Unused imports detected",
      "details": "import os is imported but never used.",
      "line": 3,
      "fixable": true,
      "fix_id": "dead_code:src/flask/app.py:3:unused_import",
      "source_type": "unused_import"
    }
  ]
}
```

**Errors**

| Code | Reason                        |
| ---- | ----------------------------- |
| 400  | Invalid GitHub URL            |
| 422  | Missing or invalid fields     |
| 502  | GitHub API unreachable        |
| 500  | Internal analysis error       |

---

## `POST /preview/fix`

Preview a single fix as a unified diff.

**Request body**

| Field        | Type   | Required | Description                           |
| ------------ | ------ | -------- | ------------------------------------- |
| `github_url` | string | yes      | Same repo URL used during analysis    |
| `fix_id`     | string | yes      | Fix ID from the analysis result       |
| `branch`     | string | no       | Branch (defaults to repo default)     |

```json
{
  "github_url": "https://github.com/pallets/flask",
  "fix_id": "dead_code:src/flask/app.py:3:unused_import",
  "branch": "main"
}
```

**Response `200`**

```json
{
  "file": "src/flask/app.py",
  "line": 3,
  "source_type": "unused_import",
  "risk": "low",
  "supported": true,
  "message": "Preview generated for unused import removal.",
  "original": "import os\nimport sys\n...",
  "modified": "import sys\n...",
  "diff": "--- a/src/flask/app.py\n+++ b/src/flask/app.py\n@@ ... @@\n-import os\n"
}
```

When preview is not supported for a fix type:

```json
{
  "supported": false,
  "risk": "medium",
  "message": "Preview is not implemented yet for 'god_object'.",
  "diff": ""
}
```

**Errors**

| Code | Reason                                |
| ---- | ------------------------------------- |
| 400  | Invalid fix_id format or bad URL      |
| 502  | GitHub API unreachable                |
| 500  | Internal error                        |

---

## `POST /apply/fixes`

Apply one or more low-risk fixes and return patched file contents with diffs.

**Request body**

| Field        | Type     | Required | Description                                |
| ------------ | -------- | -------- | ------------------------------------------ |
| `github_url` | string   | yes      | Same repo URL                              |
| `fix_ids`    | string[] | yes      | One or more fix IDs (min 1)                |
| `branch`     | string   | no       | Branch (defaults to repo default)          |

```json
{
  "github_url": "https://github.com/pallets/flask",
  "fix_ids": [
    "dead_code:src/flask/app.py:3:unused_import",
    "dead_code:src/flask/helpers.py:12:unused_variable"
  ]
}
```

**Response `200`**

```json
{
  "repo": "https://github.com/pallets/flask",
  "branch": "main",
  "applied_count": 1,
  "skipped_count": 1,
  "applied_fix_ids": ["dead_code:src/flask/app.py:3:unused_import"],
  "applied": [
    {
      "fix_id": "dead_code:src/flask/app.py:3:unused_import",
      "file": "src/flask/app.py",
      "line": 3,
      "source_type": "unused_import",
      "applied": true,
      "risk": "low",
      "message": "Applied unused import removal."
    }
  ],
  "skipped": [
    {
      "fix_id": "dead_code:src/flask/helpers.py:12:unused_variable",
      "file": "src/flask/helpers.py",
      "line": 12,
      "source_type": "unused_variable",
      "reason": "target line is not a simple assignment suitable for safe rewrite"
    }
  ],
  "files": [
    {
      "file": "src/flask/app.py",
      "applied_fix_ids": ["dead_code:src/flask/app.py:3:unused_import"],
      "original": "...",
      "modified": "...",
      "diff": "--- a/src/flask/app.py\n+++ b/src/flask/app.py\n..."
    }
  ],
  "combined_diff": "--- a/src/flask/app.py\n+++ b/src/flask/app.py\n..."
}
```

**Errors**

| Code | Reason                        |
| ---- | ----------------------------- |
| 400  | Invalid fix_id format         |
| 422  | Empty fix_ids list            |
| 502  | GitHub API unreachable        |
| 500  | Internal error                |

---

## Fix ID Convention

Format: `{category}:{file_path}:{line}:{source_type}`

Examples:
- `dead_code:src/app.py:3:unused_import`
- `type_hints:lib/utils.py:15:missing_type_hints`
- `duplication:models/user.py:42:exact_duplicate`

Supported fix types for preview and apply: `unused_import`, `unused_variable`.

## Severity Levels

| Upstream value | Mapped to  |
| -------------- | ---------- |
| high           | critical   |
| medium         | warning    |
| low            | info       |

## Analysis Categories

- `architecture` — god objects, SOLID violations, circular dependencies
- `dead_code` — unused imports, variables, functions, unreachable code
- `duplication` — exact duplicates, similar functions
- `performance` — inefficient patterns, hotspots
- `type_hints` — missing type annotations, coverage gaps
- `code_quality` — general code smell detection
