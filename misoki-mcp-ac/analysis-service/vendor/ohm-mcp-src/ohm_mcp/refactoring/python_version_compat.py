"""
Python Version Compatibility Module for Refactoring Tools.

This module provides version detection and feature support for Python 3.8+ language features:
- Walrus operator (:=) - Python 3.8+
- Match/case statements - Python 3.10+
- Type union syntax (X | Y) - Python 3.10+
- Exception groups (try/except*) - Python 3.11+
- F-string improvements - Python 3.12+

Usage:
    from ohm_mcp.refactoring.python_version_compat import (
        PythonVersion,
        get_python_version,
        supports_walrus_operator,
        supports_match_statement,
        supports_union_type_syntax,
        supports_exception_groups,
        detect_version_specific_features,
    )
    
    # Check current Python version
    version = get_python_version()
    
    # Check feature support
    if supports_match_statement():
        # Handle match/case in AST
        pass
    
    # Detect features in code
    features = detect_version_specific_features(code)
    for feature in features:
        if not feature['supported']:
            print(f"Warning: {feature['name']} requires Python {feature['min_version']}")
"""

import ast
import logging
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple, Any, Union


# Configure logging
logger = logging.getLogger(__name__)


# =============================================================================
# VERSION CONSTANTS
# =============================================================================

# Python version tuple for current runtime
PYTHON_VERSION: Tuple[int, int, int] = sys.version_info[:3]
PYTHON_VERSION_TUPLE: Tuple[int, int] = sys.version_info[:2]

# Minimum versions for language features
MIN_VERSION_WALRUS_OPERATOR = (3, 8)      # PEP 572 - Assignment Expressions
MIN_VERSION_POSITIONAL_ONLY = (3, 8)      # PEP 570 - Positional-Only Parameters
MIN_VERSION_MATCH_STATEMENT = (3, 10)     # PEP 634 - Structural Pattern Matching
MIN_VERSION_UNION_TYPE_SYNTAX = (3, 10)   # PEP 604 - Union Type Syntax (X | Y)
MIN_VERSION_PARENTHESIZED_CTX = (3, 10)   # PEP 617 - Parenthesized Context Managers
MIN_VERSION_EXCEPTION_GROUPS = (3, 11)    # PEP 654 - Exception Groups
MIN_VERSION_EXCEPT_STAR = (3, 11)         # PEP 654 - except* syntax
MIN_VERSION_SELF_TYPE = (3, 11)           # PEP 673 - Self Type
MIN_VERSION_FSTRING_ARBITRARY = (3, 12)   # PEP 701 - F-string improvements
MIN_VERSION_TYPE_PARAM_SYNTAX = (3, 12)   # PEP 695 - Type Parameter Syntax


# =============================================================================
# VERSION DETECTION
# =============================================================================

class PythonVersion(Enum):
    """Enumeration of Python versions with feature support."""
    PY38 = (3, 8)
    PY39 = (3, 9)
    PY310 = (3, 10)
    PY311 = (3, 11)
    PY312 = (3, 12)
    PY313 = (3, 13)
    
    @classmethod
    def from_tuple(cls, version_tuple: Tuple[int, int]) -> Optional['PythonVersion']:
        """Get PythonVersion enum from version tuple."""
        for member in cls:
            if member.value == version_tuple:
                return member
        return None
    
    @classmethod
    def current(cls) -> Optional['PythonVersion']:
        """Get current Python version as enum."""
        return cls.from_tuple(PYTHON_VERSION_TUPLE)
    
    def __ge__(self, other: 'PythonVersion') -> bool:
        return self.value >= other.value
    
    def __gt__(self, other: 'PythonVersion') -> bool:
        return self.value > other.value
    
    def __le__(self, other: 'PythonVersion') -> bool:
        return self.value <= other.value
    
    def __lt__(self, other: 'PythonVersion') -> bool:
        return self.value < other.value


def get_python_version() -> Tuple[int, int, int]:
    """Get the current Python version as a tuple."""
    return PYTHON_VERSION


def get_python_version_string() -> str:
    """Get the current Python version as a string."""
    return f"{PYTHON_VERSION[0]}.{PYTHON_VERSION[1]}.{PYTHON_VERSION[2]}"


