"""Mathematical expressions typed by the user, such as ``x^2`` or ``k / t``.

This is deliberately not Python: only numbers, variables, arithmetic, and a
fixed set of functions are accepted. Free variables become the arguments of a
Manim function; bound variables are replaced by connected values.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass

FUNCTIONS = {
    "sin": "np.sin",
    "cos": "np.cos",
    "tan": "np.tan",
    "asin": "np.arcsin",
    "acos": "np.arccos",
    "atan": "np.arctan",
    "atan2": "np.arctan2",
    "sinh": "np.sinh",
    "cosh": "np.cosh",
    "tanh": "np.tanh",
    "exp": "np.exp",
    "log": "np.log",
    "log10": "np.log10",
    "sqrt": "np.sqrt",
    "abs": "abs",
    "floor": "np.floor",
    "ceil": "np.ceil",
    "sign": "np.sign",
    "min": "min",
    "max": "max",
}
CONSTANTS = {"pi": "PI", "tau": "TAU", "e": "np.e"}
# Names the generated code uses around an expression; a variable would shadow them.
RESERVED = {"expr", "np", "self", "mob", "PI", "TAU"}
_OPERATORS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.FloorDiv)
_COMPARISONS = (ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq)


class ExpressionError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedExpression:
    text: str
    variables: list[str]
    tree: ast.expr

    @property
    def boolean(self) -> bool:
        """Whether the value is a truth value (comparison, and, or, not)."""
        return isinstance(self.tree, ast.Compare | ast.BoolOp) or (
            isinstance(self.tree, ast.UnaryOp) and isinstance(self.tree.op, ast.Not)
        )


def parse_expression(text: str) -> ParsedExpression:
    """Parse and check an expression. Raises ExpressionError for anything but math."""
    if not text.strip():
        raise ExpressionError("expression is empty")
    try:
        tree = ast.parse(text.replace("^", "**"), mode="eval").body
    except SyntaxError as exc:
        raise ExpressionError(f"cannot read expression: {exc.msg}") from exc
    variables: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp):
            if not isinstance(node.op, _OPERATORS):
                raise ExpressionError("only + - * / ^ % and // are allowed")
        elif isinstance(node, ast.UnaryOp):
            if not isinstance(node.op, ast.UAdd | ast.USub | ast.Not):
                raise ExpressionError("only unary + and - and not are allowed")
        elif isinstance(node, ast.Compare):
            if not all(isinstance(op, _COMPARISONS) for op in node.ops):
                raise ExpressionError(
                    "only < <= > >= == and != comparisons are allowed"
                )
        elif isinstance(node, ast.BoolOp):
            pass  # and, or
        elif isinstance(node, ast.Constant):
            if not isinstance(node.value, int | float) or isinstance(node.value, bool):
                raise ExpressionError("only numbers are allowed as constants")
        elif isinstance(node, ast.Call):
            name = node.func.id if isinstance(node.func, ast.Name) else None
            if name not in FUNCTIONS:
                raise ExpressionError(f"unknown function {ast.unparse(node.func)}")
            if node.keywords:
                raise ExpressionError("functions take positional arguments only")
        elif isinstance(node, ast.Name):
            if node.id in RESERVED:
                raise ExpressionError(f"{node.id} cannot be used as a variable name")
            if node.id not in FUNCTIONS and node.id not in CONSTANTS:
                if node.id not in variables:
                    variables.append(node.id)
        elif not isinstance(
            node, ast.expr_context | ast.operator | ast.unaryop | ast.cmpop | ast.boolop
        ):
            raise ExpressionError(
                f"{type(node).__name__} is not allowed in an expression"
            )
    return ParsedExpression(text=text, variables=sorted(variables), tree=tree)


@dataclass(frozen=True)
class ExpressionSource:
    """Python source for an expression: a value, or a lambda over free variables."""

    source: str
    free: list[str]
    uses_numpy: bool


class _Rewrite(ast.NodeTransformer):
    def __init__(self, bindings: dict[str, str]) -> None:
        self.bindings = bindings
        self.uses_numpy = False

    def visit_Name(self, node: ast.Name) -> ast.expr:
        if node.id in self.bindings:
            return ast.parse(self.bindings[node.id], mode="eval").body
        if node.id in CONSTANTS:
            replacement = CONSTANTS[node.id]
            self.uses_numpy |= replacement.startswith("np.")
            return ast.parse(replacement, mode="eval").body
        return node

    def visit_Call(self, node: ast.Call) -> ast.expr:
        self.generic_visit(node)
        assert isinstance(node.func, ast.Name)
        replacement = FUNCTIONS[node.func.id]
        self.uses_numpy |= replacement.startswith("np.")
        node.func = ast.parse(replacement, mode="eval").body
        return node


def to_source(parsed: ParsedExpression, bindings: dict[str, str]) -> ExpressionSource:
    """Python for the expression. ``bindings`` map variables to Python expressions.

    Variables without a binding stay free and become lambda parameters.
    """
    rewrite = _Rewrite(bindings)
    tree = rewrite.visit(ast.parse(parsed.text.replace("^", "**"), mode="eval").body)
    body = ast.unparse(ast.fix_missing_locations(tree))
    free = [v for v in parsed.variables if v not in bindings]
    source = f"lambda {', '.join(free)}: {body}" if free else body
    return ExpressionSource(source=source, free=free, uses_numpy=rewrite.uses_numpy)


def signature(free: list[str], boolean: bool = False) -> str:
    result = "bool" if boolean else "float"
    return "(" + ", ".join("float" for _ in free) + f") -> {result}"
