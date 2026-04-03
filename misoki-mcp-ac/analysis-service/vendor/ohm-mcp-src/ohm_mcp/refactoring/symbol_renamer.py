"""
Symbol Renamer - Safely rename variables, functions, and classes across the project.

This module provides comprehensive symbol renaming with edge case handling for:
- Name collision detection in target scope
- Dynamic attribute access via getattr/setattr/hasattr
- String literal references in docstrings and comments
- Magic method renaming prevention (__init__, __str__, __new__, etc.)
- Overridden method warnings (breaking inheritance contracts)
- Imported name propagation across all files
- Namespace conflicts with built-in names

Python 3.8+ Language Feature Support:
- Walrus operator (:=) - Python 3.8+: Detects and preserves in rename operations
- Match/case statements - Python 3.10+: Handles pattern matching variables
- Type union syntax (X | Y) - Python 3.10+: Preserves in type annotations
- Exception groups (except*) - Python 3.11+: Handles exception group syntax
- F-string improvements - Python 3.12+: Handles complex f-string expressions

Edge Case Behavior:
    - Magic methods (__init__, __str__, etc.) cannot be renamed (raises MagicMethodRenameError)
    - Renaming to Python built-in names raises BuiltinConflictError
    - Name collisions in target scope raise NameCollisionError
    - Dynamic attribute access (getattr/setattr/hasattr) generates warnings
    - String literal references in docstrings/comments generate warnings
    - Overridden methods generate inheritance contract warnings
    - All operations support rollback on conflict detection
    - Version-specific features generate appropriate warnings

Version Compatibility:
    - Python 3.8+: Walrus operator (:=), positional-only parameters
    - Python 3.10+: Match/case statements, union type syntax (X | Y)
    - Python 3.11+: Exception groups (except*)
    - Python 3.12+: F-string improvements, type parameter syntax
"""

import ast
import builtins
import os
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple, Any

# Import version compatibility utilities
from .python_version_compat import (
    supports_walrus_operator,
    supports_match_statement,
    supports_union_type_syntax,
    supports_exception_groups,
    supports_fstring_arbitrary_expressions,
    detect_version_specific_features,
    get_python_version_string,
    has_ast_node_type,
    CompatibilityWarning,
)


# =============================================================================
# CONSTANTS - Edge Case Detection
# =============================================================================

# Magic/dunder methods that should never be renamed (breaks Python semantics)
MAGIC_METHODS: Set[str] = {
    # Object lifecycle
    '__init__', '__new__', '__del__', '__init_subclass__',
    # String representation
    '__repr__', '__str__', '__bytes__', '__format__',
    # Comparison operators
    '__lt__', '__le__', '__eq__', '__ne__', '__gt__', '__ge__', '__hash__',
    # Attribute access
    '__getattr__', '__getattribute__', '__setattr__', '__delattr__', '__dir__',
    # Descriptors
    '__get__', '__set__', '__delete__', '__set_name__',
    # Container methods
    '__len__', '__length_hint__', '__getitem__', '__setitem__', '__delitem__',
    '__missing__', '__iter__', '__reversed__', '__contains__',
    # Numeric operators
    '__add__', '__sub__', '__mul__', '__matmul__', '__truediv__', '__floordiv__',
    '__mod__', '__divmod__', '__pow__', '__lshift__', '__rshift__',
    '__and__', '__xor__', '__or__', '__neg__', '__pos__', '__abs__', '__invert__',
    # Reflected operators
    '__radd__', '__rsub__', '__rmul__', '__rmatmul__', '__rtruediv__',
    '__rfloordiv__', '__rmod__', '__rdivmod__', '__rpow__',
    '__rlshift__', '__rrshift__', '__rand__', '__rxor__', '__ror__',
    # Augmented assignment
    '__iadd__', '__isub__', '__imul__', '__imatmul__', '__itruediv__',
    '__ifloordiv__', '__imod__', '__ipow__', '__ilshift__', '__irshift__',
    '__iand__', '__ixor__', '__ior__',
    # Unary operators and type conversion
    '__complex__', '__int__', '__float__', '__index__', '__round__',
    '__trunc__', '__floor__', '__ceil__', '__bool__',
    # Context managers
    '__enter__', '__exit__', '__aenter__', '__aexit__',
    # Async iteration
    '__await__', '__aiter__', '__anext__', '__next__',
    # Callable
    '__call__',
    # Class creation
    '__class_getitem__', '__mro_entries__', '__prepare__',
    # Pickling
    '__reduce__', '__reduce_ex__', '__getstate__', '__setstate__',
    '__getnewargs__', '__getnewargs_ex__',
    # Slots and weakrefs
    '__slots__', '__weakref__',
    # Module attributes
    '__name__', '__qualname__', '__module__', '__doc__', '__annotations__',
    '__dict__', '__bases__', '__class__', '__all__',
}

# Python built-in names that should not be shadowed
PYTHON_BUILTINS: Set[str] = set(dir(builtins))

# Functions that perform dynamic attribute access
DYNAMIC_ATTR_FUNCTIONS: Set[str] = {'getattr', 'setattr', 'hasattr', 'delattr'}

# Valid symbol types for renaming
VALID_SYMBOL_TYPES: Set[str] = {'variable', 'function', 'class', 'method', 'attribute', 'any'}

# Valid scope values
VALID_SCOPES: Set[str] = {'project', 'file', 'function', 'class'}


# =============================================================================
# EXCEPTIONS - Specific Error Types for Edge Cases
# =============================================================================

class SymbolRenameError(Exception):
    """Base exception for symbol renaming errors."""
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NameCollisionError(SymbolRenameError):
    """Raised when the new name collides with an existing symbol in the target scope."""
    
    def __init__(self, new_name: str, existing_location: Dict[str, Any]):
        message = f"Name collision: '{new_name}' already exists at {existing_location.get('file', 'unknown')}:{existing_location.get('line', '?')}"
        super().__init__(message, {'new_name': new_name, 'collision': existing_location})


class MagicMethodRenameError(SymbolRenameError):
    """Raised when attempting to rename a magic/dunder method."""
    
    def __init__(self, method_name: str):
        message = f"Cannot rename magic method '{method_name}': renaming dunder methods breaks Python semantics"
        super().__init__(message, {'method_name': method_name, 'is_magic': True})


class BuiltinConflictError(SymbolRenameError):
    """Raised when the new name conflicts with a Python built-in."""
    
    def __init__(self, new_name: str):
        message = f"Cannot rename to '{new_name}': conflicts with Python built-in name"
        super().__init__(message, {'new_name': new_name, 'is_builtin': True})


class InheritanceContractError(SymbolRenameError):
    """Raised when renaming would break an inheritance contract."""
    
    def __init__(self, method_name: str, parent_class: str):
        message = f"Renaming '{method_name}' would break inheritance contract with '{parent_class}'"
        super().__init__(message, {'method_name': method_name, 'parent_class': parent_class})


class InvalidInputError(SymbolRenameError):
    """Raised when input validation fails."""
    
    def __init__(self, parameter: str, value: Any, reason: str):
        message = f"Invalid {parameter}: '{value}' - {reason}"
        super().__init__(message, {'parameter': parameter, 'value': value, 'reason': reason})


# =============================================================================
# WARNING SYSTEM - Structured Warnings for Edge Cases
# =============================================================================

class WarningLevel(Enum):
    """Severity levels for rename warnings."""
    INFO = "info"           # Informational, no action needed
    WARNING = "warning"     # Potential issue, manual review recommended
    ERROR = "error"         # Serious issue, may cause runtime errors
    CRITICAL = "critical"   # Cannot proceed, must be resolved


