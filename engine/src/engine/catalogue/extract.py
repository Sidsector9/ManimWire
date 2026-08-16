"""Build descriptors for classes, methods, and functions from their signatures."""

from __future__ import annotations

import ast
import inspect
import re
import textwrap
from collections.abc import Callable
from typing import Any, Literal

from engine.catalogue.annotations import TypeContext, map_annotation
from engine.catalogue.defaults import format_default
from engine.catalogue.model import Descriptor, Parameter, PortType, TypeRef

_ROLE = re.compile(r":[a-z]+:`~?([^`]+)`")
_WHITESPACE = re.compile(r"\s+")


def first_paragraph(doc: str | None) -> str:
    if not doc:
        return ""
    paragraph = inspect.cleandoc(doc).split("\n\n", 1)[0]
    paragraph = _ROLE.sub(lambda m: m.group(1).rsplit(".", 1)[-1], paragraph)
    return _WHITESPACE.sub(" ", paragraph).strip()


def _annotation_text(annotation: Any) -> str:
    if annotation is inspect.Parameter.empty:
        return ""
    return (
        annotation
        if isinstance(annotation, str)
        else getattr(annotation, "__name__", str(annotation))
    )


def _parameters(
    signature: inspect.Signature,
    owner: str,
    context: TypeContext,
    self_type: PortType | None,
    seen: set[str],
    skip_positional: int = 0,
) -> tuple[list[Parameter], bool]:
    """Parameters of one signature (without self), and whether it takes **kwargs."""
    parameters: list[Parameter] = []
    accepts_kwargs = False
    for name, param in signature.parameters.items():
        if name == "self":
            continue
        if skip_positional and param.kind is not inspect.Parameter.VAR_KEYWORD:
            skip_positional -= 1
            seen.add(name)
            continue
        if name.startswith("_") or name in seen:
            continue
        if param.kind is inspect.Parameter.VAR_KEYWORD:
            accepts_kwargs = True
            continue
        seen.add(name)
        kind: Literal["positional", "keyword_only", "var_positional"]
        if param.kind is inspect.Parameter.VAR_POSITIONAL:
            kind = "var_positional"
        elif param.kind is inspect.Parameter.KEYWORD_ONLY:
            kind = "keyword_only"
        else:
            kind = "positional"
        default, display = format_default(param.default)
        parameters.append(
            Parameter(
                name=name,
                type=map_annotation(
                    _annotation_text(param.annotation), context, self_type
                ),
                kind=kind,
                default=default,
                display=display,
                owner=owner,
            )
        )
    return parameters, accepts_kwargs


def _super_call_arguments(init: Callable[..., Any]) -> tuple[int, set[str]]:
    """Positional count and keyword names in ``super().__init__(...)`` calls."""
    try:
        tree = ast.parse(textwrap.dedent(inspect.getsource(init)))
    except (OSError, TypeError, SyntaxError):
        return 0, set()
    positional = 0
    keywords: set[str] = set()
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr != "__init__" or not _is_super(node.func.value):
            continue
        positional = max(
            positional, sum(1 for a in node.args if not isinstance(a, ast.Starred))
        )
        keywords.update(k.arg for k in node.keywords if k.arg is not None)
    return positional, keywords


def _is_super(node: ast.expr) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "super"
    )


def class_descriptor(
    cls: type,
    module: str,
    category: str,
    context: TypeContext,
    output: PortType,
    is_vmobject: bool,
    exported: set[str],
    hidden: bool,
) -> Descriptor:
    """Constructor parameters, following ``**kwargs`` up the class hierarchy."""
    parameters: list[Parameter] = []
    seen: set[str] = set()
    accepts_kwargs = False
    positional_to_parent = 0
    for base in cls.__mro__:
        if base is object or "__init__" not in base.__dict__:
            continue
        init = base.__dict__["__init__"]
        found, accepts_kwargs = _parameters(
            inspect.signature(init),
            base.__name__,
            context,
            output,
            seen,
            positional_to_parent,
        )
        parameters.extend(found)
        if not accepts_kwargs:
            break
        # Arguments this __init__ passes to its parent explicitly are not free.
        positional_to_parent, explicit = _super_call_arguments(init)
        seen.update(explicit)
    bases = [b.__name__ for b in cls.__mro__[1:] if b.__name__ in exported]
    return Descriptor(
        name=cls.__name__,
        qualname=cls.__name__,
        module=module,
        kind="class",
        category=category,
        bases=bases,
        parameters=parameters,
        accepts_kwargs=accepts_kwargs,
        returns=TypeRef(type=output, annotation=cls.__name__),
        doc=first_paragraph(cls.__doc__),
        is_vmobject=is_vmobject,
        hidden=hidden,
    )


def method_descriptor(
    owner: type,
    name: str,
    function: Callable[..., Any],
    module: str,
    category: str,
    context: TypeContext,
    owner_type: PortType,
) -> Descriptor:
    signature = inspect.signature(function)
    parameters, accepts_kwargs = _parameters(
        signature, owner.__name__, context, owner_type, set()
    )
    return Descriptor(
        name=name,
        qualname=f"{owner.__name__}.{name}",
        module=module,
        kind="method",
        category=category,
        owner=owner.__name__,
        parameters=parameters,
        accepts_kwargs=accepts_kwargs,
        returns=map_annotation(
            _annotation_text(signature.return_annotation), context, owner_type
        ),
        doc=first_paragraph(function.__doc__),
    )


def function_descriptor(
    name: str,
    function: Callable[..., Any],
    module: str,
    category: str,
    context: TypeContext,
) -> Descriptor:
    signature = inspect.signature(function)
    parameters, accepts_kwargs = _parameters(signature, name, context, None, set())
    return Descriptor(
        name=name,
        qualname=name,
        module=module,
        kind="function",
        category=category,
        parameters=parameters,
        accepts_kwargs=accepts_kwargs,
        returns=map_annotation(
            _annotation_text(signature.return_annotation), context, None
        ),
        doc=first_paragraph(function.__doc__),
    )
