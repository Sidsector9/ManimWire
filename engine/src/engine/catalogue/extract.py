"""Build descriptors for classes, methods, and functions from their signatures."""

from __future__ import annotations

import ast
import inspect
import re
from collections.abc import Callable
from typing import Any, Literal

from engine.catalogue.annotations import TypeContext, map_annotation
from engine.catalogue.defaults import format_default
from engine.catalogue.keywords import keyword_source, resolve_call, static_value
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
) -> tuple[list[Parameter], bool]:
    """Parameters of one signature (without self), and whether it takes **kwargs."""
    parameters: list[Parameter] = []
    accepts_kwargs = False
    for name, param in signature.parameters.items():
        if name == "self":
            continue
        if name.startswith("_") or name in seen:
            continue
        if param.kind is inspect.Parameter.VAR_KEYWORD:
            accepts_kwargs = True
            continue
        seen.add(name)
        kind: Literal["positional", "keyword_only", "var_positional", "var_keyword"]
        if param.kind is inspect.Parameter.VAR_POSITIONAL:
            kind = "var_positional"
        elif param.kind is inspect.Parameter.KEYWORD_ONLY:
            kind = "keyword_only"
        else:
            kind = "positional"
        default, display = format_default(param.default)
        annotation = _annotation_text(param.annotation)
        type_ref = map_annotation(annotation, context, self_type)
        if type_ref.type is PortType.ANY:
            value = param.default
            inferred = ""
            if isinstance(value, bool | int | float | str | dict):
                inferred = type(value).__name__
            elif inspect.isclass(value) and value is not inspect.Parameter.empty:
                inferred = f"type[{value.__name__}]"
            elif (
                inspect.isfunction(value)
                and value.__module__ == "manim.utils.rate_functions"
            ):
                inferred = "Callable[[float], float]"
            if inferred:
                type_ref = map_annotation(inferred, context, self_type)
        parameters.append(
            Parameter(
                name=name,
                type=type_ref,
                kind=kind,
                default=default,
                display=display,
                owner=owner,
            )
        )
    return parameters, accepts_kwargs


def _positional_names(
    function: Callable[..., Any],
    owner: type | None,
    visiting: frozenset[Callable[..., Any]] = frozenset(),
    runtime_owner: type | None = None,
) -> list[str]:
    """Follow *args to bind positional values without consuming keyword-only ports."""
    if function in visiting:
        return []
    visiting = visiting | {function}
    if inspect.isclass(function):
        runtime_owner = function
        owner = next(base for base in function.__mro__ if "__init__" in vars(base))
        function = vars(owner)["__init__"]
    signature = inspect.signature(function)
    names = [
        p.name
        for p in signature.parameters.values()
        if p.name not in {"self", "cls"}
        and p.kind
        in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]
    star = next(
        (
            p.name
            for p in signature.parameters.values()
            if p.kind is inspect.Parameter.VAR_POSITIONAL
        ),
        None,
    )
    if star:
        for call in keyword_source(function).calls:
            index = next(
                (
                    i
                    for i, arg in enumerate(call.args)
                    if isinstance(arg, ast.Starred)
                    and isinstance(arg.value, ast.Name)
                    and arg.value.id == star
                ),
                None,
            )
            target = resolve_call(call.func, function, owner, runtime_owner)
            if index is not None and target is not None:
                forwarded = _positional_names(*target, visiting, runtime_owner)
                names.extend(name for name in forwarded[index:] if name not in names)
                break
    return names