def version_at_least(major: int, minor: int) -> bool:
    """Check if current Python version is at least the specified version."""
    return PYTHON_VERSION_TUPLE >= (major, minor)


# =============================================================================
# FEATURE SUPPORT CHECKS
# =============================================================================

def supports_walrus_operator() -> bool:
    """Check if walrus operator (:=) is supported (Python 3.8+)."""
    return version_at_least(*MIN_VERSION_WALRUS_OPERATOR)


def supports_positional_only_params() -> bool:
    """Check if positional-only parameters (/) are supported (Python 3.8+)."""
    return version_at_least(*MIN_VERSION_POSITIONAL_ONLY)


def supports_match_statement() -> bool:
    """Check if match/case statements are supported (Python 3.10+)."""
    return version_at_least(*MIN_VERSION_MATCH_STATEMENT)


def supports_union_type_syntax() -> bool:
    """Check if union type syntax (X | Y) is supported (Python 3.10+)."""
    return version_at_least(*MIN_VERSION_UNION_TYPE_SYNTAX)


def supports_parenthesized_context_managers() -> bool:
    """Check if parenthesized context managers are supported (Python 3.10+)."""
    return version_at_least(*MIN_VERSION_PARENTHESIZED_CTX)


def supports_exception_groups() -> bool:
    """Check if exception groups are supported (Python 3.11+)."""
    return version_at_least(*MIN_VERSION_EXCEPTION_GROUPS)


def supports_except_star() -> bool:
    """Check if except* syntax is supported (Python 3.11+)."""
    return version_at_least(*MIN_VERSION_EXCEPT_STAR)


def supports_self_type() -> bool:
    """Check if Self type is supported (Python 3.11+)."""
    return version_at_least(*MIN_VERSION_SELF_TYPE)


def supports_fstring_arbitrary_expressions() -> bool:
    """Check if arbitrary f-string expressions are supported (Python 3.12+)."""
    return version_at_least(*MIN_VERSION_FSTRING_ARBITRARY)


def supports_type_parameter_syntax() -> bool:
    """Check if type parameter syntax is supported (Python 3.12+)."""
    return version_at_least(*MIN_VERSION_TYPE_PARAM_SYNTAX)


# =============================================================================
# FEATURE INFORMATION
# =============================================================================

@dataclass
class LanguageFeature:
    """Information about a Python language feature."""
    name: str
    description: str
    min_version: Tuple[int, int]
    pep: Optional[str] = None
    ast_node_types: List[str] = field(default_factory=list)
    example: Optional[str] = None
    
    @property
    def supported(self) -> bool:
        """Check if this feature is supported in current Python version."""
        return version_at_least(*self.min_version)
    
    @property
    def min_version_string(self) -> str:
        """Get minimum version as string."""
        return f"{self.min_version[0]}.{self.min_version[1]}"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'name': self.name,
            'description': self.description,
            'min_version': self.min_version_string,
            'pep': self.pep,
            'supported': self.supported,
            'ast_node_types': self.ast_node_types,
            'example': self.example
        }


