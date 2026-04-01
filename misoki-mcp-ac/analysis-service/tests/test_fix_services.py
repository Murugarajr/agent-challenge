"""Tests for FixPreviewService and ApplyFixService internal methods.

These tests exercise the pure transformation logic (import removal,
variable rewriting, fix_id parsing) without making any HTTP calls.
"""
from __future__ import annotations

import pytest

from app.services.fix_preview_service import FixPreviewService
from app.services.apply_fix_service import ApplyFixService
from app.settings import Settings


def _settings() -> Settings:
    return Settings(
        github_api_base="https://api.github.com",
        request_timeout_seconds=10,
        max_file_bytes=200_000,
        max_repo_files=40,
        max_concurrent_file_fetches=5,
        ohm_mcp_src_path=None,
        verify_ssl=True,
        github_token=None,
    )


# ── Fix ID parsing ────────────────────────────────────────────────────

class TestFixIdParsing:
    def test_valid_fix_id(self):
        svc = FixPreviewService(_settings())
        parsed = svc._parse_fix_id("dead_code:src/main.py:3:unused_import")
        assert parsed.category == "dead_code"
        assert parsed.file_path == "src/main.py"
        assert parsed.line == 3
        assert parsed.source_type == "unused_import"

    def test_fix_id_with_colon_in_path(self):
        svc = FixPreviewService(_settings())
        parsed = svc._parse_fix_id("dead_code:C:/src/main.py:3:unused_import")
        assert parsed.file_path == "C:/src/main.py"
        assert parsed.line == 3

    def test_invalid_fix_id_too_few_parts(self):
        svc = FixPreviewService(_settings())
        with pytest.raises(ValueError, match="fix_id is invalid"):
            svc._parse_fix_id("bad:id")

    def test_invalid_fix_id_non_numeric_line(self):
        svc = FixPreviewService(_settings())
        with pytest.raises(ValueError, match="line component"):
            svc._parse_fix_id("dead_code:app.py:xyz:unused_import")


# ── Import removal ────────────────────────────────────────────────────

class TestRemoveImportLine:
    def test_removes_import_line(self):
        svc = FixPreviewService(_settings())
        content = "import os\nimport sys\nprint('hello')\n"
        result = svc._remove_import_line(content, 1)
        assert "import os" not in result
        assert "import sys" in result

    def test_removes_from_import(self):
        svc = FixPreviewService(_settings())
        content = "from os import path\nx = 1\n"
        result = svc._remove_import_line(content, 1)
        assert "from os" not in result
        assert "x = 1" in result

    def test_rejects_non_import_line(self):
        svc = FixPreviewService(_settings())
        content = "x = 1\nimport os\n"
        with pytest.raises(ValueError, match="not an import"):
            svc._remove_import_line(content, 1)

    def test_rejects_line_out_of_range(self):
        svc = FixPreviewService(_settings())
        content = "import os\n"
        with pytest.raises(ValueError, match="outside the file"):
            svc._remove_import_line(content, 5)


# ── Variable rewrite ──────────────────────────────────────────────────

class TestRewriteUnusedVariable:
    def test_rewrites_simple_assignment(self):
        svc = FixPreviewService(_settings())
        content = "x = compute()\nprint('done')\n"
        result = svc._rewrite_unused_variable(content, 1)
        assert "_ = compute()" in result
        assert "x = compute()" not in result

    def test_preserves_indentation(self):
        svc = FixPreviewService(_settings())
        content = "def f():\n    result = 42\n    pass\n"
        result = svc._rewrite_unused_variable(content, 2)
        assert "    _ = 42" in result

    def test_rejects_non_assignment(self):
        svc = FixPreviewService(_settings())
        content = "print('hello')\n"
        with pytest.raises(ValueError, match="not a simple assignment"):
            svc._rewrite_unused_variable(content, 1)


# ── Apply service fix_id parsing ──────────────────────────────────────

class TestApplyServiceParsing:
    def test_parse_includes_original_fix_id(self):
        svc = ApplyFixService(_settings())
        parsed = svc._parse_fix_id("dead_code:app.py:10:unused_import")
        assert parsed.fix_id == "dead_code:app.py:10:unused_import"
        assert parsed.category == "dead_code"
        assert parsed.file_path == "app.py"
        assert parsed.line == 10
        assert parsed.source_type == "unused_import"
