"""Checked scalar arithmetic for camera angles, without executing user code."""

import ast
import math
import operator
from collections.abc import Callable

CONSTANTS = {"PI": math.pi, "TAU": math.tau, "DEGREES": math.pi / 180}
OPERATORS: dict[type[ast.operator], Callable[[float, float], float]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}


def angle_source(value: float | str) -> str:
    """Validate a finite angle and preserve its expression in generated Python."""
    if not isinstance(value, str):
        if not math.isfinite(value):
            raise ValueError("angle must be finite")
        return repr(value)
    if len(value) > 512:
        raise ValueError("angle expression is too long")
    try:
        tree = ast.parse(value.strip(), mode="eval").body
        _evaluate(tree)
    except (SyntaxError, ArithmeticError, RecursionError) as exc:
        raise ValueError("enter an angle such as 75 * DEGREES or PI / 2") from exc
    return ast.unparse(tree)


def _evaluate(node: ast.expr) -> float:
    if (
        isinstance(node, ast.Constant)
        and isinstance(node.value, int | float)
        and not isinstance(node.value, bool)
    ):
        result = float(node.value)
    elif isinstance(node, ast.Name) and node.id in CONSTANTS:
        result = CONSTANTS[node.id]
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.UAdd | ast.USub):
        result = _evaluate(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
    elif isinstance(node, ast.BinOp) and type(node.op) in OPERATORS:
        result = OPERATORS[type(node.op)](_evaluate(node.left), _evaluate(node.right))
    else:
        raise ValueError("use numbers, PI, TAU, DEGREES, parentheses, and + - * /")
    if not math.isfinite(result):
        raise ValueError("angle must be finite")
    return result
