from __future__ import annotations


PREFERRED_DIRS = (
    "src/",
    "app/",
    "lib/",
    "package/",
)

DEPRIORITIZED_DIRS = (
    "docs/",
    "doc/",
    "tests/",
    "test/",
    "examples/",
    "example/",
    "benchmarks/",
    "scripts/",
)

DEPRIORITIZED_FILES = {
    "conf.py",
    "conftest.py",
    "setup.py",
    "__main__.py",
}


def python_file_priority(path: str) -> tuple[int, int, str]:
    normalized = path.strip("/")
    depth = normalized.count("/")
    score = 0

    if any(normalized.startswith(prefix) for prefix in PREFERRED_DIRS):
        score -= 20

    if any(normalized.startswith(prefix) for prefix in DEPRIORITIZED_DIRS):
        score += 30

    filename = normalized.split("/")[-1]
    if filename in DEPRIORITIZED_FILES:
        score += 20

    # Package entrypoints are important, but they are usually poor first-pass
    # analysis targets compared with concrete implementation modules.
    if filename == "__init__.py":
        score += 25

    if "/tests/" in f"/{normalized}/" or normalized.startswith("tests/"):
        score += 15

    if filename.startswith("test_"):
        score += 20

    return (score, depth, normalized)