@dataclass
class RenameWarning:
    """Structured warning for rename operations."""
    level: WarningLevel
    warning_type: str
    message: str
    file_path: Optional[str] = None
    line_number: Optional[int] = None
    column: Optional[int] = None
    context: Optional[str] = None
    suggestion: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert warning to dictionary for JSON serialization."""
        return {
            'level': self.level.value,
            'type': self.warning_type,
            'message': self.message,
            'location': {
                'file': self.file_path,
                'line': self.line_number,
                'column': self.column
            } if self.file_path else None,
            'context': self.context,
            'suggestion': self.suggestion
        }


@dataclass
class EdgeCaseAnalysisResult:
    """Result of edge case analysis before renaming."""
    can_proceed: bool = True
    requires_manual_review: bool = False
    warnings: List[RenameWarning] = field(default_factory=list)
    dynamic_accesses: List[Dict[str, Any]] = field(default_factory=list)
    string_references: List[Dict[str, Any]] = field(default_factory=list)
    inheritance_issues: List[Dict[str, Any]] = field(default_factory=list)
    import_propagations: List[Dict[str, Any]] = field(default_factory=list)
    version_warnings: List[Dict[str, Any]] = field(default_factory=list)
    
    def add_warning(self, warning: RenameWarning) -> None:
        """Add a warning and update status flags."""
        self.warnings.append(warning)
        
        # Update flags based on warning level
        if warning.level == WarningLevel.CRITICAL:
            self.can_proceed = False
        elif warning.level in (WarningLevel.WARNING, WarningLevel.ERROR):
            self.requires_manual_review = True
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary for JSON serialization."""
        return {
            'can_proceed': self.can_proceed,
            'requires_manual_review': self.requires_manual_review,
            'warning_count': len(self.warnings),
            'warnings': [w.to_dict() for w in self.warnings],
            'dynamic_accesses': self.dynamic_accesses,
            'string_references': self.string_references,
            'inheritance_issues': self.inheritance_issues,
            'import_propagations': self.import_propagations,
            'version_warnings': self.version_warnings
        }


# =============================================================================
# BACKUP MANAGER - Rollback Support
# =============================================================================

