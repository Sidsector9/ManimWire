import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { PortType } from '../../shared/engine'
import { TYPE_COLOR } from '../store/catalogue'
import { Icon } from './Icon'

const TYPES: Array<[PortType, string, string]> = [
  ['mobject', 'Object', 'Shapes, text, images, and other drawable objects.'],
  ['coordinate_system', 'Coordinate system', 'Axes and planes; also accepted by object inputs.'],
  ['number', 'Number', 'Numeric values, such as radius, opacity, or duration.'],
  ['live_number', 'Live number', 'Trackers and changing numeric values. Accepted by numeric inputs.'],
  ['vector', 'Point or direction', 'Coordinates, movement vectors, and some numeric arrays.'],
  ['color', 'Colour', 'Named colours or colour values.'],
  ['function', 'Function', 'Calculations or rules, such as plot functions and easing.'],
  ['animation', 'Animation', 'Actions that can be played or combined with other animations.'],
  ['text', 'Text', 'Strings, such as labels, formulas, or file paths.'],
  ['boolean', 'Boolean', 'True or false.'],
  ['config', 'Configuration', 'A dictionary of named settings.'],
  ['scene', 'Scene', 'A Manim scene.'],
  ['any', 'Any type', 'A flexible input or output whose type depends on its use.'],
  ['none', 'No output', 'An operation with no returned value; no output port is shown.']
]

export function PortHelp() {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  return <>
    <button ref={trigger} className="icon" title="Port colours and types" aria-label="Port colours and types"
      aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <Icon name="info" />
    </button>
    {createPortal(<dialog ref={dialog} className="port-help" aria-labelledby={titleId}
      onClose={() => trigger.current?.focus()}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close() }}
      onKeyDown={(event) => event.stopPropagation()}>
      <div className="port-help-body">
        <div className="port-help-heading">
          <h2 id={titleId}>Port colours and types</h2>
          <button className="button small" autoFocus onClick={() => dialog.current?.close()}>Close</button>
        </div>
        <p>Inputs on the left show the type of value they accept. Outputs on the right show the type they provide.</p>
        <dl className="port-help-types">
          {TYPES.map(([type, label, description]) => <div key={type}>
            <dt><span className="port-help-dot" style={{ background: TYPE_COLOR[type] }} aria-hidden="true" />{label}</dt>
            <dd>{description}</dd>
          </div>)}
        </dl>
        <p className="muted">Colours are a guide: some inputs accept more than one type. ManimWire checks compatibility when you connect ports. An accepted connection still needs values suitable for the operation.</p>
      </div>
    </dialog>, document.body)}
  </>
}
