"""Audit every exposed descriptor against the installed Manim signatures/source.

Run: python -m engine.catalogue.audit [output.json]
The report distinguishes named ports from dynamic keyword options. It is an
input-discovery audit, not a claim that every arbitrary Python object can be
constructed by a JSON editor or that every combination of inputs is valid.
"""

from __future__ import annotations

import importlib
import inspect
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from engine.catalogue.keywords import keyword_source
from engine.catalogue.model import Catalogue, PortType


def audit_inputs(catalogue: Catalogue) -> dict[str, Any]:
    records = []
    for entry in catalogue.entries:
        if entry.hidden:
            continue
        parameters = {p.name: p for p in entry.parameters}
        record: dict[str, Any] = {
            "node": entry.qualname,
            "kind": entry.kind,
            "named_inputs": [
                p.name for p in entry.parameters if p.kind != "var_keyword"
            ],
            "additional_options": [
                p.name for p in entry.parameters if p.kind == "var_keyword"
            ],
            "untyped_inputs": [
                p.name for p in entry.parameters if p.type.type is PortType.ANY
            ],
            "missing_signature_inputs": [],
            "missing_keyword_inputs": [],
            "keyword_inputs_via_config": [],
        }
        if entry.kind in {"class", "method", "function"}:
            module = importlib.import_module(entry.module)
            owner = getattr(module, entry.owner) if entry.owner else None
            target = getattr(owner or module, entry.name)
            if entry.kind == "class":
                declaring = next(
                    base for base in target.__mro__ if "__init__" in vars(base)
                )
                function = vars(declaring)["__init__"]
            else:
                function = target
            signature = inspect.signature(function)
            required_names = {
                p.name
                for p in signature.parameters.values()
                if p.name not in {"self", "cls"}
                and not p.name.startswith("_")
                and p.kind is not inspect.Parameter.VAR_KEYWORD
            }
            record["missing_signature_inputs"] = sorted(
                required_names - parameters.keys()
            )
            sources = (
                [
                    vars(base)["__init__"]
                    for base in target.__mro__
                    if "__init__" in vars(base)
                ]
                if entry.kind == "class"
                else [function]
            )
            reads: set[str] = set()
            for source in sources:
                info = keyword_source(source)
                if info.name is None:
                    break
                reads.update(key for key in info.reads if not key.startswith("_"))
            missing = sorted(reads - parameters.keys())
            field = (
                "keyword_inputs_via_config"
                if record["additional_options"]
                else "missing_keyword_inputs"
            )
            record[field] = missing
            kwargs_name = keyword_source(function).name
            if kwargs_name and kwargs_name not in record["additional_options"]:
                record["missing_keyword_inputs"].append("**" + kwargs_name)
        records.append(record)
    return {
        "manim_version": catalogue.manim_version,
        "entries": len(records),
        "kinds": dict(Counter(r["kind"] for r in records)),
        "missing_signature_inputs": sum(
            len(r["missing_signature_inputs"]) for r in records
        ),
        "missing_keyword_inputs": sum(
            len(r["missing_keyword_inputs"]) for r in records
        ),
        "nodes_with_additional_options": sum(
            bool(r["additional_options"]) for r in records
        ),
        "nodes": records,
    }


if __name__ == "__main__":
    from engine.catalogue.build import get_catalogue

    report = audit_inputs(get_catalogue())
    text = json.dumps(report, indent=2) + "\n"
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(text)
    else:
        print(text, end="")
    if report["missing_signature_inputs"] or report["missing_keyword_inputs"]:
        raise SystemExit(1)