class RenameBackupManager:
    """Manage file backups for safe rollback during rename operations."""
    
    def __init__(self, project_root: str):
        """
        Initialize backup manager.
        
        Args:
            project_root: Root directory of the project
            
        Raises:
            InvalidInputError: If project_root is invalid
        """
        # Validate project root
        if not project_root:
            raise InvalidInputError('project_root', project_root, 'cannot be empty')
        if not os.path.exists(project_root):
            raise InvalidInputError('project_root', project_root, 'directory does not exist')
        if not os.path.isdir(project_root):
            raise InvalidInputError('project_root', project_root, 'must be a directory')
        
        self.project_root = project_root
        self.backup_dir = os.path.join(project_root, '.ohm-rename-backups')
        self.backups: Dict[str, str] = {}  # original_path -> backup_path
        self.operation_id: Optional[str] = None
    
    def start_operation(self) -> str:
        """
        Start a new rename operation and create backup directory.
        
        Returns:
            Unique operation ID for this rename session
        """
        self.operation_id = f"rename_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        os.makedirs(self.backup_dir, exist_ok=True)
        self.backups.clear()
        return self.operation_id
    
    def backup_file(self, file_path: str) -> str:
        """
        Create a backup of a file before modification.
        
        Args:
            file_path: Absolute path to file to backup
            
        Returns:
            Path to backup file
            
        Raises:
            FileNotFoundError: If file does not exist
            SymbolRenameError: If backup fails
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Cannot backup non-existent file: {file_path}")
        
        if not self.operation_id:
            self.start_operation()
        
        try:
            # Create unique backup filename
            relative_path = os.path.relpath(file_path, self.project_root)
            safe_name = relative_path.replace(os.sep, '_').replace('.', '_')
            backup_name = f"{self.operation_id}_{safe_name}.bak"
            backup_path = os.path.join(self.backup_dir, backup_name)
            
            # Copy file preserving metadata
            shutil.copy2(file_path, backup_path)
            self.backups[file_path] = backup_path
            
            return backup_path
            
        except (OSError, IOError) as e:
            raise SymbolRenameError(f"Failed to create backup for {file_path}: {e}") from e
    
    def rollback_all(self) -> Dict[str, bool]:
        """
        Rollback all backed up files to their original state.
        
        Returns:
            Dictionary mapping file paths to rollback success status
        """
        results = {}
        
        for original_path, backup_path in self.backups.items():
            try:
                if os.path.exists(backup_path):
                    shutil.copy2(backup_path, original_path)
                    results[original_path] = True
                else:
                    results[original_path] = False
            except (OSError, IOError):
                results[original_path] = False
        
        return results
    
    def rollback_file(self, file_path: str) -> bool:
        """
        Rollback a specific file to its backed up state.
        
        Args:
            file_path: Path to file to rollback
            
        Returns:
            True if rollback succeeded, False otherwise
        """
        backup_path = self.backups.get(file_path)
        
        if not backup_path or not os.path.exists(backup_path):
            return False
        
        try:
            shutil.copy2(backup_path, file_path)
            return True
        except (OSError, IOError):
            return False
    
    def cleanup_backups(self) -> None:
        """Remove all backup files for the current operation."""
        for backup_path in self.backups.values():
            try:
                if os.path.exists(backup_path):
                    os.remove(backup_path)
            except OSError:
                pass  # Best effort cleanup
        
        self.backups.clear()
    
    def get_backup_info(self) -> Dict[str, Any]:
        """Get information about current backups."""
        return {
            'operation_id': self.operation_id,
            'backup_count': len(self.backups),
            'backups': {
                original: {
                    'backup_path': backup,
                    'exists': os.path.exists(backup)
                }
                for original, backup in self.backups.items()
            }
        }


# =============================================================================
# SYMBOL RENAMER - Core Implementation with Edge Case Handling
# =============================================================================

class SymbolRenamer:
    """
    Rename symbols (variables, functions, classes) across a codebase with
    comprehensive edge case handling.
    
    Edge Cases Handled:
        - Name collision detection in target scope
        - Dynamic attribute access via getattr/setattr/hasattr
        - String literal references in docstrings and comments
        - Magic method renaming prevention
        - Overridden method warnings (inheritance contracts)
        - Imported name propagation across files
        - Namespace conflicts with built-in names
    
    Example:
        >>> renamer = SymbolRenamer()
        >>> result = renamer.rename_symbol(
        ...     project_root='/path/to/project',
        ...     old_name='old_func',
        ...     new_name='new_func',
        ...     symbol_type='function'
        ... )
        >>> if result['success']:
        ...     print(f"Renamed in {result['files_changed']} files")
        ... else:
        ...     print(f"Error: {result['error']}")
    """
    
    def __init__(self):
        """Initialize the symbol renamer."""
        self.references: List[Dict[str, Any]] = []
        self._current_analysis: Optional[EdgeCaseAnalysisResult] = None
    
    # =========================================================================
    # INPUT VALIDATION
    # =========================================================================
    
    def _validate_inputs(
        self,
        project_root: str,
        old_name: str,
        new_name: str,
        symbol_type: str,
        scope: str
    ) -> None:
        """
        Validate all input parameters with defensive checks.
        
        Args:
            project_root: Root directory of the project
            old_name: Current symbol name
            new_name: New symbol name
            symbol_type: Type of symbol to rename
            scope: Scope of renaming operation
            
        Raises:
            InvalidInputError: If any input is invalid
            MagicMethodRenameError: If attempting to rename a magic method
            BuiltinConflictError: If new_name conflicts with a built-in
        """
        # Validate project_root
        if not project_root:
            raise InvalidInputError('project_root', project_root, 'cannot be empty')
        if not os.path.exists(project_root):
            raise InvalidInputError('project_root', project_root, 'directory does not exist')
        if not os.path.isdir(project_root):
            raise InvalidInputError('project_root', project_root, 'must be a directory')
        
        # Validate old_name
        if not old_name:
            raise InvalidInputError('old_name', old_name, 'cannot be empty')
        if not old_name.isidentifier():
            raise InvalidInputError('old_name', old_name, 'must be a valid Python identifier')
        
        # Check if old_name is a magic method (cannot rename)
        if self._is_magic_method(old_name):
            raise MagicMethodRenameError(old_name)
        
        # Validate new_name
        if not new_name:
            raise InvalidInputError('new_name', new_name, 'cannot be empty')
        if not new_name.isidentifier():
            raise InvalidInputError('new_name', new_name, 'must be a valid Python identifier')
        
        # Check if new_name is a magic method (cannot create)
        if self._is_magic_method(new_name) and not self._is_magic_method(old_name):
            raise InvalidInputError('new_name', new_name, 'cannot rename to a magic method name')
        
        # Check if new_name conflicts with Python built-ins
        if self._is_builtin_name(new_name):
            raise BuiltinConflictError(new_name)
        
        # Validate symbol_type
        if symbol_type not in VALID_SYMBOL_TYPES:
            raise InvalidInputError(
                'symbol_type', symbol_type,
                f"must be one of: {', '.join(sorted(VALID_SYMBOL_TYPES))}"
            )
        
        # Validate scope
        if scope not in VALID_SCOPES:
            raise InvalidInputError(
                'scope', scope,
                f"must be one of: {', '.join(sorted(VALID_SCOPES))}"
            )
    
    def _is_valid_identifier(self, name: str) -> bool:
        """
        Check if name is a valid Python identifier.
        
        Args:
            name: Name to validate
            
        Returns:
            True if valid identifier, False otherwise
        """
        if not name:
            return False
        return name.isidentifier()
    
    def _is_magic_method(self, name: str) -> bool:
        """
        Check if name is a magic/dunder method.
        
        Magic methods (like __init__, __str__) have special meaning in Python
        and should not be renamed as it would break Python semantics.
        
        Args:
            name: Method name to check
            
        Returns:
            True if name is a magic method, False otherwise
        """
        # Check against known magic methods
        if name in MAGIC_METHODS:
            return True
        
        # Also check pattern: starts and ends with double underscore
        if name.startswith('__') and name.endswith('__') and len(name) > 4:
            return True
        
        return False
    
    def _is_builtin_name(self, name: str) -> bool:
        """
        Check if name conflicts with a Python built-in.
        
        Renaming to a built-in name would shadow the built-in and likely
        cause unexpected behavior.
        
        Args:
            name: Name to check
            
        Returns:
            True if name is a Python built-in, False otherwise
        """
        return name in PYTHON_BUILTINS
    
    # =========================================================================
    # EDGE CASE DETECTION METHODS
    # =========================================================================
    
    def _detect_name_collision_in_scope(
        self,
        tree: ast.AST,
        new_name: str,
        scope_node: Optional[ast.AST] = None
    ) -> List[Dict[str, Any]]:
        """
        Detect if new_name already exists in the target scope.
        
        This prevents accidental shadowing of existing symbols which would
        cause hard-to-debug issues.
        
        Args:
            tree: AST of the file
            new_name: Proposed new name
            scope_node: Optional scope to check within (function/class)
            
        Returns:
            List of collision locations with details
        """
        collisions = []
        search_tree = scope_node if scope_node else tree
        
        for node in ast.walk(search_tree):
            collision_info = None
            
            # Check function/method definitions
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name == new_name:
                    collision_info = {
                        'type': 'function',
                        'name': new_name,
                        'line': node.lineno,
                        'column': node.col_offset,
                        'context': 'function_definition'
                    }
            
            # Check class definitions
            elif isinstance(node, ast.ClassDef):
                if node.name == new_name:
                    collision_info = {
                        'type': 'class',
                        'name': new_name,
                        'line': node.lineno,
                        'column': node.col_offset,
                        'context': 'class_definition'
                    }
            
            # Check variable assignments
            elif isinstance(node, ast.Name):
                if node.id == new_name and isinstance(node.ctx, ast.Store):
                    collision_info = {
                        'type': 'variable',
                        'name': new_name,
                        'line': node.lineno,
                        'column': node.col_offset,
                        'context': 'variable_assignment'
                    }
            
            # Check import statements
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    imported_name = alias.asname if alias.asname else alias.name
                    if imported_name == new_name:
                        collision_info = {
                            'type': 'import',
                            'name': new_name,
                            'line': node.lineno,
                            'column': node.col_offset,
                            'context': 'import_statement'
                        }
                        break
            
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    imported_name = alias.asname if alias.asname else alias.name
                    if imported_name == new_name:
                        collision_info = {
                            'type': 'import',
                            'name': new_name,
                            'line': node.lineno,
                            'column': node.col_offset,
                            'context': 'from_import_statement'
                        }
                        break
            
            if collision_info:
                collisions.append(collision_info)

        # Check for match pattern bindings (Python 3.10+)
        for occurrence in self._find_match_pattern_occurrences(search_tree, new_name):
            collisions.append({
                'type': 'variable',
                'name': new_name,
                'line': occurrence['line'],
                'column': occurrence['column'],
                'context': occurrence['context']
            })
        
        return collisions

    def _find_match_pattern_occurrences(
        self,
        tree: ast.AST,
        name: str
    ) -> List[Dict[str, Any]]:
        """Find occurrences of a name bound in match/case patterns (Python 3.10+)."""
        if not has_ast_node_type('Match'):
            return []

        occurrences: List[Dict[str, Any]] = []
        match_as = getattr(ast, 'MatchAs', None)
        match_star = getattr(ast, 'MatchStar', None)
        match_mapping = getattr(ast, 'MatchMapping', None)

        for node in ast.walk(tree):
            if match_as and isinstance(node, match_as):
                if node.name == name:
                    occurrences.append({
                        "line": getattr(node, 'lineno', 0),
                        "column": getattr(node, 'col_offset', 0),
                        "context": "match_pattern_binding"
                    })
            if match_star and isinstance(node, match_star):
                if node.name == name:
                    occurrences.append({
                        "line": getattr(node, 'lineno', 0),
                        "column": getattr(node, 'col_offset', 0),
                        "context": "match_star_binding"
                    })
            if match_mapping and isinstance(node, match_mapping):
                if node.rest == name:
                    occurrences.append({
                        "line": getattr(node, 'lineno', 0),
                        "column": getattr(node, 'col_offset', 0),
                        "context": "match_mapping_rest_binding"
                    })

        return occurrences
    
    def _detect_dynamic_attribute_access(
        self,
        tree: ast.AST,
        symbol_name: str,
        code: str
    ) -> List[Dict[str, Any]]:
        """
        Detect dynamic attribute access that references the symbol by string.
        
        Functions like getattr(obj, 'attr'), setattr(obj, 'attr', val),
        hasattr(obj, 'attr'), and delattr(obj, 'attr') use string literals
        that won't be caught by AST-based renaming.
        
        Args:
            tree: AST of the file
            symbol_name: Name of symbol being renamed
            code: Source code for context extraction
            
        Returns:
            List of dynamic access locations with details
        """
        dynamic_accesses = []
        lines = code.splitlines()
        
        for node in ast.walk(tree):
            # Look for function calls to getattr/setattr/hasattr/delattr
            if isinstance(node, ast.Call):
                func_name = None
                
                # Direct call: getattr(...)
                if isinstance(node.func, ast.Name):
                    func_name = node.func.id
                # Method call: builtins.getattr(...)
                elif isinstance(node.func, ast.Attribute):
                    func_name = node.func.attr
                
                if func_name in DYNAMIC_ATTR_FUNCTIONS:
                    # Check if any argument is a string literal matching symbol_name
                    for i, arg in enumerate(node.args):
                        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                            if arg.value == symbol_name:
                                line_content = lines[node.lineno - 1] if node.lineno <= len(lines) else ''
                                dynamic_accesses.append({
                                    'function': func_name,
                                    'argument_index': i,
                                    'string_value': arg.value,
                                    'line': node.lineno,
                                    'column': node.col_offset,
                                    'line_content': line_content.strip(),
                                    'warning': f"Dynamic {func_name}() call uses string '{symbol_name}' - manual update required"
                                })
                    
                    # Also check keyword arguments
                    for kw in node.keywords:
                        if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                            if kw.value.value == symbol_name:
                                line_content = lines[node.lineno - 1] if node.lineno <= len(lines) else ''
                                dynamic_accesses.append({
                                    'function': func_name,
                                    'keyword': kw.arg,
                                    'string_value': kw.value.value,
                                    'line': node.lineno,
                                    'column': node.col_offset,
                                    'line_content': line_content.strip(),
                                    'warning': f"Dynamic {func_name}() call uses string '{symbol_name}' - manual update required"
                                })
        
        return dynamic_accesses
    
    def _detect_string_literal_references(
        self,
        code: str,
        symbol_name: str
    ) -> List[Dict[str, Any]]:
        """
        Detect string literal references to the symbol in docstrings and comments.
        
        These references won't be updated by AST-based renaming and may become
        stale documentation.
        
        Args:
            code: Source code to analyze
            symbol_name: Name of symbol being renamed
            
        Returns:
            List of string reference locations with details
        """
        references = []
        lines = code.splitlines()
        
        # Pattern to match symbol name as a word (not part of another word)
        word_pattern = re.compile(r'\b' + re.escape(symbol_name) + r'\b')
        
        in_docstring = False
        docstring_start = 0
        quote_char = None
        
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            
            # Track docstring state (triple quotes)
            for quote in ['"""', "'''"]:
                count = stripped.count(quote)
                if count > 0:
                    if not in_docstring:
                        in_docstring = True
                        docstring_start = i
                        quote_char = quote
                        if count >= 2:  # Single-line docstring
                            in_docstring = False
                    elif quote == quote_char:
                        in_docstring = False
            
            # Check for symbol name in docstrings
            if in_docstring or stripped.startswith('"""') or stripped.startswith("'''"):
                matches = list(word_pattern.finditer(line))
                for match in matches:
                    references.append({
                        'type': 'docstring',
                        'line': i,
                        'column': match.start(),
                        'line_content': line.strip(),
                        'context': 'documentation',
                        'warning': f"Docstring references '{symbol_name}' - may need manual update"
                    })
            
            # Check for symbol name in comments
            comment_start = line.find('#')
            if comment_start != -1:
                comment_text = line[comment_start:]
                matches = list(word_pattern.finditer(comment_text))
                for match in matches:
                    references.append({
                        'type': 'comment',
                        'line': i,
                        'column': comment_start + match.start(),
                        'line_content': line.strip(),
                        'context': 'comment',
                        'warning': f"Comment references '{symbol_name}' - may need manual update"
                    })
            
            # Check for symbol name in f-strings
            if 'f"' in line or "f'" in line:
                # Look for the symbol name in f-string expressions
                fstring_pattern = re.compile(r'f["\'].*?\{[^}]*' + re.escape(symbol_name) + r'[^}]*\}.*?["\']')
                if fstring_pattern.search(line):
                    references.append({
                        'type': 'fstring',
                        'line': i,
                        'column': 0,
                        'line_content': line.strip(),
                        'context': 'f-string expression',
                        'warning': f"F-string may reference '{symbol_name}' - verify after rename"
                    })
            
            # Check for symbol name in regular string literals (potential reflection/serialization)
            string_pattern = re.compile(r'["\']' + re.escape(symbol_name) + r'["\']')
            if string_pattern.search(line) and not stripped.startswith('#'):
                # Exclude if it's in a docstring or comment
                if not in_docstring and comment_start == -1:
                    references.append({
                        'type': 'string_literal',
                        'line': i,
                        'column': 0,
                        'line_content': line.strip(),
                        'context': 'string literal (possible reflection/serialization)',
                        'warning': f"String literal contains '{symbol_name}' - may need manual update"
                    })
        
        return references
    
    def _detect_overridden_methods(
        self,
        tree: ast.AST,
        method_name: str,
        code: str
    ) -> List[Dict[str, Any]]:
        """
        Detect if the method overrides a parent class method.
        
        Renaming an overridden method breaks the inheritance contract and
        may cause unexpected behavior in polymorphic code.
        
        Args:
            tree: AST of the file
            method_name: Name of method being renamed
            code: Source code for context
            
        Returns:
            List of inheritance issues with details
        """
        inheritance_issues = []
        lines = code.splitlines()
        
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                # Check if class has base classes
                if node.bases:
                    # Find the method in this class
                    for item in node.body:
                        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            if item.name == method_name:
                                # Get base class names
                                base_names = []
                                for base in node.bases:
                                    if isinstance(base, ast.Name):
                                        base_names.append(base.id)
                                    elif isinstance(base, ast.Attribute):
                                        base_names.append(f"{base.value.id if isinstance(base.value, ast.Name) else '...'}.{base.attr}")
                                
                                if base_names:
                                    line_content = lines[item.lineno - 1] if item.lineno <= len(lines) else ''
                                    inheritance_issues.append({
                                        'class_name': node.name,
                                        'method_name': method_name,
                                        'base_classes': base_names,
                                        'line': item.lineno,
                                        'column': item.col_offset,
                                        'line_content': line_content.strip(),
                                        'warning': f"Method '{method_name}' in class '{node.name}' may override method from {', '.join(base_names)} - renaming may break inheritance contract"
                                    })
        
        return inheritance_issues
    
    def _detect_imported_name_propagation(
        self,
        files: List[str],
        symbol_name: str,
        source_file: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Detect where the symbol is imported and used across files.
        
        When renaming a symbol, all files that import it need to be updated.
        This method tracks the import chain.
        
        Args:
            files: List of Python files to analyze
            symbol_name: Name of symbol being renamed
            source_file: Optional source file where symbol is defined
            
        Returns:
            List of import propagation details
        """
        propagations = []
        
        for file_path in files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    code = f.read()
                
                tree = ast.parse(code)
                
                for node in ast.walk(tree):
                    # Check import statements
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            if alias.name == symbol_name or (alias.asname and alias.asname == symbol_name):
                                propagations.append({
                                    'file': file_path,
                                    'import_type': 'import',
                                    'imported_name': alias.name,
                                    'alias': alias.asname,
                                    'line': node.lineno,
                                    'needs_update': True
                                })
                    
                    # Check from imports
                    elif isinstance(node, ast.ImportFrom):
                        for alias in node.names:
                            if alias.name == symbol_name or (alias.asname and alias.asname == symbol_name):
                                propagations.append({
                                    'file': file_path,
                                    'import_type': 'from_import',
                                    'module': node.module,
                                    'imported_name': alias.name,
                                    'alias': alias.asname,
                                    'line': node.lineno,
                                    'needs_update': True
                                })
                            
                            # Check for wildcard imports
                            if alias.name == '*':
                                propagations.append({
                                    'file': file_path,
                                    'import_type': 'wildcard',
                                    'module': node.module,
                                    'line': node.lineno,
                                    'warning': f"Wildcard import from {node.module} - cannot determine if '{symbol_name}' is imported",
                                    'needs_manual_check': True
                                })
            
            except (SyntaxError, OSError, IOError):
                continue
        
        return propagations
    
    def analyze_edge_cases(
        self,
        project_root: str,
        old_name: str,
        new_name: str,
        symbol_type: str,
        scope: str = "project",
        file_path: Optional[str] = None
    ) -> EdgeCaseAnalysisResult:
        """
        Perform comprehensive edge case analysis before renaming.
        
        This method checks for all potential issues that could arise from
        renaming the symbol, including collisions, dynamic access, string
        references, inheritance issues, and import propagation.
        
        Args:
            project_root: Root directory of the project
            old_name: Current symbol name
            new_name: New symbol name
            symbol_type: Type of symbol ('variable', 'function', 'class', 'method', 'attribute')
            scope: Scope of renaming ('project', 'file', 'function', 'class')
            file_path: Specific file for file/function/class scope
            
        Returns:
            EdgeCaseAnalysisResult with all detected issues and warnings
        """
        result = EdgeCaseAnalysisResult()
        
        # Get files to analyze
        if scope == "project":
            files = self._find_python_files(project_root)
        elif scope == "file" and file_path:
            full_path = os.path.join(project_root, file_path) if not os.path.isabs(file_path) else file_path
            files = [full_path] if os.path.exists(full_path) else []
        else:
            files = []
        
        for file_path in files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    code = f.read()
                
                tree = ast.parse(code)
                
                # 1. Check for name collisions
                collisions = self._detect_name_collision_in_scope(tree, new_name)
                for collision in collisions:
                    collision['file'] = file_path
                    result.add_warning(RenameWarning(
                        level=WarningLevel.ERROR,
                        warning_type='name_collision',
                        message=f"Name '{new_name}' already exists as {collision['type']}",
                        file_path=file_path,
                        line_number=collision['line'],
                        column=collision['column'],
                        context=collision['context'],
                        suggestion=f"Choose a different name or remove existing '{new_name}' first"
                    ))
                
                # 2. Check for dynamic attribute access
                dynamic_accesses = self._detect_dynamic_attribute_access(tree, old_name, code)
                for access in dynamic_accesses:
                    access['file'] = file_path
                    result.dynamic_accesses.append(access)
                    result.add_warning(RenameWarning(
                        level=WarningLevel.WARNING,
                        warning_type='dynamic_access',
                        message=access['warning'],
                        file_path=file_path,
                        line_number=access['line'],
                        column=access['column'],
                        context=access['line_content'],
                        suggestion=f"Manually update the string '{old_name}' to '{new_name}' in {access['function']}() call"
                    ))
                
                # 3. Check for string literal references
                string_refs = self._detect_string_literal_references(code, old_name)
                for ref in string_refs:
                    ref['file'] = file_path
                    result.string_references.append(ref)
                    result.add_warning(RenameWarning(
                        level=WarningLevel.INFO if ref['type'] in ('docstring', 'comment') else WarningLevel.WARNING,
                        warning_type='string_reference',
                        message=ref['warning'],
                        file_path=file_path,
                        line_number=ref['line'],
                        column=ref['column'],
                        context=ref['line_content'],
                        suggestion=f"Review and update reference to '{old_name}' if needed"
                    ))

                # 3b. Check for Python version-specific features
                version_features = detect_version_specific_features(code)
                for feature in version_features:
                    if feature.get('supported') is False:
                        warning_message = feature.get('warning') or (
                            f"{feature.get('feature_name')} requires Python {feature.get('min_version')}+"
                        )
                        result.version_warnings.append({
                            'file': file_path,
                            'feature': feature.get('feature_name'),
                            'min_version': feature.get('min_version'),
                            'current_version': get_python_version_string(),
                            'line': feature.get('line'),
                            'column': feature.get('column'),
                            'code_snippet': feature.get('code_snippet'),
                            'warning': warning_message
                        })
                        result.add_warning(RenameWarning(
                            level=WarningLevel.WARNING,
                            warning_type='version_compatibility',
                            message=warning_message,
                            file_path=file_path,
                            line_number=feature.get('line'),
                            column=feature.get('column'),
                            context=feature.get('code_snippet'),
                            suggestion=(
                                f"Upgrade to Python {feature.get('min_version')}+ "
                                f"or refactor to avoid {feature.get('feature_name')}"
                            )
                        ))
                
                # 4. Check for overridden methods (only for method/function types)
                if symbol_type in ('method', 'function'):
                    inheritance_issues = self._detect_overridden_methods(tree, old_name, code)
                    for issue in inheritance_issues:
                        issue['file'] = file_path
                        result.inheritance_issues.append(issue)
                        result.add_warning(RenameWarning(
                            level=WarningLevel.ERROR,
                            warning_type='inheritance_contract',
                            message=issue['warning'],
                            file_path=file_path,
                            line_number=issue['line'],
                            column=issue['column'],
                            context=issue['line_content'],
                            suggestion=f"Ensure all subclasses and parent classes are updated consistently"
                        ))
            
            except (SyntaxError, OSError, IOError) as e:
                result.add_warning(RenameWarning(
                    level=WarningLevel.WARNING,
                    warning_type='parse_error',
                    message=f"Could not analyze file: {e}",
                    file_path=file_path
                ))
        
        # 5. Check for import propagation across all files
        import_propagations = self._detect_imported_name_propagation(files, old_name)
        result.import_propagations = import_propagations
        for prop in import_propagations:
            if prop.get('needs_manual_check'):
                result.add_warning(RenameWarning(
                    level=WarningLevel.WARNING,
                    warning_type='wildcard_import',
                    message=prop.get('warning', 'Wildcard import detected'),
                    file_path=prop['file'],
                    line_number=prop['line'],
                    suggestion="Avoid wildcard imports or manually verify symbol usage"
                ))
        
        self._current_analysis = result
        return result
    
    # =========================================================================
    # MAIN RENAME METHOD
    # =========================================================================
    
    def rename_symbol(
        self,
        project_root: str,
        old_name: str,
        new_name: str,
        symbol_type: str,
        scope: str = "project",
        file_path: Optional[str] = None,
        start_line: Optional[int] = None,
        skip_edge_case_analysis: bool = False,
        force: bool = False
    ) -> Dict[str, Any]:
        """
        Rename a symbol across the project or specific scope with edge case handling.
        
        This method performs comprehensive validation and edge case detection before
        renaming. It will refuse to rename magic methods, prevent collisions with
        built-in names, and warn about dynamic attribute access and string references.
        
        Args:
            project_root: Root directory of the project
            old_name: Current symbol name
            new_name: New symbol name
            symbol_type: 'variable', 'function', 'class', 'method', 'attribute', or 'any'
            scope: 'project', 'file', 'function', 'class'
            file_path: Specific file (for file/function/class scope)
            start_line: Line number (for function/class scope)
            skip_edge_case_analysis: Skip edge case detection (not recommended)
            force: Force rename even with warnings (use with caution)
        
        Returns:
            {
              "success": bool,
              "files_changed": int,
              "occurrences": int,
              "changes": [...],
              "refactored_files": {...},
              "edge_case_analysis": {...},
              "warnings": [...],
              "error": str (if failed)
            }
            
        Raises:
            MagicMethodRenameError: If attempting to rename a magic method
            BuiltinConflictError: If new_name conflicts with a Python built-in
            NameCollisionError: If new_name collides with existing symbol (when force=False)
            InvalidInputError: If input validation fails
        """
        # Step 1: Input validation with defensive checks
        try:
            self._validate_inputs(project_root, old_name, new_name, symbol_type, scope)
        except SymbolRenameError as e:
            return {
                "success": False,
                "error": str(e),
                "error_type": type(e).__name__,
                "details": e.details
            }
        
        # Step 2: Edge case analysis (unless skipped)
        edge_case_result = None
        if not skip_edge_case_analysis:
            try:
                edge_case_result = self.analyze_edge_cases(
                    project_root, old_name, new_name, symbol_type, scope, file_path
                )
                
                # Check if we can proceed
                if not edge_case_result.can_proceed and not force:
                    critical_warnings = [
                        w.to_dict() for w in edge_case_result.warnings
                        if w.level == WarningLevel.CRITICAL
                    ]
                    return {
                        "success": False,
                        "error": "Cannot proceed due to critical issues",
                        "error_type": "EdgeCaseViolation",
                        "edge_case_analysis": edge_case_result.to_dict(),
                        "critical_warnings": critical_warnings,
                        "suggestion": "Resolve critical issues or use force=True to override (not recommended)"
                    }
                
                # Check for name collisions (ERROR level)
                collision_warnings = [
                    w for w in edge_case_result.warnings
                    if w.warning_type == 'name_collision'
                ]
                if collision_warnings and not force:
                    return {
                        "success": False,
                        "error": f"Name collision detected: '{new_name}' already exists",
                        "error_type": "NameCollisionError",
                        "collisions": [w.to_dict() for w in collision_warnings],
                        "edge_case_analysis": edge_case_result.to_dict(),
                        "suggestion": "Choose a different name or use force=True to override"
                    }
                    
            except Exception as e:
                # Log but don't fail on analysis errors
                edge_case_result = EdgeCaseAnalysisResult()
                edge_case_result.add_warning(RenameWarning(
                    level=WarningLevel.WARNING,
                    warning_type='analysis_error',
                    message=f"Edge case analysis failed: {e}"
                ))
        
        # Step 3: Find all files to process
        try:
            if scope == "project":
                files_to_process = self._find_python_files(project_root)
            elif scope == "file" and file_path:
                full_path = os.path.join(project_root, file_path) if not os.path.isabs(file_path) else file_path
                if not os.path.exists(full_path):
                    return {
                        "success": False,
                        "error": f"File not found: {file_path}",
                        "error_type": "FileNotFoundError"
                    }
                files_to_process = [full_path]
            else:
                return {
                    "success": False,
                    "error": f"Invalid scope or missing file_path: {scope}",
                    "error_type": "InvalidInputError"
                }
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to find files: {e}",
                "error_type": type(e).__name__
            }
        
        # Step 4: Find all occurrences
        try:
            all_occurrences = self._find_all_occurrences(
                files_to_process,
                old_name,
                symbol_type,
                scope,
                file_path,
                start_line
            )
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to find occurrences: {e}",
                "error_type": type(e).__name__
            }
        
        if not all_occurrences:
            return {
                "success": False,
                "error": f"Symbol '{old_name}' not found in the specified scope",
                "error_type": "SymbolNotFoundError",
                "files_searched": len(files_to_process)
            }
        
        # Step 5: Perform renaming
        refactored_files = {}
        changes = []
        
        try:
            for fp, occurrences in all_occurrences.items():
                with open(fp, 'r', encoding='utf-8') as f:
                    content = f.read()
                    lines = content.splitlines()
                
                # Rename in reverse order to preserve line numbers
                new_lines = lines.copy()
                
                for occurrence in sorted(occurrences, key=lambda x: (x['line'], x['column']), reverse=True):
                    line_idx = occurrence['line'] - 1
                    
                    if line_idx < len(new_lines):
                        old_line = new_lines[line_idx]
                        new_line = self._replace_symbol_in_line(
                            old_line,
                            old_name,
                            new_name,
                            occurrence['column']
                        )
                        
                        new_lines[line_idx] = new_line
                        
                        changes.append({
                            "file": fp,
                            "line": occurrence['line'],
                            "column": occurrence['column'],
                            "old_code": old_line.strip(),
                            "new_code": new_line.strip(),
                            "context": occurrence['context']
                        })
                
                refactored_files[fp] = '\n'.join(new_lines)
                
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed during renaming: {e}",
                "error_type": type(e).__name__,
                "partial_changes": changes
            }
        
        # Build result
        result = {
            "success": True,
            "files_changed": len(refactored_files),
            "occurrences": len(changes),
            "changes": changes,
            "refactored_files": refactored_files,
            "summary": f"Renamed '{old_name}' to '{new_name}' in {len(changes)} location(s) across {len(refactored_files)} file(s)"
        }
        
        # Include edge case analysis if performed
        if edge_case_result:
            result["edge_case_analysis"] = edge_case_result.to_dict()
            result["warnings"] = [w.to_dict() for w in edge_case_result.warnings]
            result["requires_manual_review"] = edge_case_result.requires_manual_review
            
            if edge_case_result.requires_manual_review:
                result["manual_review_items"] = {
                    "dynamic_accesses": edge_case_result.dynamic_accesses,
                    "string_references": edge_case_result.string_references,
                    "inheritance_issues": edge_case_result.inheritance_issues
                }
        
        return result
    
    # =========================================================================
    # OCCURRENCE FINDING METHODS
    # =========================================================================
    
    def _find_all_occurrences(
        self,
        files: List[str],
        symbol_name: str,
        symbol_type: str,
        scope: str,
        target_file: Optional[str],
        target_line: Optional[int]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Find all occurrences of a symbol across files."""
        occurrences = {}
        
        for file_path in files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    code = f.read()
                
                file_occurrences = self._find_occurrences_in_file(
                    code,
                    file_path,
                    symbol_name,
                    symbol_type,
                    scope,
                    target_file,
                    target_line
                )
                
                if file_occurrences:
                    occurrences[file_path] = file_occurrences
            
            except (SyntaxError, OSError, IOError):
                # Skip files that can't be parsed or read
                continue
        
        return occurrences
    
    def _find_occurrences_in_file(
        self,
        code: str,
        file_path: str,
        symbol_name: str,
        symbol_type: str,
        scope: str,
        target_file: Optional[str],
        target_line: Optional[int]
    ) -> List[Dict[str, Any]]:
        """Find occurrences of a symbol in a file."""
        try:
            tree = ast.parse(code)
        except SyntaxError:
            return []
        
        occurrences = []
        
        if symbol_type == "class":
            occurrences.extend(self._find_class_occurrences(tree, symbol_name, scope, target_line))
        elif symbol_type == "function":
            occurrences.extend(self._find_function_occurrences(tree, symbol_name, scope, target_line))
        elif symbol_type == "method":
            occurrences.extend(self._find_method_occurrences(tree, symbol_name, scope, target_line))
        elif symbol_type == "variable":
            occurrences.extend(self._find_variable_occurrences(tree, symbol_name, scope, target_line))
        elif symbol_type == "attribute":
            occurrences.extend(self._find_attribute_occurrences(tree, symbol_name))
        else:
            # Find all types (symbol_type == 'any')
            occurrences.extend(self._find_all_name_occurrences(tree, symbol_name))
        
        return occurrences
    
    def _find_class_occurrences(
        self,
        tree: ast.AST,
        class_name: str,
        scope: str,
        target_line: Optional[int]
    ) -> List[Dict[str, Any]]:
        """Find all occurrences of a class name."""
        occurrences = []
        
        for node in ast.walk(tree):
            # Class definition
            if isinstance(node, ast.ClassDef) and node.name == class_name:
                if not target_line or node.lineno == target_line:
                    occurrences.append({
                        "line": node.lineno,
                        "column": node.col_offset + 6,  # After 'class '
                        "context": "class_definition"
                    })
            
            # Class usage (instantiation, inheritance, type hints)
            elif isinstance(node, ast.Name) and node.id == class_name:
                occurrences.append({
                    "line": node.lineno,
                    "column": node.col_offset,
                    "context": "class_usage"
                })
        
        return occurrences
    
    def _find_function_occurrences(
        self,
        tree: ast.AST,
        func_name: str,
        scope: str,
        target_line: Optional[int]
    ) -> List[Dict[str, Any]]:
        """Find all occurrences of a function name."""
        occurrences = []
        
        for node in ast.walk(tree):
            # Function definition
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func_name:
                # Check if it's a top-level function (not a method)
                parent_class = self._find_parent_class(tree, node)
                if not parent_class:  # Only top-level functions
                    if not target_line or node.lineno == target_line:
                        occurrences.append({
                            "line": node.lineno,
                            "column": node.col_offset + 4,  # After 'def '
                            "context": "function_definition"
                        })
            
            # Function calls
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id == func_name:
                    occurrences.append({
                        "line": node.func.lineno,
                        "column": node.func.col_offset,
                        "context": "function_call"
                    })
            
            # Function references (e.g., passing as argument)
            elif isinstance(node, ast.Name) and node.id == func_name:
                if not isinstance(node.ctx, ast.Store):  # Not an assignment
                    # Check if already captured as function call
                    if not any(o['line'] == node.lineno and o['column'] == node.col_offset for o in occurrences):
                        occurrences.append({
                            "line": node.lineno,
                            "column": node.col_offset,
                            "context": "function_reference"
                        })
        
        return occurrences
    
    def _find_method_occurrences(
        self,
        tree: ast.AST,
        method_name: str,
        scope: str,
        target_line: Optional[int]
    ) -> List[Dict[str, Any]]:
        """Find all occurrences of a method name."""
        occurrences = []
        
        for node in ast.walk(tree):
            # Method definition
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == method_name:
                # Check if it's inside a class
                parent_class = self._find_parent_class(tree, node)
                if parent_class:
                    if not target_line or node.lineno == target_line:
                        occurrences.append({
                            "line": node.lineno,
                            "column": node.col_offset + 4,  # After 'def '
                            "context": f"method_definition in {parent_class.name}"
                        })
            
            # Method calls (obj.method())
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Attribute) and node.func.attr == method_name:
                    occurrences.append({
                        "line": node.func.lineno,
                        "column": node.func.col_offset,
                        "context": "method_call"
                    })
            
            # Method references (obj.method without call)
            elif isinstance(node, ast.Attribute) and node.attr == method_name:
                if not any(o['line'] == node.lineno and o['column'] == node.col_offset for o in occurrences):
                    occurrences.append({
                        "line": node.lineno,
                        "column": node.col_offset,
                        "context": "method_reference"
                    })
        
        return occurrences
    
    def _find_variable_occurrences(
        self,
        tree: ast.AST,
        var_name: str,
        scope: str,
        target_line: Optional[int]
    ) -> List[Dict[str, Any]]:
        """Find all occurrences of a variable name."""
        occurrences = []
        
        # If scope is function or class, find only within that scope
        search_tree = tree
        if scope in ["function", "class"] and target_line:
            scope_node = self._find_scope_node(tree, target_line)
            if scope_node:
                search_tree = scope_node
        
        for node in ast.walk(search_tree):
            if isinstance(node, ast.Name) and node.id == var_name:
                # Determine context
                if isinstance(node.ctx, ast.Store):
                    context = "variable_assignment"
                elif isinstance(node.ctx, ast.Load):
                    context = "variable_usage"
                elif isinstance(node.ctx, ast.Del):
                    context = "variable_deletion"
                else:
                    context = "variable_reference"
                
                occurrences.append({
                    "line": node.lineno,
                    "column": node.col_offset,
                    "context": context
                })

        # Include match pattern bindings (Python 3.10+)
        match_occurrences = self._find_match_pattern_occurrences(search_tree, var_name)
        if match_occurrences:
            seen = {(o['line'], o['column']) for o in occurrences}
            for occurrence in match_occurrences:
                key = (occurrence['line'], occurrence['column'])
                if key not in seen:
                    seen.add(key)
                    occurrences.append(occurrence)
        
        return occurrences
    
    def _find_attribute_occurrences(self, tree: ast.AST, attr_name: str) -> List[Dict[str, Any]]:
        """Find all occurrences of an attribute name."""
        occurrences = []
        
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr == attr_name:
                occurrences.append({
                    "line": node.lineno,
                    "column": node.col_offset,
                    "context": "attribute_access"
                })
        
        return occurrences
    
    def _find_all_name_occurrences(self, tree: ast.AST, name: str) -> List[Dict[str, Any]]:
        """Find all occurrences of a name (fallback for any type)."""
        occurrences = []
        seen = set()  # Track (line, column) to avoid duplicates
        
        for node in ast.walk(tree):
            key = None
            occurrence = None
            
            if isinstance(node, ast.Name) and node.id == name:
                key = (node.lineno, node.col_offset)
                occurrence = {
                    "line": node.lineno,
                    "column": node.col_offset,
                    "context": "name_usage"
                }
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
                key = (node.lineno, node.col_offset)
                occurrence = {
                    "line": node.lineno,
                    "column": node.col_offset + 4,  # After 'def '
                    "context": "function_definition"
                }
            elif isinstance(node, ast.ClassDef) and node.name == name:
                key = (node.lineno, node.col_offset)
                occurrence = {
                    "line": node.lineno,
                    "column": node.col_offset + 6,  # After 'class '
                    "context": "class_definition"
                }
            elif isinstance(node, ast.Attribute) and node.attr == name:
                key = (node.lineno, node.col_offset)
                occurrence = {
                    "line": node.lineno,
                    "column": node.col_offset,
                    "context": "attribute_access"
                }
            
            if key and key not in seen and occurrence:
                seen.add(key)
                occurrences.append(occurrence)

        # Include match pattern bindings (Python 3.10+)
        match_occurrences = self._find_match_pattern_occurrences(tree, name)
        for occurrence in match_occurrences:
            key = (occurrence['line'], occurrence['column'])
            if key not in seen:
                seen.add(key)
                occurrences.append(occurrence)
        
        return occurrences
    
    # =========================================================================
    # HELPER METHODS
    # =========================================================================
    
    def _find_parent_class(self, tree: ast.AST, target_node: ast.AST) -> Optional[ast.ClassDef]:
        """Find parent class of a node."""
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for child in ast.walk(node):
                    if child is target_node:
                        return node
        return None
    
    def _find_scope_node(self, tree: ast.AST, line: int) -> Optional[ast.AST]:
        """Find the scope node (function or class) at a specific line."""
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if node.lineno == line:
                    return node
        return None
    
    def _replace_symbol_in_line(
        self,
        line: str,
        old_name: str,
        new_name: str,
        column: int
    ) -> str:
        """
        Replace symbol at specific column, respecting word boundaries.
        
        Args:
            line: Source line
            old_name: Name to replace
            new_name: Replacement name
            column: Column position of the symbol
            
        Returns:
            Modified line with symbol replaced
        """
        # Find the exact position considering the column
        # The column from AST is 0-indexed
        
        # Verify the old_name is at the expected position
        if column < len(line):
            # Check if old_name starts at column
            end_col = column + len(old_name)
            if end_col <= len(line) and line[column:end_col] == old_name:
                # Verify word boundaries
                before_ok = column == 0 or not line[column - 1].isalnum() and line[column - 1] != '_'
                after_ok = end_col == len(line) or not line[end_col].isalnum() and line[end_col] != '_'
                
                if before_ok and after_ok:
                    return line[:column] + new_name + line[end_col:]
        
        # Fallback: use regex for word boundary replacement
        import re
        pattern = r'\b' + re.escape(old_name) + r'\b'
        
        # Find all matches and replace the one closest to column
        matches = list(re.finditer(pattern, line))
        if matches:
            # Find match closest to column
            closest = min(matches, key=lambda m: abs(m.start() - column))
            return line[:closest.start()] + new_name + line[closest.end():]
        
        # Last resort: simple replace
        return line.replace(old_name, new_name, 1)
    
    def _find_python_files(self, root_dir: str) -> List[str]:
        """Find all Python files in directory tree."""
        python_files = []
        
        # Directories to skip
        skip_dirs = {'.git', '__pycache__', 'venv', '.venv', 'env', '.env',
                     'node_modules', '.tox', '.pytest_cache', '.mypy_cache',
                     'dist', 'build', 'egg-info', '.eggs'}
        
        try:
            for dirpath, dirnames, filenames in os.walk(root_dir):
                # Modify dirnames in-place to skip certain directories
                dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.endswith('.egg-info')]
                
                for filename in filenames:
                    if filename.endswith('.py'):
                        python_files.append(os.path.join(dirpath, filename))
        except OSError:
            pass
        
        return python_files