# Define all tracked language features
LANGUAGE_FEATURES: Dict[str, LanguageFeature] = {
    'walrus_operator': LanguageFeature(
        name='Walrus Operator',
        description='Assignment expressions using := operator',
        min_version=MIN_VERSION_WALRUS_OPERATOR,
        pep='PEP 572',
        ast_node_types=['NamedExpr'],
        example='if (n := len(items)) > 10:'
    ),
    'positional_only_params': LanguageFeature(
        name='Positional-Only Parameters',
        description='Function parameters that can only be passed positionally',
        min_version=MIN_VERSION_POSITIONAL_ONLY,
        pep='PEP 570',
        ast_node_types=['arguments.posonlyargs'],
        example='def func(x, /, y):'
    ),
    'match_statement': LanguageFeature(
        name='Match Statement',
        description='Structural pattern matching with match/case',
        min_version=MIN_VERSION_MATCH_STATEMENT,
        pep='PEP 634',
        ast_node_types=['Match', 'match_case'],
        example='match value:\n    case 1: ...'
    ),
    'union_type_syntax': LanguageFeature(
        name='Union Type Syntax',
        description='Type union using | operator instead of Union[X, Y]',
        min_version=MIN_VERSION_UNION_TYPE_SYNTAX,
        pep='PEP 604',
        ast_node_types=['BinOp with BitOr in annotations'],
        example='def func(x: int | str) -> None:'
    ),
    'exception_groups': LanguageFeature(
        name='Exception Groups',
        description='ExceptionGroup and except* syntax',
        min_version=MIN_VERSION_EXCEPTION_GROUPS,
        pep='PEP 654',
        ast_node_types=['TryStar'],
        example='except* ValueError as eg:'
    ),
    'fstring_arbitrary': LanguageFeature(
        name='F-string Improvements',
        description='Arbitrary expressions in f-strings including nested quotes',
        min_version=MIN_VERSION_FSTRING_ARBITRARY,
        pep='PEP 701',
        ast_node_types=['JoinedStr'],
        example='f"result: {obj["key"]}"'
    ),
    'type_parameter_syntax': LanguageFeature(
        name='Type Parameter Syntax',
        description='Generic type parameter syntax with type keyword',
        min_version=MIN_VERSION_TYPE_PARAM_SYNTAX,
        pep='PEP 695',
        ast_node_types=['TypeAlias', 'TypeVar', 'ParamSpec', 'TypeVarTuple'],
        example='type Point[T] = tuple[T, T]'
    ),
}


def get_feature_info(feature_name: str) -> Optional[LanguageFeature]:
    """Get information about a specific language feature."""
    return LANGUAGE_FEATURES.get(feature_name)


def get_all_features() -> Dict[str, LanguageFeature]:
    """Get all tracked language features."""
    return LANGUAGE_FEATURES.copy()


def get_supported_features() -> Dict[str, LanguageFeature]:
    """Get all features supported by current Python version."""
    return {k: v for k, v in LANGUAGE_FEATURES.items() if v.supported}


def get_unsupported_features() -> Dict[str, LanguageFeature]:
    """Get all features NOT supported by current Python version."""
    return {k: v for k, v in LANGUAGE_FEATURES.items() if not v.supported}


# =============================================================================
# AST NODE TYPE DETECTION
# =============================================================================

def has_ast_node_type(node_type: str) -> bool:
    """Check if an AST node type exists in current Python version."""
    return hasattr(ast, node_type)


def get_available_ast_nodes() -> Set[str]:
    """Get all available AST node types in current Python version."""
    return {name for name in dir(ast) if isinstance(getattr(ast, name), type) 
            and issubclass(getattr(ast, name), ast.AST)}


# =============================================================================
# CODE FEATURE DETECTION
# =============================================================================

@dataclass
class DetectedFeature:
    """A detected language feature in code."""
    feature: LanguageFeature
    line: int
    column: int
    code_snippet: str
    supported: bool
    warning: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'feature_name': self.feature.name,
            'min_version': self.feature.min_version_string,
            'line': self.line,
            'column': self.column,
            'code_snippet': self.code_snippet,
            'supported': self.supported,
            'warning': self.warning
        }