def callable_parameters(
    function: Callable[..., Any],
    owner: type | None,
    context: TypeContext,
    output: PortType | None,
    visiting: frozenset[Callable[..., Any]] = frozenset(),
    runtime_owner: type | None = None,
) -> tuple[list[Parameter], bool]:
    """Follow actual **kwargs forwarding, preserving options consumed by wrappers."""
    if function in visiting:
        return [], False
    visiting = visiting | {function}
    if inspect.isclass(function):
        runtime_owner = function
        owner = next(
            (base for base in function.__mro__ if "__init__" in vars(base)), function
        )
        function = vars(owner)["__init__"]
    try:
        signature = inspect.signature(function)
    except (ValueError, TypeError):
        return [], False
    label = owner.__name__ if owner else function.__name__
    parameters, accepts_kwargs = _parameters(signature, label, context, output, set())
    if not accepts_kwargs:
        return parameters, False
    source = keyword_source(function)
    by_name = {p.name: p for p in parameters}
    # Parent signatures supply types for unannotated reads, even when an explicit
    # super argument must otherwise be hidden (Write.run_time, NumberPlane.axis_config).
    templates = dict(by_name)
    if owner:
        for base in owner.__mro__[1:]:
            init = vars(base).get("__init__")
            if init is None:
                continue
            try:
                inherited, _ = _parameters(
                    inspect.signature(init), base.__name__, context, output, set()
                )
            except (ValueError, TypeError):
                continue
            for param in inherited:
                templates.setdefault(param.name, param)
    for name, read in source.reads.items():
        if name.startswith("_") or name in by_name:
            continue
        template = templates.get(name)
        if isinstance(read.default, ast.Name) and read.default.id in templates:
            template = templates[read.default.id]
        value = static_value(read.default, function)
        annotation = read.annotation
        if not annotation and template is not None:
            annotation = template.type.annotation
        if (
            not annotation
            and value is not inspect.Parameter.empty
            and value is not None
        ):
            annotation = (
                f"type[{value.__name__}]"
                if inspect.isclass(value)
                else type(value).__name__
            )
        if not annotation and name in {"tip_shape", "tip_shape_start", "tip_shape_end"}:
            annotation = "type[ArrowTip]"
        default, display = format_default(value)
        # A missing pop default may be guarded by `if key in kwargs`. Do not
        # invent a required input, nor evaluate a dynamic default at build time.
        if value is inspect.Parameter.empty:
            default = template.default if template else "None"
            display = template.display if template else "automatic"
        type_ref = map_annotation(annotation, context, output)
        if default == "None":
            type_ref = type_ref.model_copy(update={"optional": True})
        by_name[name] = Parameter(
            name=name,
            type=type_ref,
            kind="keyword_only",
            default=default,
            display=display,
            owner=label,
        )
    for call in source.calls:
        resolved = resolve_call(call.func, function, owner, runtime_owner)
        if resolved is None:
            continue
        target, target_owner = resolved
        if ".opengl" in getattr(target, "__module__", ""):
            continue  # ManimWire renders using Cairo, not OpenGL-only options.
        if target in visiting:
            continue
        forwarded, _ = callable_parameters(
            target, target_owner, context, output, visiting, runtime_owner
        )
        # Bind explicitly supplied arguments against the callee's real signature,
        # not its flattened ports: keyword-only params must never be skipped.
        positional = _positional_names(
            target, target_owner, runtime_owner=runtime_owner
        )
        fixed = {kw.arg for kw in call.keywords if kw.arg is not None}
        explicit_count = next(
            (i for i, arg in enumerate(call.args) if isinstance(arg, ast.Starred)),
            len(call.args),
        )
        if (
            call.args
            and isinstance(call.args[0], ast.Name)
            and call.args[0].id == "self"
        ):
            explicit_count = max(0, explicit_count - 1)
        fixed.update(positional[:explicit_count])
        fixed.update(source.fixed)
        for param in forwarded:
            if (
                param.name in fixed
                or param.name in by_name
                or param.kind == "var_positional"
            ):
                continue
            by_name[param.name] = param.model_copy(update={"kind": "keyword_only"})
    return list(by_name.values()), accepts_kwargs


def _add_keyword_config(
    parameters: list[Parameter], function: Callable[..., Any]
) -> None:
    """Keep dynamic keyword APIs usable even when the callee depends on inputs."""
    name = keyword_source(function).name
    if name and not any(param.name == name for param in parameters):
        parameters.append(
            Parameter(
                name=name,
                type=TypeRef(type=PortType.CONFIG, annotation="dict[str, Any]"),
                kind="var_keyword",
                default="{}",
                display="additional keyword arguments",
                owner="Keyword arguments",
            )
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
    parameters, accepts_kwargs = callable_parameters(cls, None, context, output)
    init_owner = next(base for base in cls.__mro__ if "__init__" in vars(base))
    _add_keyword_config(parameters, vars(init_owner)["__init__"])
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
    parameters, accepts_kwargs = callable_parameters(
        function, owner, context, owner_type
    )
    _add_keyword_config(parameters, function)
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


_SIGNATURE_NAMES = {
    PortType.NUMBER: "float",
    PortType.BOOLEAN: "bool",
    PortType.TEXT: "str",
    PortType.VECTOR: "point",
}


def function_signature(parameters: list[Parameter], returns: TypeRef) -> str:
    """The shape Function ports use, from required parameters: ``(float) -> float``."""
    inputs = ", ".join(
        _SIGNATURE_NAMES.get(p.type.type, p.type.annotation or "any")
        for p in parameters
        if p.default is None and p.kind != "var_positional"
    )
    output = _SIGNATURE_NAMES.get(returns.type, returns.annotation or "any")
    return f"({inputs}) -> {output}"


def function_descriptor(
    name: str,
    function: Callable[..., Any],
    module: str,
    category: str,
    context: TypeContext,
) -> Descriptor:
    signature = inspect.signature(function)
    parameters, accepts_kwargs = callable_parameters(function, None, context, None)
    _add_keyword_config(parameters, function)
    returns = map_annotation(
        _annotation_text(signature.return_annotation), context, None
    )
    return Descriptor(
        name=name,
        qualname=name,
        module=module,
        kind="function",
        category=category,
        parameters=parameters,
        accepts_kwargs=accepts_kwargs,
        returns=returns,
        doc=first_paragraph(function.__doc__),
        signature=function_signature(parameters, returns),
    )