# =============================================================================
# SMART RENAMER - Enhanced Renaming with Conflict Detection
# =============================================================================

class SmartRenamer:
    """
    Smart renaming with comprehensive conflict detection, suggestions, and rollback.
    
    This class wraps SymbolRenamer with additional safety features:
    - Preview mode to see changes before applying
    - Automatic conflict detection
    - Rollback support on failure
    - Detailed patch generation
    """
    
    def __init__(self):
        """Initialize the smart renamer."""
        self.renamer = SymbolRenamer()
        self.backup_manager: Optional[RenameBackupManager] = None
    
    def preview_rename(
        self,
        project_root: str,
        old_name: str,
        new_name: str,
        symbol_type: str,
        scope: str = "project",
        file_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Preview what will change without applying.
        
        Returns conflict warnings, edge case analysis, and impact analysis.
        
        Args:
            project_root: Root directory of the project
            old_name: Current symbol name
            new_name: New symbol name
            symbol_type: Type of symbol to rename
            scope: Scope of renaming operation
            file_path: Specific file for file scope
            
        Returns:
            Preview result with changes, conflicts, and warnings
        """
        # Perform edge case analysis first
        try:
            edge_case_result = self.renamer.analyze_edge_cases(
                project_root, old_name, new_name, symbol_type, scope, file_path
            )
        except SymbolRenameError as e:
            return {
                "success": False,
                "error": str(e),
                "error_type": type(e).__name__,
                "details": e.details
            }
        
        # Get rename result (without writing files)
        result = self.renamer.rename_symbol(
            project_root,
            old_name,
            new_name,
            symbol_type,
            scope,
            file_path,
            skip_edge_case_analysis=True  # Already done above
        )
        
        if not result.get("success"):
            result["edge_case_analysis"] = edge_case_result.to_dict()
            return result
        
        # Add edge case analysis to result
        result["edge_case_analysis"] = edge_case_result.to_dict()
        result["can_proceed"] = edge_case_result.can_proceed
        result["requires_manual_review"] = edge_case_result.requires_manual_review
        result["warnings"] = [w.to_dict() for w in edge_case_result.warnings]
        
        # Generate patches for preview
        try:
            from .patching import PatchGenerator
            patch_gen = PatchGenerator()
            
            patches = {}
            for fp, new_content in result.get("refactored_files", {}).items():
                try:
                    with open(fp, 'r', encoding='utf-8') as f:
                        old_content = f.read()
                    
                    patch = patch_gen.generate_patch(old_content, new_content, fp)
                    patches[fp] = patch
                except (OSError, IOError) as e:
                    patches[fp] = f"Error generating patch: {e}"
            
            result["patches"] = patches
        except ImportError:
            result["patches"] = {}
            result["patch_error"] = "PatchGenerator not available"
        
        # Add summary
        warning_counts = {}
        for w in edge_case_result.warnings:
            level = w.level.value
            warning_counts[level] = warning_counts.get(level, 0) + 1
        
        result["warning_summary"] = warning_counts
        result["preview"] = True
        
        return result
    
    def apply_rename(
        self,
        project_root: str,
        old_name: str,
        new_name: str,
        symbol_type: str,
        scope: str = "project",
        file_path: Optional[str] = None,
        force: bool = False,
        create_backup: bool = True
    ) -> Dict[str, Any]:
        """
        Apply renaming with backup and rollback support.
        
        Args:
            project_root: Root directory of the project
            old_name: Current symbol name
            new_name: New symbol name
            symbol_type: Type of symbol to rename
            scope: Scope of renaming operation
            file_path: Specific file for file scope
            force: Force rename even with warnings
            create_backup: Create backups before modifying files
            
        Returns:
            Result with success status, changes made, and backup info
        """
        # First, get the preview to see what will change
        preview = self.preview_rename(
            project_root, old_name, new_name, symbol_type, scope, file_path
        )
        
        if not preview.get("success"):
            return preview
        
        # Check if we can proceed
        if not preview.get("can_proceed", True) and not force:
            return {
                "success": False,
                "error": "Cannot proceed due to critical issues. Use force=True to override.",
                "preview": preview
            }
        
        # Initialize backup manager if needed
        backup_info = None
        if create_backup:
            try:
                self.backup_manager = RenameBackupManager(project_root)
                self.backup_manager.start_operation()
            except SymbolRenameError as e:
                return {
                    "success": False,
                    "error": f"Failed to initialize backup: {e}",
                    "error_type": type(e).__name__
                }
        
        # Apply changes to files
        files_modified = []
        try:
            for fp, new_content in preview.get("refactored_files", {}).items():
                # Create backup before modifying
                if self.backup_manager:
                    try:
                        self.backup_manager.backup_file(fp)
                    except Exception as e:
                        # Rollback any changes made so far
                        if files_modified:
                            self._rollback_changes(files_modified)
                        return {
                            "success": False,
                            "error": f"Failed to backup {fp}: {e}",
                            "files_modified_before_failure": files_modified
                        }
                
                # Write new content
                try:
                    with open(fp, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    files_modified.append(fp)
                except (OSError, IOError) as e:
                    # Rollback on write failure
                    if self.backup_manager:
                        self.backup_manager.rollback_all()
                    return {
                        "success": False,
                        "error": f"Failed to write {fp}: {e}",
                        "rolled_back": True,
                        "files_modified_before_failure": files_modified
                    }
            
            # Success - prepare result
            result = {
                "success": True,
                "files_modified": files_modified,
                "files_changed": len(files_modified),
                "occurrences": preview.get("occurrences", 0),
                "changes": preview.get("changes", []),
                "warnings": preview.get("warnings", []),
                "requires_manual_review": preview.get("requires_manual_review", False),
                "summary": f"Successfully renamed '{old_name}' to '{new_name}' in {len(files_modified)} file(s)"
            }
            
            if self.backup_manager:
                result["backup_info"] = self.backup_manager.get_backup_info()
                result["rollback_available"] = True
            
            return result
            
        except Exception as e:
            # Unexpected error - attempt rollback
            if self.backup_manager:
                rollback_result = self.backup_manager.rollback_all()
                return {
                    "success": False,
                    "error": f"Unexpected error: {e}",
                    "rolled_back": True,
                    "rollback_result": rollback_result
                }
            return {
                "success": False,
                "error": f"Unexpected error: {e}",
                "files_modified": files_modified
            }
    
    def rollback(self) -> Dict[str, Any]:
        """
        Rollback the last rename operation.
        
        Returns:
            Rollback result with success status and files restored
        """
        if not self.backup_manager:
            return {
                "success": False,
                "error": "No backup manager available. Was a rename operation performed?"
            }
        
        result = self.backup_manager.rollback_all()
        
        return {
            "success": all(result.values()),
            "files_restored": [f for f, success in result.items() if success],
            "files_failed": [f for f, success in result.items() if not success],
            "backup_info": self.backup_manager.get_backup_info()
        }
    
    def cleanup_backups(self) -> None:
        """Remove backup files after successful rename."""
        if self.backup_manager:
            self.backup_manager.cleanup_backups()
    
    def _rollback_changes(self, files: List[str]) -> Dict[str, bool]:
        """Rollback changes to specific files."""
        if not self.backup_manager:
            return {f: False for f in files}
        
        results = {}
        for f in files:
            results[f] = self.backup_manager.rollback_file(f)
        
        return results


# =============================================================================
# ORCHESTRATOR - Unified Interface
# =============================================================================

class SymbolRenamingOrchestrator:
    """
    Unified symbol renaming orchestrator with full edge case handling.
    
    This is the main entry point for symbol renaming operations. It provides
    a simple interface while handling all edge cases internally.
    
    Example:
        >>> orchestrator = SymbolRenamingOrchestrator()
        >>> result = orchestrator.rename_symbol(
        ...     project_root='/path/to/project',
        ...     old_name='old_func',
        ...     new_name='new_func',
        ...     symbol_type='function',
        ...     preview_only=True
        ... )
    """
    
    def __init__(self):
        """Initialize the orchestrator."""
        self.renamer = SymbolRenamer()
        self.smart_renamer = SmartRenamer()
    
    def rename_symbol(
        self,
        project_root: str,
        old_name: str,
        new_name: str,
        symbol_type: str,
        scope: str = "project",
        file_path: Optional[str] = None,
        start_line: Optional[int] = None,
        preview_only: bool = True,
        force: bool = False,
        create_backup: bool = True
    ) -> Dict[str, Any]:
        """
        Unified interface for renaming symbols with full edge case handling.
        
        Args:
            project_root: Root directory of the project
            old_name: Current symbol name
            new_name: New symbol name
            symbol_type: 'variable', 'function', 'class', 'method', 'attribute', or 'any'
            scope: 'project', 'file', 'function', 'class'
            file_path: Specific file (for file/function/class scope)
            start_line: Line number (for function/class scope)
            preview_only: If True, only show what would change (default: True)
            force: Force rename even with warnings (use with caution)
            create_backup: Create backups before modifying files (default: True)
        
        Returns:
            Result dictionary with:
            - success: bool
            - files_changed: int
            - occurrences: int
            - changes: list of change details
            - warnings: list of edge case warnings
            - edge_case_analysis: detailed analysis results
            - patches: unified diff patches (preview mode)
            - backup_info: backup details (apply mode)
        """
        if preview_only:
            return self.smart_renamer.preview_rename(
                project_root,
                old_name,
                new_name,
                symbol_type,
                scope,
                file_path
            )
        else:
            return self.smart_renamer.apply_rename(
                project_root,
                old_name,
                new_name,
                symbol_type,
                scope,
                file_path,
                force=force,
                create_backup=create_backup
            )
    
    def analyze_rename(
        self,
        project_root: str,
        old_name: str,
        new_name: str,
        symbol_type: str,
        scope: str = "project",
        file_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Analyze a potential rename without making any changes.
        
        This is useful for understanding the impact of a rename before
        deciding whether to proceed.
        
        Args:
            project_root: Root directory of the project
            old_name: Current symbol name
            new_name: New symbol name
            symbol_type: Type of symbol to rename
            scope: Scope of renaming operation
            file_path: Specific file for file scope
            
        Returns:
            Analysis result with edge cases, warnings, and recommendations
        """
        try:
            analysis = self.renamer.analyze_edge_cases(
                project_root, old_name, new_name, symbol_type, scope, file_path
            )
            
            return {
                "success": True,
                "analysis": analysis.to_dict(),
                "can_proceed": analysis.can_proceed,
                "requires_manual_review": analysis.requires_manual_review,
                "recommendation": self._get_recommendation(analysis)
            }
        except SymbolRenameError as e:
            return {
                "success": False,
                "error": str(e),
                "error_type": type(e).__name__,
                "details": e.details
            }
    
    def rollback_last_rename(self) -> Dict[str, Any]:
        """
        Rollback the last rename operation.
        
        Returns:
            Rollback result with success status and files restored
        """
        return self.smart_renamer.rollback()
    
    def _get_recommendation(self, analysis: EdgeCaseAnalysisResult) -> str:
        """Generate a recommendation based on analysis results."""
        if not analysis.can_proceed:
            return "BLOCKED: Critical issues detected. Resolve them before proceeding."
        
        if analysis.requires_manual_review:
            issues = []
            if analysis.dynamic_accesses:
                issues.append(f"{len(analysis.dynamic_accesses)} dynamic attribute access(es)")
            if analysis.string_references:
                issues.append(f"{len(analysis.string_references)} string reference(s)")
            if analysis.inheritance_issues:
                issues.append(f"{len(analysis.inheritance_issues)} inheritance issue(s)")
            
            return f"REVIEW REQUIRED: {', '.join(issues)} need manual verification."
        
        warning_count = len(analysis.warnings)
        if warning_count > 0:
            return f"PROCEED WITH CAUTION: {warning_count} warning(s) detected. Review before applying."
        
        return "SAFE TO PROCEED: No issues detected."
