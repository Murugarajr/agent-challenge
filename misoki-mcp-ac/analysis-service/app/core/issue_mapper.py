from __future__ import annotations

import ast
import re
from pathlib import PurePosixPath
from dataclasses import asdict

from app.schemas.analyze import AnalysisIssue


SEVERITY_MAP = {
    "high": "critical",
    "medium": "warning",
    "low": "info",
    "critical": "critical",
    "warning": "warning",
    "info": "info",
}

# Only types that have a concrete safe-apply implementation in apply_fix_service.py.
# Do NOT add types here unless apply_fix_service._apply_<type> is implemented.
SAFE_FIX_TYPES = {
    "unused_import",
    "unused_variable",
}

LINE_RE = re.compile(r"line[s]?\s+(?P<line>\d+)")


class IssueMapper:
    def map_issue(self, raw_issue: dict, category: str, file_path: str) -> AnalysisIssue:
        issue_type = raw_issue.get("type", "unknown_issue")
        line = self._extract_line(raw_issue)
        severity = SEVERITY_MAP.get(str(raw_issue.get("severity", "low")).lower(), "info")
        title = self._build_title(issue_type, raw_issue)
        details = self._build_details(raw_issue)
        fixable = issue_type in SAFE_FIX_TYPES
        fix_id = f"{category}:{file_path}:{line or 0}:{issue_type}"

        return AnalysisIssue(
            file=file_path,
            category=category,
            severity=severity,
            title=title,
            details=details,
            line=line,
            fixable=fixable,
            fix_id=fix_id,
            source_type=issue_type,
        )

    def map_many(
        self,
        raw_issues: list[dict],
        category: str,
        file_path: str,
        source_code: str | None = None,
    ) -> list[AnalysisIssue]:
        tree = self._parse_tree(source_code) if source_code else None
        mapped: list[AnalysisIssue] = []
        for raw_issue in raw_issues:
            if self._should_suppress_issue(raw_issue, file_path, tree):
                continue
            mapped.append(self.map_issue(raw_issue, category=category, file_path=file_path))
        return mapped

    def map_duplication_issue(self, duplicate: dict) -> AnalysisIssue:
        duplicate_type = duplicate.get("type", "duplication")
        if duplicate_type == "duplicate_function":
            first = duplicate["functions"][0]
            file_path = first["file"]
            line = first.get("line")
            details = duplicate.get("recommendation", "Similar functions detected")
        else:
            first = duplicate["locations"][0]
            file_path = first["file"]
            line = first.get("start_line")
            details = duplicate.get("recommendation", "Duplicate code detected")

        return AnalysisIssue(
            file=file_path,
            category="duplication",
            severity="warning",
            title=self._build_title(duplicate_type, duplicate),
            details=details,
            line=line,
            fixable=False,
            fix_id=f"duplication:{file_path}:{line or 0}:{duplicate_type}",
            source_type=duplicate_type,
        )

    def map_type_hint_issue(self, file_path: str, function_name: str, line: int, coverage_percent: float) -> AnalysisIssue:
        severity = "warning" if coverage_percent < 50 else "info"
        return AnalysisIssue(
            file=file_path,
            category="type_hints",
            severity=severity,
            title=f"Missing type hints in {function_name}",
            details=(
                f"Function '{function_name}' is missing type annotations. "
                f"File coverage is {coverage_percent:.2f}%."
            ),
            line=line,
            fixable=False,
            fix_id=f"type_hints:{file_path}:{line}:missing_type_hints",
            source_type="missing_type_hints",
        )

    def _extract_line(self, raw_issue: dict) -> int | None:
        if "line" in raw_issue and isinstance(raw_issue["line"], int):
            return raw_issue["line"]

        location = str(raw_issue.get("location", ""))
        match = LINE_RE.search(location)
        if match:
            return int(match.group("line"))
        return None

    def _build_title(self, issue_type: str, raw_issue: dict) -> str:
        description = raw_issue.get("description")
        if description and len(description) <= 80:
            return description
        return issue_type.replace("_", " ").title()

    def _build_details(self, raw_issue: dict) -> str:
        description = str(raw_issue.get("description", "")).strip()
        recommendation = str(raw_issue.get("recommendation", "")).strip()

        if description and recommendation:
            return f"{description} Recommendation: {recommendation}"
        if description:
            return description
        if recommendation:
            return recommendation
        return str(asdict(raw_issue)) if hasattr(raw_issue, "__dict__") else "No additional details available."

    def _should_suppress_issue(self, raw_issue: dict, file_path: str, tree: ast.AST | None) -> bool:
        issue_type = raw_issue.get("type")
        if issue_type == "unused_import":
            if self._is_future_import(raw_issue):
                return True

            if PurePosixPath(file_path).name == "__init__.py" and self._looks_like_init_reexport(raw_issue):
                return True

        if issue_type == "unused_function" and tree is not None:
            line = self._extract_line(raw_issue)
            function_name = str(raw_issue.get("function", "")).strip()
            if line is not None and function_name and self._is_class_method(tree, function_name, line):
                return True

        return False

    def _is_future_import(self, raw_issue: dict) -> bool:
        statement = str(raw_issue.get("import_statement", "")).strip()
        return statement.startswith("from __future__ import ")

    def _parse_tree(self, source_code: str | None) -> ast.AST | None:
        if not source_code:
            return None
        try:
            return ast.parse(source_code)
        except SyntaxError:
            return None

    def _is_class_method(self, tree: ast.AST, function_name: str, line: int) -> bool:
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        if child.name == function_name and child.lineno == line:
                            return True
        return False

    def _looks_like_init_reexport(self, raw_issue: dict) -> bool:
        statement = str(raw_issue.get("import_statement", "")).strip()
        alias = str(raw_issue.get("name", "")).strip()
        module = str(raw_issue.get("module", "")).strip()

        if not statement or not alias:
            return False

        # Common package re-export pattern:
        # from .module import Name as Name
        if f" as {alias}" in statement:
            return True

        if statement.startswith("from ") and " import " in statement:
            imported_part = statement.split(" import ", 1)[1].strip()
            imported_name = imported_part.split(" as ", 1)[0].strip()
            if imported_name == alias:
                return True

        # The upstream detector drops the leading dot from relative imports.
        # In __init__.py files, "module.name" plus alias "name" is commonly a re-export.
        module_leaf = module.split(".")[-1] if module else ""
        if module_leaf and module_leaf == alias:
            return True

        return False
