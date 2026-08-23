"""The parity metric: catalogue parameters the UI cannot present.

A parameter is presentable when its port type has an editor or can be connected
(every type but ``any``). Untyped parameters come from annotations the mapper
does not know; the count must go down with every release.
"""

from __future__ import annotations

from pydantic import BaseModel

from engine.catalogue.model import Catalogue, PortType


class EntryCoverage(BaseModel):
    qualname: str
    kind: str
    unpresentable: list[str]


class CoverageReport(BaseModel):
    entries: int
    parameters: int
    unpresentable: int
    incomplete: list[EntryCoverage]
    unknown_annotations: list[str]


def coverage_report(catalogue: Catalogue) -> CoverageReport:
    incomplete: list[EntryCoverage] = []
    parameters = 0
    unpresentable = 0
    for entry in catalogue.entries:
        if entry.hidden:
            continue
        parameters += len(entry.parameters)
        missing = [p.name for p in entry.parameters if p.type.type is PortType.ANY]
        if missing:
            unpresentable += len(missing)
            incomplete.append(
                EntryCoverage(
                    qualname=entry.qualname, kind=entry.kind, unpresentable=missing
                )
            )
    return CoverageReport(
        entries=len([e for e in catalogue.entries if not e.hidden]),
        parameters=parameters,
        unpresentable=unpresentable,
        incomplete=incomplete,
        unknown_annotations=list(catalogue.unknown_annotations),
    )


def main() -> None:
    from engine.catalogue import get_catalogue

    report = coverage_report(get_catalogue())
    print(
        f"{report.unpresentable} of {report.parameters} parameters across "
        f"{report.entries} entries cannot be presented"
    )
    for entry in report.incomplete:
        print(f"  {entry.qualname}: {', '.join(entry.unpresentable)}")


if __name__ == "__main__":
    main()
