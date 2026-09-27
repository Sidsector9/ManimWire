# Manim input parity audit

Audited against the bundled Manim Community Edition 0.21.0. The machine-readable
[per-node report](manim-input-audit.json) covers every exposed catalogue entry:
216 classes, 963 methods, 122 functions, and 22 ManimWire built-ins. Built-ins have
no direct Manim signature to compare; they are inventoried separately.

## Findings and changes

The regression introduced by `f8e0a96` treated every argument explicitly passed to
a parent constructor as fixed. This incorrectly removed user options consumed
through `kwargs.pop`, notably `Write.run_time` and `Write.lag_ratio`.

The audit also identified missing options not caused by that commit:

- Literal keyword reads, conditional defaults, and aliases outside signatures:
  arrow tip classes, text style aliases, template settings, and chart options.
- Keyword options forwarded through methods or constructors, including curve
  styling in `CoordinateSystem.plot`, label styling in `add_coordinates`,
  alignment in `Mobject.arrange`, and positioning in scaling helpers.
- Incorrect positional binding through `*args`. Positional arguments supplied by
  wrappers must not consume a parent's keyword-only inputs.
- Multiple inheritance: the next constructor in `super()` is determined by the
  concrete class's method resolution order, not just the declaring base class.
- Untyped inputs with useful defaults, such as booleans, numbers, dictionaries,
  class references, and rate functions, that can receive a specific editor.

Discovery now follows actual keyword forwarding. It preserves conditional defaults
without emitting them into generated code, and hides internally supplied arguments
such as `Circle.angle`, `Square.width`, and `Vector.start`. It does not add
OpenGL-only constructor inputs to Cairo plotting nodes.

## Dynamic and untyped inputs

336 entries accept extra keyword arguments. Their Inspector now has an
**Additional options** section. Connect a Config node to this input to generate
`**config`. This covers APIs whose available options depend on an input-selected
callable, including `LaggedStartMap.animation_class` and `Table.create`'s animation
classes. These APIs cannot have one exhaustive, static list of valid option names.

Known inputs retain typed controls. Untyped inputs now accept JSON values or a
connection. This does not make arbitrary Python objects representable as JSON:
for example, a custom template or native rendering context still needs an object
source. The report lists untyped inputs rather than claiming universal type or
rendering support. Manim remains responsible for value-dependent constraints.

Do not repeat a named input in Additional options; literal and Config-node
conflicts are reported before code generation. Unknown keywords can still be
rejected by Manim, just as they are when calling its Python API directly.

Some previously exposed inherited inputs were never forwarded to the parent, or
were supplied internally. They no longer appear as independent named controls.
If an older document has one of those values, validation identifies the obsolete
port; values are not silently deleted. Where the option is forwarded to a dynamic
callee, use Additional options instead.

## Verification and reproduction

Run the audit with:

```sh
PYTHONPATH=engine/src .venv/bin/python -m engine.catalogue.audit engine/audits/manim-input-audit.json
```

The audit checks every exposed Manim entry for omitted public signature arguments,
source-level keyword reads, and an input for dynamic keyword arguments. Zero
missing inputs here means these discovery checks pass; it is not a claim that
every possible combination of Manim inputs has been rendered.

Regression tests cover the recovered options, default preservation, fixed inputs,
multiple inheritance, dictionary expansion, and duplicate option validation. A
render test recreates axes with coordinate labels and
`Write(axes, lag_ratio=0.01, run_time=1)`. An Electron test edits both timing fields
in the Inspector and connects an Additional options Config node.

## Future work: full Manim CE feature parity

Recorded September 27, 2026 for a future revisit. These are planning notes, not
implemented features or a commitment to a particular approach.

The current audit establishes input exposure, not 1:1 feature parity. A named port
or an Additional options Config input does not prove that ManimWire can construct
every accepted value or reproduce every behavior. The report also inventories the
app's exposed entries; it does not establish that every Manim CE API is exposed.

Areas to investigate and close:

- **API coverage:** compare the exposed catalogue with the full scene-authoring
  API, documenting omissions and intentional exclusions, including renderer-specific
  capabilities.
- **Python objects:** provide ways to construct and pass templates, custom classes,
  and other non-JSON objects. A generic JSON editor alone cannot solve this.
- **Custom behavior:** support arbitrary functions, updaters, and scene logic,
  including behavior beyond the current expression language and graph constructs.
- **Execution semantics:** verify ordering, object identity and shared references,
  mutations, and updater lifecycle against equivalent Python scenes.
- **Behavioral verification:** build a suite of paired Manim Python and ManimWire
  examples. Compare generated behavior, timing, and rendered output, and keep
  explicit records of unsupported cases.

Two possible targets need to be distinguished before choosing the next phase:

| Target | Required approach |
| --- | --- |
| Every Manim feature through built-in nodes | Extend the visual programming system to represent custom types, behavior, and Python semantics. |
| Every Manim feature accessible within ManimWire | Combine nodes with an integrated custom Python option for behavior the graph cannot yet express. |

An integrated Python option is a candidate for broader coverage, not an agreed
implementation. Its design must address inputs and outputs, object references,
preview and export consistency, errors, and project persistence. It does not by
itself establish complete parity.

When revisiting, choose the target, prioritize concrete unsupported examples,
define acceptance tests, and track API coverage, value support, and behavioral
parity separately. Do not present a successful input audit as full feature parity.
