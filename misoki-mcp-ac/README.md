Architecture Overview
The agent uses a 3-tier architecture: an ElizaOS TypeScript agent (orchestration + UI), a Python FastAPI microservice (AST analysis engine from your ohm-mcp-refactor expertise), and a React/Next.js frontend — all containerised and deployed on Nosana's GPU network.

┌──────────────────────────────────────────── ─┐
│         React Frontend (Custom UI)           │
│   Repo input → Chat interface → Diff viewer  │
└────────────────────┬──────────────────────── ┘
                     │ REST/WebSocket
┌────────────────────▼────────────────────────┐
│        ElizaOS Agent (TypeScript)           │
│  Orchestration · Memory · GitHub Plugin     │
│  Qwen3.5-27B-AWQ model (Nosana endpoint)    │
└───────────┬─────────────────────────────────┘
            │ Internal HTTP
┌───────────▼─────────────────────────────────┐
│     Python FastAPI AST Analyser             │
│  (your ohm-mcp-refactor logic repackaged)   │
│  AST parsing · Smell detection · Diff gen   │
└─────────────────────────────────────────────┘

Phase 1 — Python AST Microservice
This is where your existing ohm-mcp-refactor codebase becomes the core engine.

File structure:
/ast-service/
  main.py          # FastAPI app
  analyser.py      # AST analysis (port from ohm-mcp-refactor)
  refactor.py      # Auto-fix generation
  diff_gen.py      # Unified diff output
  Dockerfile

main.py — FastAPI endpoints:

from fastapi import FastAPI
from pydantic import BaseModel
import httpx, base64

app = FastAPI()

class RepoRequest(BaseModel):
    github_url: str
    branch: str = "main"
    max_files: int = 20

@app.post("/analyse")
async def analyse_repo(req: RepoRequest):
    files = await fetch_repo_files(req.github_url, req.branch, req.max_files)
    results = []
    for file in files:
        if file["name"].endswith(".py"):
            smells = analyser.detect_smells(file["content"])
            if smells:
                results.append({
                    "file": file["path"],
                    "smells": smells,
                    "diff": refactor.generate_diff(file["content"], smells)
                })
    return {"repo": req.github_url, "issues": results, "total": len(results)}

@app.post("/apply-fix")
async def apply_fix(file_path: str, content: str, smell_type: str):
    fixed = refactor.apply(content, smell_type)
    return {"original": content, "fixed": fixed, 
            "diff": diff_gen.unified_diff(content, fixed)}


analyser.py — Code smell detection (AST-powered):

import ast
from dataclasses import dataclass

@dataclass
class CodeSmell:
    type: str
    line: int
    message: str
    severity: str  # "critical" | "warning" | "info"

def detect_smells(source: str) -> list[CodeSmell]:
    tree = ast.parse(source)
    smells = []
    
    for node in ast.walk(tree):
        # Long methods
        if isinstance(node, ast.FunctionDef):
            lines = node.end_lineno - node.lineno
            if lines > 30:
                smells.append(CodeSmell("long_method", node.lineno,
                    f"Function '{node.name}' is {lines} lines (>30)", "warning"))
        
        # Too many parameters
        if isinstance(node, ast.FunctionDef):
            if len(node.args.args) > 5:
                smells.append(CodeSmell("too_many_params", node.lineno,
                    f"'{node.name}' has {len(node.args.args)} params (>5)", "warning"))
        
        # Deep nesting
        if isinstance(node, (ast.If, ast.For, ast.While)):
            depth = get_nesting_depth(node)
            if depth > 3:
                smells.append(CodeSmell("deep_nesting", node.lineno,
                    f"Nesting depth {depth} (>3)", "critical"))
        
        # God class detection
        if isinstance(node, ast.ClassDef):
            methods = [n for n in ast.walk(node) if isinstance(n, ast.FunctionDef)]
            if len(methods) > 15:
                smells.append(CodeSmell("god_class", node.lineno,
                    f"Class '{node.name}' has {len(methods)} methods (>15)", "critical"))
    
    return smells

Phase 2 — ElizaOS Agent (TypeScript)
Fork the challenge starter repo, then build your agent character and custom plugin.

src/character.ts — Agent personality:
import { Character, ModelProviderName } from "@elizaos/core";

export const refactorAgent: Character = {
  name: "RefactorBot",
  username: "refactorbot",
  modelProvider: ModelProviderName.OPENAI,  // points to Nosana endpoint
  bio: [
    "I'm an expert Python code refactoring assistant.",
    "I analyse GitHub repositories, detect code smells using AST analysis,",
    "and generate actionable diffs to improve code quality.",
  ],
  system: `You are RefactorBot. When given a GitHub URL, call the analyse_repo 
  action to run AST analysis. Present findings clearly: list each file, 
  its issues (severity, line number, description), and show diffs. 
  Always ask if the user wants to apply fixes via a PR.`,
  plugins: ["@elizaos/plugin-github", "./plugins/refactor-plugin"],
  settings: {
    secrets: {},
    voice: { model: "en_US-male-medium" }
  }
};

