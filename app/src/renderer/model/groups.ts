// Inspector field groups by Manim concept (handoff section 6): Geometry, Style,
// Position, Animation timing. Membership is by parameter name, the vocabulary
// Manim shares across classes (set_fill, next_to, run_time, ...).

import type { Descriptor, Parameter } from '../../shared/engine'

const TIMING = new Set(['run_time', 'rate_func', 'lag_ratio', 'reverse_rate_function', 'introducer', 'remover', 'suspend_mobject_updating', 'name'])
const STYLE = new Set([
  'color', 'fill_color', 'fill_opacity', 'stroke_color', 'stroke_width', 'stroke_opacity', 'opacity', 'background_stroke_color',
  'background_stroke_width', 'background_stroke_opacity', 'sheen_factor', 'sheen_direction', 'z_index', 'colorscale', 'colorscale_axis',
  'shade_in_3d', 'tip_style', 'tip_length', 'tip_shape', 'tip_width', 'dash_length', 'dashed_ratio', 'stroke_opacity', 'font', 'font_size',
  'weight', 'slant', 'line_spacing', 'gradient', 'family', 'checkerboard_colors', 'stroke_ratio'
])
const POSITION = new Set([
  'point', 'arc_center', 'start', 'end', 'direction', 'buff', 'aligned_edge', 'about_point', 'about_edge', 'center', 'corner', 'shift',
  'target_position', 'position', 'coor_mask', 'edge', 'alignment', 'cell_alignment', 'row_alignments', 'col_alignments', 'vectors',
  'point_or_mobject', 'aligned_edge', 'submobject_to_align', 'index_of_submobject_to_align', 'x', 'y', 'z'
])

export type ConceptGroup = { label: string; description: string; params: Parameter[] }

const DESCRIPTIONS: Record<string, string> = {
  Geometry: 'Shape and size, in scene units.',
  Style: 'Every VMobject shares this vocabulary.',
  Position: 'Where the object sits; directions use Manim constants such as UP and RIGHT.',
  'Animation timing': 'Same contract on every animation class.',
  Expression: 'Each variable is a port; unconnected variables become the arguments of a function.',
  Keys: 'Each key is a port typed as chosen here.'
}

export function conceptGroups(descriptor: Descriptor): ConceptGroup[] {
  const groups = new Map<string, Parameter[]>()
  const put = (label: string, param: Parameter): void => {
    const list = groups.get(label) ?? []
    list.push(param)
    groups.set(label, list)
  }
  const object = descriptor.returns.type === 'mobject' || descriptor.returns.type === 'coordinate_system'
  for (const param of descriptor.parameters) {
    if (param.display === 'chain') continue // shown with its call in the chain editor
    if (param.owner === 'Expression') put('Expression', param)
    else if (param.owner === 'Config') put('Keys', param)
    else if (TIMING.has(param.name)) put('Animation timing', param)
    else if (STYLE.has(param.name)) put('Style', param)
    else if (POSITION.has(param.name)) put('Position', param)
    else put(object ? 'Geometry' : descriptor.returns.type === 'animation' ? 'Animation' : 'Parameters', param)
  }
  const order = ['Expression', 'Keys', 'Geometry', 'Parameters', 'Animation', 'Position', 'Style', 'Animation timing']
  return [...groups.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([label, params]) => ({ label, description: DESCRIPTIONS[label] ?? '', params }))
}
