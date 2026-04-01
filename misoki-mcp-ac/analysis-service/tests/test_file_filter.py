from __future__ import annotations

from app.core.file_filter import PythonFileFilter
from app.core.github_fetcher import RepoFile


def _rf(path: str, size: int = 100, content: str = "") -> RepoFile:
    return RepoFile(path=path, content=content or f"# {path}", size=size)


def test_selects_only_python_files():
    filt = PythonFileFilter(max_file_bytes=50_000)
    files = [_rf("main.py"), _rf("readme.md"), _rf("app.js"), _rf("utils.py")]
    result = filt.select_files(files, max_files=10)
    assert [f.path for f in result.selected_files] == ["main.py", "utils.py"]
    assert result.total_python_files == 2
    assert result.skipped_files == 0


def test_respects_max_files():
    filt = PythonFileFilter(max_file_bytes=50_000)
    files = [_rf(f"file{i}.py") for i in range(10)]
    result = filt.select_files(files, max_files=3)
    assert len(result.selected_files) == 3
    assert result.skipped_files == 7
    assert result.total_python_files == 10


def test_skips_oversized_files():
    filt = PythonFileFilter(max_file_bytes=500)
    files = [_rf("small.py", size=100), _rf("huge.py", size=1000)]
    result = filt.select_files(files, max_files=10)
    assert len(result.selected_files) == 1
    assert result.selected_files[0].path == "small.py"


def test_empty_input():
    filt = PythonFileFilter(max_file_bytes=50_000)
    result = filt.select_files([], max_files=10)
    assert result.selected_files == []
    assert result.skipped_files == 0
    assert result.total_python_files == 0


def test_prioritizes_src_over_tests():
    filt = PythonFileFilter(max_file_bytes=50_000)
    files = [_rf("tests/test_foo.py"), _rf("src/foo.py")]
    result = filt.select_files(files, max_files=10)
    assert result.selected_files[0].path == "src/foo.py"