src/plugins/refactor-plugin/index.ts — Custom actions:

import { Action, IAgentRuntime, Memory, State } from "@elizaos/core";
import axios from "axios";

const AST_SERVICE_URL = process.env.AST_SERVICE_URL || "http://localhost:8000";

export const analyseRepoAction: Action = {
  name: "ANALYSE_REPO",
  similes: ["REFACTOR", "CHECK_CODE", "ANALYSE_CODE", "REVIEW_REPO"],
  description: "Analyse a GitHub repository for code smells using AST analysis",
  
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const githubUrlRegex = /github\.com\/[\w-]+\/[\w-]+/;
    return githubUrlRegex.test(message.content.text);
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const urlMatch = message.content.text.match(
      /https?:\/\/github\.com\/[\w-]+\/[\w-]+/
    );
    if (!urlMatch) return false;
    
    const githubUrl = urlMatch[0];
    
    // Call Python AST microservice
    const response = await axios.post(`${AST_SERVICE_URL}/analyse`, {
      github_url: githubUrl,
      max_files: 20
    });
    
    const { issues, total } = response.data;
    
    // Store in ElizaOS memory for follow-up
    await runtime.messageManager.createMemory({
      id: `analysis-${Date.now()}`,
      content: { text: JSON.stringify(response.data), action: "ANALYSIS_RESULT" },
      roomId: message.roomId,
      userId: message.userId,
      agentId: runtime.agentId
    });
    
    // Format response for LLM to narrate
    return `Found ${total} issues across ${issues.length} files in ${githubUrl}. 
    Critical issues: ${issues.filter(i => 
      i.smells.some(s => s.severity === "critical")).length} files.
    Issues data: ${JSON.stringify(issues.slice(0, 5))}`;
  }
};

export const createPRAction: Action = {
  name: "CREATE_PR",
  similes: ["APPLY_FIX", "OPEN_PR", "SUBMIT_FIX"],
  description: "Apply refactoring fixes and create a GitHub Pull Request",
  
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    // Uses @elizaos/plugin-github to create PRs with fixes
    const octokit = runtime.getService("github");
    // ... create branch, apply diffs, open PR
  }
};

Phase 3 — React Frontend (Custom UI)
The challenge requires a custom UI. Build a focused diff-viewer interface.

Key components:

/frontend/
  src/
    components/
      RepoInput.tsx       # GitHub URL input + analyse button
      SmellDashboard.tsx  # Summary cards (total smells by severity)
      FileTree.tsx        # List of affected files
      DiffViewer.tsx      # Monaco editor with diff highlighting
      ChatPanel.tsx       # ElizaOS agent chat interface
    App.tsx

DiffViewer.tsx — Monaco diff editor:

import { DiffEditor } from "@monaco-editor/react";

export function DiffViewer({ original, modified, filename }) {
  return (
    <div className="diff-viewer">
      <h3>{filename}</h3>
      <DiffEditor
        height="400px"
        language="python"
        original={original}
        modified={modified}
        theme="vs-dark"
        options={{ readOnly: true, renderSideBySide: true }}
      />
      <button onClick={() => applyFix(filename)}>
        ✅ Apply Fix & Create PR
      </button>
    </div>
  );
}

Phase 4 — Docker & Nosana Deployment
All three services must be containerised and deployed to Nosana.

docker-compose.yml:

version: "3.9"
services:
  ast-service:
    build: ./ast-service
    ports: ["8000:8000"]
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}

  eliza-agent:
    build: ./agent
    ports: ["3000:3000"]
    environment:
      - AST_SERVICE_URL=http://ast-service:8000
      - OPENAI_BASE_URL=${NOSANA_MODEL_ENDPOINT}
      - OPENAI_API_KEY=${NOSANA_API_KEY}
    depends_on: [ast-service]

  frontend:
    build: ./frontend
    ports: ["8080:80"]
    environment:
      - VITE_AGENT_URL=http://eliza-agent:3000

 nosana.json — Nosana job definition:     

 {
  "version": "1",
  "type": "container",
  "meta": { "trigger": "api" },
  "ops": [{
    "type": "container/run",
    "id": "refactor-agent",
    "args": {
      "image": "your-dockerhub/refactor-agent:latest",
      "gpu": true,
      "expose": 8080,
      "env": {
        "NOSANA_MODEL_ENDPOINT": "{{ secrets.NOSANA_MODEL_ENDPOINT }}",
        "GITHUB_TOKEN": "{{ secrets.GITHUB_TOKEN }}"
      }
    }
  }]
}