class VersionFeatureDetector:
    """Detect Python version-specific features in code."""
    
    def __init__(self):
        """Initialize the detector."""
        self.detected_features: List[DetectedFeature] = []
    
    def detect_features(self, code: str) -> List[DetectedFeature]:
        """
        Detect all version-specific features in code.
        
        Args:
            code: Python source code to analyze
            
        Returns:
            List of detected features with location and support info
        """
        self.detected_features = []
        lines = code.splitlines()
        
        # Try to parse the code
        try:
            tree = ast.parse(code)
            self._detect_ast_features(tree, lines)
        except SyntaxError as e:
            # If parsing fails, try to detect features from syntax error
            self._detect_from_syntax_error(e, code, lines)
        
        # Also detect features via regex for things AST might miss
        self._detect_regex_features(code, lines)
        
        return self.detected_features
    
    def _detect_ast_features(self, tree: ast.AST, lines: List[str]) -> None:
        """Detect features from AST nodes."""
        for node in ast.walk(tree):
            # Walrus operator (NamedExpr) - Python 3.8+
            if isinstance(node, ast.NamedExpr):
                snippet = lines[node.lineno - 1].strip() if node.lineno <= len(lines) else ''
                self.detected_features.append(DetectedFeature(
                    feature=LANGUAGE_FEATURES['walrus_operator'],
                    line=node.lineno,
                    column=node.col_offset,
                    code_snippet=snippet,
                    supported=supports_walrus_operator(),
                    warning=None if supports_walrus_operator() else 
                            f"Walrus operator requires Python 3.8+"
                ))
            
            # Match statement - Python 3.10+
            if has_ast_node_type('Match') and isinstance(node, getattr(ast, 'Match', type(None))):
                snippet = lines[node.lineno - 1].strip() if node.lineno <= len(lines) else ''
                self.detected_features.append(DetectedFeature(
                    feature=LANGUAGE_FEATURES['match_statement'],
                    line=node.lineno,
                    column=node.col_offset,
                    code_snippet=snippet,
                    supported=supports_match_statement(),
                    warning=None if supports_match_statement() else
                            f"Match statement requires Python 3.10+"
                ))
            
            # Exception groups (TryStar) - Python 3.11+
            if has_ast_node_type('TryStar') and isinstance(node, getattr(ast, 'TryStar', type(None))):
                snippet = lines[node.lineno - 1].strip() if node.lineno <= len(lines) else ''
                self.detected_features.append(DetectedFeature(
                    feature=LANGUAGE_FEATURES['exception_groups'],
                    line=node.lineno,
                    column=node.col_offset,
                    code_snippet=snippet,
                    supported=supports_exception_groups(),
                    warning=None if supports_exception_groups() else
                            f"Exception groups require Python 3.11+"
                ))
            
            # Union type syntax in annotations - Python 3.10+
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
                # Check if this is in an annotation context
                if self._is_in_annotation_context(node, tree):
                    snippet = lines[node.lineno - 1].strip() if node.lineno <= len(lines) else ''
                    self.detected_features.append(DetectedFeature(
                        feature=LANGUAGE_FEATURES['union_type_syntax'],
                        line=node.lineno,
                        column=node.col_offset,
                        code_snippet=snippet,
                        supported=supports_union_type_syntax(),
                        warning=None if supports_union_type_syntax() else
                                f"Union type syntax (X | Y) requires Python 3.10+"
                    ))
            
            # Positional-only parameters - Python 3.8+
            if isinstance(node, ast.arguments) and node.posonlyargs:
                # Find the function this belongs to
                for func_node in ast.walk(tree):
                    if isinstance(func_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        if func_node.args is node:
                            snippet = lines[func_node.lineno - 1].strip() if func_node.lineno <= len(lines) else ''
                            self.detected_features.append(DetectedFeature(
                                feature=LANGUAGE_FEATURES['positional_only_params'],
                                line=func_node.lineno,
                                column=func_node.col_offset,
                                code_snippet=snippet,
                                supported=supports_positional_only_params(),
                                warning=None if supports_positional_only_params() else
                                        f"Positional-only parameters require Python 3.8+"
                            ))
                            break
    
    def _is_in_annotation_context(self, node: ast.AST, tree: ast.AST) -> bool:
        """Check if a node is within a type annotation context."""
        # This is a simplified check - in practice, we'd need parent tracking
        for parent in ast.walk(tree):
            if isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef)):
                # Check return annotation
                if parent.returns is not None:
                    for child in ast.walk(parent.returns):
                        if child is node:
                            return True
                # Check argument annotations
                for arg in parent.args.args + parent.args.kwonlyargs:
                    if arg.annotation is not None:
                        for child in ast.walk(arg.annotation):
                            if child is node:
                                return True
            elif isinstance(parent, ast.AnnAssign):
                if parent.annotation is not None:
                    for child in ast.walk(parent.annotation):
                        if child is node:
                            return True
        return False
    
    def _detect_from_syntax_error(self, error: SyntaxError, code: str, lines: List[str]) -> None:
        """Try to detect features from syntax errors (for unsupported features)."""
        error_msg = str(error).lower()
        error_line = error.lineno or 1
        snippet = lines[error_line - 1].strip() if error_line <= len(lines) else ''
        
        # Match statement syntax error
        if 'match' in error_msg or (error_line <= len(lines) and 'match ' in lines[error_line - 1]):
            if not supports_match_statement():
                self.detected_features.append(DetectedFeature(
                    feature=LANGUAGE_FEATURES['match_statement'],
                    line=error_line,
                    column=0,
                    code_snippet=snippet,
                    supported=False,
                    warning=f"Match statement requires Python 3.10+ (current: {get_python_version_string()})"
                ))
        
        # except* syntax error
        if 'except*' in code or 'except *' in code:
            if not supports_except_star():
                self.detected_features.append(DetectedFeature(
                    feature=LANGUAGE_FEATURES['exception_groups'],
                    line=error_line,
                    column=0,
                    code_snippet=snippet,
                    supported=False,
                    warning=f"except* syntax requires Python 3.11+ (current: {get_python_version_string()})"
                ))
    
    def _detect_regex_features(self, code: str, lines: List[str]) -> None:
        """Detect features using regex patterns."""
        import re
        
        # Detect walrus operator pattern
        walrus_pattern = re.compile(r':=')
        for i, line in enumerate(lines, 1):
            if walrus_pattern.search(line) and not line.strip().startswith('#'):
                # Check if already detected via AST
                already_detected = any(
                    f.feature.name == 'Walrus Operator' and f.line == i
                    for f in self.detected_features
                )
                if not already_detected:
                    self.detected_features.append(DetectedFeature(
                        feature=LANGUAGE_FEATURES['walrus_operator'],
                        line=i,
                        column=line.find(':='),
                        code_snippet=line.strip(),
                        supported=supports_walrus_operator(),
                        warning=None if supports_walrus_operator() else
                                f"Walrus operator requires Python 3.8+"
                    ))
        
        # Detect match statement pattern
        match_pattern = re.compile(r'^\s*match\s+\w+.*:\s*$')
        case_pattern = re.compile(r'^\s*case\s+.*:\s*$')
        for i, line in enumerate(lines, 1):
            if match_pattern.match(line) or case_pattern.match(line):
                already_detected = any(
                    f.feature.name == 'Match Statement' and f.line == i
                    for f in self.detected_features
                )
                if not already_detected:
                    self.detected_features.append(DetectedFeature(
                        feature=LANGUAGE_FEATURES['match_statement'],
                        line=i,
                        column=0,
                        code_snippet=line.strip(),
                        supported=supports_match_statement(),
                        warning=None if supports_match_statement() else
                                f"Match statement requires Python 3.10+"
                    ))
        
        # Detect except* pattern
        except_star_pattern = re.compile(r'^\s*except\s*\*')
        for i, line in enumerate(lines, 1):
            if except_star_pattern.match(line):
                already_detected = any(
                    f.feature.name == 'Exception Groups' and f.line == i
                    for f in self.detected_features
                )
                if not already_detected:
                    self.detected_features.append(DetectedFeature(
                        feature=LANGUAGE_FEATURES['exception_groups'],
                        line=i,
                        column=0,
                        code_snippet=line.strip(),
                        supported=supports_exception_groups(),
                        warning=None if supports_exception_groups() else
                                f"except* syntax requires Python 3.11+"
                    ))


