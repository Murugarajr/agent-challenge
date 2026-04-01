from __future__ import annotations

from app.core.issue_mapper import IssueMapper


def make_mapper() -> IssueMapper:
    return IssueMapper()


# ── Severity mapping ──────────────────────────────────────────────────

def test_severity_high_maps_to_critical():
    m = make_mapper()
    issue = m.map_issue({"type": "god_object", "severity": "high", "line": 1}, "architecture", "app.py")
    assert issue.severity == "critical"


def test_severity_medium_maps_to_warning():
    m = make_mapper()
    issue = m.map_issue({"type": "perf", "severity": "medium", "line": 5}, "performance", "app.py")
    assert issue.severity == "warning"


def test_severity_low_maps_to_info():
    m = make_mapper()
    issue = m.map_issue({"type": "naming", "severity": "low", "line": 10}, "code_quality", "app.py")
    assert issue.severity == "info"


def test_unknown_severity_defaults_to_info():
    m = make_mapper()
    issue = m.map_issue({"type": "mystery", "severity": "unknown_level"}, "misc", "app.py")
    assert issue.severity == "info"


# ── fix_id generation ─────────────────────────────────────────────────

def test_fix_id_format():
    m = make_mapper()
    issue = m.map_issue({"type": "unused_import", "severity": "low", "line": 3}, "dead_code", "src/main.py")
    assert issue.fix_id == "dead_code:src/main.py:3:unused_import"


def test_fix_id_missing_line():
    m = make_mapper()
    issue = m.map_issue({"type": "some_issue", "severity": "low"}, "perf", "app.py")
    assert issue.fix_id == "perf:app.py:0:some_issue"


# ── Fixable flag ──────────────────────────────────────────────────────

def test_unused_import_is_fixable():
    m = make_mapper()
    issue = m.map_issue({"type": "unused_import", "severity": "low", "line": 1}, "dead_code", "a.py")
    assert issue.fixable is True


def test_unused_variable_is_fixable():
    m = make_mapper()
    issue = m.map_issue({"type": "unused_variable", "severity": "low", "line": 5}, "dead_code", "a.py")
    assert issue.fixable is True


def test_god_object_is_not_fixable():
    m = make_mapper()
    issue = m.map_issue({"type": "god_object", "severity": "high", "line": 1}, "architecture", "a.py")
    assert issue.fixable is False


# ── Suppression rules ─────────────────────────────────────────────────

def test_suppresses_future_import():
    m = make_mapper()
    raw = [{"type": "unused_import", "severity": "low", "line": 1,
            "import_statement": "from __future__ import annotations", "name": "annotations"}]
    mapped = m.map_many(raw, "dead_code", "app.py")
    assert len(mapped) == 0


def test_does_not_suppress_regular_import():
    m = make_mapper()
    raw = [{"type": "unused_import", "severity": "low", "line": 3,
            "import_statement": "import os", "name": "os"}]
    mapped = m.map_many(raw, "dead_code", "app.py")
    assert len(mapped) == 1


def test_suppresses_init_reexport():
    m = make_mapper()
    raw = [{"type": "unused_import", "severity": "low", "line": 1,
            "import_statement": "from .models import User", "name": "User", "module": "models"}]
    mapped = m.map_many(raw, "dead_code", "__init__.py")
    assert len(mapped) == 0


def test_does_not_suppress_init_reexport_in_regular_file():
    m = make_mapper()
    raw = [{"type": "unused_import", "severity": "low", "line": 1,
            "import_statement": "from .models import User", "name": "User", "module": "models"}]
    mapped = m.map_many(raw, "dead_code", "app.py")
    assert len(mapped) == 1


def test_suppresses_class_method_reported_as_unused_function():
    m = make_mapper()
    source = "class Foo:\n    def bar(self):\n        pass\n"
    raw = [{"type": "unused_function", "severity": "low", "line": 2, "function": "bar"}]
    mapped = m.map_many(raw, "dead_code", "models.py", source_code=source)
    assert len(mapped) == 0


def test_does_not_suppress_top_level_unused_function():
    m = make_mapper()
    source = "def bar():\n    pass\n"
    raw = [{"type": "unused_function", "severity": "low", "line": 1, "function": "bar"}]
    mapped = m.map_many(raw, "dead_code", "utils.py", source_code=source)
    assert len(mapped) == 1


# ── Line extraction ───────────────────────────────────────────────────

def test_extracts_line_from_location_string():
    m = make_mapper()
    issue = m.map_issue({"type": "x", "severity": "low", "location": "at line 42"}, "misc", "a.py")
    assert issue.line == 42


# ── Title and details ─────────────────────────────────────────────────

def test_title_uses_description_when_short():
    m = make_mapper()
    issue = m.map_issue({"type": "x", "severity": "low", "description": "Short desc"}, "misc", "a.py")
    assert issue.title == "Short desc"


def test_title_falls_back_to_type_when_description_too_long():
    m = make_mapper()
    long_desc = "A" * 100
    issue = m.map_issue({"type": "my_issue", "severity": "low", "description": long_desc}, "misc", "a.py")
    assert issue.title == "My Issue"


# ── Type hint mapping ─────────────────────────────────────────────────

def test_type_hint_issue_warning_below_50_percent():
    m = make_mapper()
    issue = m.map_type_hint_issue("app.py", "process", 10, coverage_percent=30.0)
    assert issue.severity == "warning"
    assert issue.category == "type_hints"
    assert "process" in issue.title


def test_type_hint_issue_info_above_50_percent():
    m = make_mapper()
    issue = m.map_type_hint_issue("app.py", "process", 10, coverage_percent=75.0)
    assert issue.severity == "info"


# ── Duplication mapping ───────────────────────────────────────────────

def test_map_duplication_duplicate_function():
    m = make_mapper()
    dup = {
        "type": "duplicate_function",
        "functions": [{"file": "a.py", "line": 10}, {"file": "b.py", "line": 20}],
        "recommendation": "Consolidate",
    }
    issue = m.map_duplication_issue(dup)
    assert issue.category == "duplication"
    assert issue.file == "a.py"
    assert issue.fixable is False


def test_map_duplication_exact_duplicate():
    m = make_mapper()
    dup = {
        "type": "exact_duplicate",
        "locations": [{"file": "x.py", "start_line": 5}, {"file": "y.py", "start_line": 15}],
        "recommendation": "Remove one copy",
    }
    issue = m.map_duplication_issue(dup)
    assert issue.category == "duplication"
    assert issue.line == 5
