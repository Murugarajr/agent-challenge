from __future__ import annotations

from app.core.path_priority import python_file_priority


def test_src_files_ranked_before_test_files():
    src_score = python_file_priority("src/app/service.py")
    test_score = python_file_priority("tests/test_service.py")
    assert src_score < test_score


def test_preferred_dirs_get_lower_score():
    preferred = python_file_priority("src/main.py")
    plain = python_file_priority("utils/helpers.py")
    assert preferred[0] < plain[0]


def test_deprioritized_dirs_get_higher_score():
    docs = python_file_priority("docs/conf.py")
    src = python_file_priority("src/core.py")
    assert docs[0] > src[0]


def test_init_files_are_deprioritized():
    init = python_file_priority("src/__init__.py")
    module = python_file_priority("src/models.py")
    assert init[0] > module[0]


def test_conftest_is_deprioritized():
    conftest = python_file_priority("tests/conftest.py")
    regular = python_file_priority("tests/helpers.py")
    assert conftest[0] > regular[0]


def test_test_prefixed_files_deprioritized():
    test_file = python_file_priority("test_something.py")
    regular = python_file_priority("something.py")
    assert test_file[0] > regular[0]


def test_deeper_files_sorted_after_shallower():
    shallow = python_file_priority("src/main.py")
    deep = python_file_priority("src/sub/deep/main.py")
    # Same score bucket -> depth breaks the tie
    assert shallow <= deep


def test_return_type_is_tuple():
    result = python_file_priority("app/models.py")
    assert isinstance(result, tuple)
    assert len(result) == 3