def detect_version_specific_features(code: str) -> List[Dict[str, Any]]:
    """
    Detect all version-specific features in code.
    
    Args:
        code: Python source code to analyze
        
    Returns:
        List of detected features as dictionaries
    """
    detector = VersionFeatureDetector()
    features = detector.detect_features(code)
    return [f.to_dict() for f in features]


# =============================================================================
# COMPATIBILITY WARNINGS
# =============================================================================

@dataclass
class CompatibilityWarning:
    """Warning about version compatibility issues."""
    feature_name: str
    min_version: str
    current_version: str
    line: int
    column: int
    message: str
    suggestion: str
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'feature': self.feature_name,
            'min_version': self.min_version,
            'current_version': self.current_version,
            'line': self.line,
            'column': self.column,
            'message': self.message,
            'suggestion': self.suggestion
        }


def check_code_compatibility(code: str, target_version: Optional[Tuple[int, int]] = None) -> List[CompatibilityWarning]:
    """
    Check code for compatibility issues with target Python version.
    
    Args:
        code: Python source code to check
        target_version: Target Python version tuple (default: current version)
        
    Returns:
        List of compatibility warnings
    """
    warnings = []
    target = target_version or PYTHON_VERSION_TUPLE
    target_str = f"{target[0]}.{target[1]}"
    
    detector = VersionFeatureDetector()
    features = detector.detect_features(code)
    
    for feature in features:
        if feature.feature.min_version > target:
            warnings.append(CompatibilityWarning(
                feature_name=feature.feature.name,
                min_version=feature.feature.min_version_string,
                current_version=target_str,
                line=feature.line,
                column=feature.column,
                message=f"{feature.feature.name} requires Python {feature.feature.min_version_string}+",
                suggestion=f"Remove or refactor code using {feature.feature.name} for Python {target_str} compatibility"
            ))
    
    return warnings


