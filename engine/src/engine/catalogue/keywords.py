"""Read keyword-only options from Manim source without executing its constructors.

Signatures alone miss kwargs.pop/get and options forwarded to other callables.
Only literal keys and statically resolved calls become named ports. Dynamic calls
retain an explicit **kwargs config port rather than guessing their arguments.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import textwrap
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import cache
from typing import Any

# These receivers are loop variables, so Python signatures cannot describe them.
# Keep the mapping scoped to the method that establishes the collection's type.
_RECEIVERS = {
    ("CoordinateSystem.add_coordinates", "axis"): "NumberLine",
    ("ComplexPlane.get_coordinate_labels", "axis"): "NumberLine",
    ("Mobject.arrange", "m2"): "Mobject",
    ("Mobject.add_background_rectangle_to_submobjects", "submobject"): "Mobject",
    (
        "Mobject.add_background_rectangle_to_family_members_with_points",
        "mob",
    ): "Mobject",
}


@dataclass
class KeywordRead:
    default: ast.expr | None
    annotation: str = ""


@dataclass
class KeywordSource:
    name: str | None = None
    reads: dict[str, KeywordRead] = field(default_factory=dict)
    calls: list[ast.Call] = field(default_factory=list)
    fixed: set[str] = field(default_factory=set)


@cache
def keyword_source(function: Callable[..., Any]) -> KeywordSource:
    signature = inspect.signature(function)
    name = next(
        (
            p.name
            for p in signature.parameters.values()
            if p.kind is inspect.Parameter.VAR_KEYWORD
        ),
        None,
    )
    result = KeywordSource(name=name)
    if name is None:
        return result
    try:
        tree = ast.parse(textwrap.dedent(inspect.getsource(function)))
    except (OSError, TypeError, SyntaxError):
        return result
    annotations = {
        id(node.value): ast.unparse(node.annotation)
        for node in ast.walk(tree)
        if isinstance(node, ast.AnnAssign) and node.value is not None
    }
    conditional_nodes = {
        id(child)
        for node in ast.walk(tree)
        if isinstance(node, ast.If)
        for child in ast.walk(node)
    }
    defaults: dict[str, ast.expr] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.If) or not isinstance(node.test, ast.Compare):
            continue
        test = node.test
        if (
            isinstance(test.left, ast.Constant)
            and isinstance(test.left.value, str)
            and len(test.ops) == 1
            and isinstance(test.ops[0], ast.NotIn)
            and isinstance(test.comparators[0], ast.Name)
            and test.comparators[0].id == name
        ):
            for statement in node.body:
                if isinstance(statement, ast.Assign):
                    for target in statement.targets:
                        if (
                            isinstance(target, ast.Subscript)
                            and isinstance(target.value, ast.Name)
                            and target.value.id == name
                            and isinstance(target.slice, ast.Constant)
                            and target.slice.value == test.left.value
                        ):
                            defaults[test.left.value] = statement.value
    for key, value in defaults.items():
        result.reads[key] = KeywordRead(value)
    aliases = {name}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            value = node.value
            copied = (
                isinstance(value.func, ast.Name)
                and value.func.id == "dict"
                and value.args
                and isinstance(value.args[0], ast.Name)
                and value.args[0].id in aliases
            ) or (
                isinstance(value.func, ast.Attribute)
                and value.func.attr == "copy"
                and isinstance(value.func.value, ast.Name)
                and value.func.value.id in aliases
            )
            if copied:
                aliases.update(
                    target.id for target in node.targets if isinstance(target, ast.Name)
                )
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == name
            and node.func.attr in {"pop", "get", "setdefault"}
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            key = node.args[0].value
            result.reads.setdefault(
                key,
                KeywordRead(
                    node.args[1] if len(node.args) > 1 else None,
                    annotations.get(id(node), ""),
                ),
            )
        elif (
            isinstance(node, ast.Subscript)
            and isinstance(node.ctx, ast.Load)
            and isinstance(node.value, ast.Name)
            and node.value.id == name
            and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)
        ):
            result.reads.setdefault(node.slice.value, KeywordRead(None))
        if isinstance(node, ast.Call) and any(
            keyword.arg is None
            and isinstance(keyword.value, ast.Name)
            and keyword.value.id in aliases
            for keyword in node.keywords
        ):
            result.calls.append(node)
        if (
            isinstance(node, ast.Subscript)
            and isinstance(node.ctx, ast.Store)
            and isinstance(node.value, ast.Name)
            and node.value.id == name
            and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)
        ):
            if node.slice.value not in defaults and id(node) not in conditional_nodes:
                result.fixed.add(node.slice.value)
    return result


def static_value(node: ast.expr | None, function: Callable[..., Any]) -> Any:
    """Resolve literals and global constants; never eval calls or user code."""
    if node is None:
        return inspect.Parameter.empty
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError):
        pass
    namespace = getattr(inspect.unwrap(function), "__globals__", {})
    if isinstance(node, ast.Name):
        return namespace.get(node.id, inspect.Parameter.empty)
    return inspect.Parameter.empty


def resolve_call(
    expression: ast.expr,
    function: Callable[..., Any],
    owner: type | None,
    runtime_owner: type | None = None,
) -> tuple[Callable[..., Any], type | None] | None:
    namespace = getattr(inspect.unwrap(function), "__globals__", {})
    if isinstance(expression, ast.Name):
        target = namespace.get(expression.id)
        if inspect.isclass(target) or inspect.isfunction(target):
            return target, None
    if not isinstance(expression, ast.Attribute):
        return None
    receiver = expression.value
    cls = None
    if isinstance(receiver, ast.Name) and receiver.id == "self":
        cls = owner
    elif (
        isinstance(receiver, ast.Call)
        and isinstance(receiver.func, ast.Name)
        and receiver.func.id == "super"
        and owner
    ):
        mro = (runtime_owner or owner).__mro__
        following = mro[mro.index(owner) + 1 :] if owner in mro else owner.__mro__[1:]
        cls = next((base for base in following if expression.attr in vars(base)), None)
    if cls is not None:
        # Preserve the declaring class for any subsequent super() resolution.
        declaring = next(
            (base for base in cls.__mro__ if expression.attr in vars(base)), None
        )
        target = getattr(cls, expression.attr, None)
        if inspect.isfunction(target):
            return target, declaring
    if isinstance(receiver, ast.Name):
        obj = namespace.get(receiver.id)
        receiver_type = _RECEIVERS.get((function.__qualname__, receiver.id))
        if receiver_type:
            obj = getattr(importlib.import_module("manim"), receiver_type)
        if obj is None:
            parameter = inspect.signature(function).parameters.get(receiver.id)
            if parameter and isinstance(parameter.annotation, str):
                # A declared receiver type, not a guess from the variable's name.
                candidate = namespace.get(parameter.annotation)
                if inspect.isclass(candidate):
                    obj = candidate
        target = getattr(obj, expression.attr, None)
        if inspect.isfunction(target) or inspect.isclass(target):
            return target, obj if inspect.isclass(obj) else None
    return None