# =============================================================================
# UTILITY FUNCTIONS FOR REFACTORING MODULES
# =============================================================================

def safe_parse(code: str, feature_mode: str = 'exec') -> Tuple[Optional[ast.AST], List[CompatibilityWarning]]:
    """
    Safely parse code with version compatibility checking.
    
    Args:
        code: Python source code to parse
        feature_mode: Parse mode ('exec', 'eval', 'single')
        
    Returns:
        Tuple of (AST or None, list of compatibility warnings)
    """
    warnings = []
    
    try:
        tree = ast.parse(code, mode=feature_mode)
        # Check for version-specific features
        warnings = check_code_compatibility(code)
        return tree, warnings
    except SyntaxError as e:
        # Try to determine if it's a version compatibility issue
        error_warnings = []
        error_msg = str(e).lower()
        
        if 'match' in error_msg and not supports_match_statement():
            error_warnings.append(CompatibilityWarning(
                feature_name='Match Statement',
                min_version='3.10',
                current_version=get_python_version_string(),
                line=e.lineno or 0,
                column=e.offset or 0,
                message="Match statement syntax not supported",
                suggestion="Upgrade to Python 3.10+ or use if/elif chains"
            ))
        
        if 'except*' in str(e) and not supports_except_star():
            error_warnings.append(CompatibilityWarning(
                feature_name='Exception Groups',
                min_version='3.11',
                current_version=get_python_version_string(),
                line=e.lineno or 0,
                column=e.offset or 0,
                message="except* syntax not supported",
                suggestion="Upgrade to Python 3.11+ or use regular except"
            ))
        
        return None, error_warnings


def get_ast_node_for_feature(feature_name: str) -> Optional[type]:
    """
    Get the AST node type for a language feature if available.
    
    Args:
        feature_name: Name of the feature
        
    Returns:
        AST node type or None if not available
    """
    feature = LANGUAGE_FEATURES.get(feature_name)
    if not feature or not feature.supported:
        return None
    
    node_types = feature.ast_node_types
    if node_types:
        first_type = node_types[0]
        if hasattr(ast, first_type):
            return getattr(ast, first_type)
    
    return None


# =============================================================================
# MODULE EXPORTS
# =============================================================================

__all__ = [
    # Version info
    'PYTHON_VERSION',
    'PYTHON_VERSION_TUPLE',
    'PythonVersion',
    'get_python_version',
    'get_python_version_string',
    'version_at_least',
    
    # Feature support checks
    'supports_walrus_operator',
    'supports_positional_only_params',
    'supports_match_statement',
    'supports_union_type_syntax',
    'supports_parenthesized_context_managers',
    'supports_exception_groups',
    'supports_except_star',
    'supports_self_type',
    'supports_fstring_arbitrary_expressions',
    'supports_type_parameter_syntax',
    
    # Feature info
    'LanguageFeature',
    'LANGUAGE_FEATURES',
    'get_feature_info',
    'get_all_features',
    'get_supported_features',
    'get_unsupported_features',
    
    # Detection
    'DetectedFeature',
    'VersionFeatureDetector',
    'detect_version_specific_features',
    
    # Compatibility
    'CompatibilityWarning',
    'check_code_compatibility',
    'safe_parse',
    
    # Utilities
    'has_ast_node_type',
    'get_available_ast_nodes',
    'get_ast_node_for_feature',
]
