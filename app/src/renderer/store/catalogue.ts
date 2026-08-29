import { create } from 'zustand'
import type { Catalogue, CoverageReport, Descriptor, PortType } from '../../shared/engine'
import { call } from '../engine/client'
import { indexDescriptors, type DescriptorIndex } from '../model/types'

interface CatalogueStore {
  catalogue: Catalogue | null
  /** The parity metric: parameters the UI cannot present yet. */
  coverage: CoverageReport | null
  /** Descriptors by qualname, built once per catalogue load. */
  index: DescriptorIndex
  error: string | null
  load(): Promise<void>
}

const NO_ENTRIES: Descriptor[] = []
const NO_COLORS: Catalogue['colors'] = []
const NO_DIRECTIONS: string[] = []
const NO_NAMES: string[] = []
const NO_FONTS: string[] = []

/** Selectors must return stable references; these avoid a fresh [] per render. */
export const selectEntries = (s: CatalogueStore): Descriptor[] => s.catalogue?.entries ?? NO_ENTRIES
export const selectColors = (s: CatalogueStore): Catalogue['colors'] => s.catalogue?.colors ?? NO_COLORS
export const selectIndex = (s: CatalogueStore): DescriptorIndex => s.index
export const selectDirections = (s: CatalogueStore): string[] => s.catalogue?.directions ?? NO_DIRECTIONS
/** Names an Expression may use without declaring a variable: functions and constants. */
export const selectExpressionNames = (s: CatalogueStore): string[] => s.catalogue?.expression_names ?? NO_NAMES
export const selectFonts = (s: CatalogueStore): string[] => s.catalogue?.fonts ?? NO_FONTS
const NO_CURVES: Record<string, number[]> = {}
/** Each rate function sampled on [0, 1], for curve previews. */
export const selectRateCurves = (s: CatalogueStore): Record<string, number[]> => (s.catalogue?.rate_curves as Record<string, number[]> | undefined) ?? NO_CURVES

export const useCatalogueStore = create<CatalogueStore>((set) => ({
  catalogue: null,
  coverage: null,
  index: new Map(),
  error: null,
  load: async () => {
    try {
      const catalogue = await call<Catalogue>('catalogue.list')
      set({ catalogue, index: indexDescriptors(catalogue.entries), error: null })
      set({ coverage: await call<CoverageReport>('catalogue.coverage') })
    } catch (error) {
      set({ error: String(error) })
    }
  }
}))

/** Library group names in the order the panel shows them (handoff section 1). */
const GROUP_LABELS: Array<[prefix: string, label: string]> = [
  ['geometry', 'Shapes'],
  ['text', 'Text'],
  ['graphing', 'Coordinate systems'],
  ['plots', 'Plots'],
  ['value', 'Values'],
  ['types', 'Groups'],
  ['three_d', '3D'],
  ['style', 'Style'],
  ['position', 'Position'],
  ['transform', 'Transform'],
  ['animation.', 'Animations'],
  ['timing', 'Timing'],
  ['logic', 'Logic'],
  ['group', 'Reusable groups'],
  ['query', 'Object queries'],
  ['svg', 'SVG and braces'],
  ['mobject', 'Other objects'],
  ['scene', 'Scenes'],
  ['camera', 'Cameras'],
  ['rate_functions', 'Rate functions'],
  ['utils.', 'Utilities']
]

// Methods of Mobject and VMobject that the Library lists under a concept, so the most
// used operations are browsable without knowing their class (handoff Library categories).
const METHOD_GROUPS: Record<string, string[]> = {
  style: ['set_fill', 'set_stroke', 'set_color', 'set_opacity', 'set_style', 'set_background_stroke', 'set_sheen', 'set_z_index', 'fade', 'set_color_by_gradient', 'set_fill_color', 'set_stroke_color'],
  position: ['shift', 'move_to', 'next_to', 'to_edge', 'to_corner', 'align_to', 'center', 'arrange', 'arrange_in_grid', 'set_x', 'set_y', 'set_z', 'align_on_border', 'move_to_center'],
  transform: ['rotate', 'scale', 'stretch', 'flip', 'apply_matrix', 'apply_function', 'scale_to_fit_width', 'scale_to_fit_height', 'stretch_to_fit_width', 'stretch_to_fit_height', 'match_width', 'match_height', 'rotate_about_origin', 'become', 'copy', 'set_width', 'set_height']
}
const METHOD_OWNERS = new Set(['Mobject', 'VMobject'])
const PLOT_OWNERS = new Set(['CoordinateSystem', 'Axes', 'NumberPlane'])
const TIMING = new Set(['AnimationGroup', 'Succession', 'LaggedStart', 'LaggedStartMap', 'Wait'])

/** The library category of an entry, or null when it is not listed (most methods). */
export function libraryCategory(entry: Descriptor): string | null {
  if (entry.hidden) return null
  if (entry.kind === 'method') {
    if (entry.owner && METHOD_OWNERS.has(entry.owner)) {
      for (const [category, names] of Object.entries(METHOD_GROUPS)) if (names.includes(entry.name)) return category
      return null
    }
    if (entry.owner && PLOT_OWNERS.has(entry.owner) && /^(plot|get_graph|get_area|get_riemann|get_vertical_line|get_horizontal_line|input_to_graph|i2gp|coords_to_point|c2p)/.test(entry.name)) return 'plots'
    return null
  }
  if (TIMING.has(entry.name)) return 'timing'
  return entry.category
}

export interface LibraryGroup {
  label: string
  entries: Descriptor[]
}

export function groupLabel(category: string): string {
  for (const [prefix, label] of GROUP_LABELS) {
    if (prefix.endsWith('.') ? category.startsWith(prefix) : category === prefix) return label
  }
  return category
}

/** What a user can add, grouped for the Library panel. Common methods are listed by concept; the rest come through quick add. */
export function groupLibrary(entries: Descriptor[], query = ''): LibraryGroup[] {
  const needle = query.trim().toLowerCase()
  const groups = new Map<string, Descriptor[]>()
  for (const entry of entries) {
    const category = libraryCategory(entry)
    if (category === null) continue
    if (needle && !entry.name.toLowerCase().includes(needle)) continue
    const label = groupLabel(category)
    const list = groups.get(label) ?? []
    list.push(entry)
    groups.set(label, list)
  }
  const order = GROUP_LABELS.map(([, label]) => label)
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib) || a.localeCompare(b)
    })
    .map(([label, list]) => ({
      label,
      entries: [...list].sort((a, b) => a.name.localeCompare(b.name))
    }))
}

export const TYPE_COLOR: Record<PortType, string> = {
  mobject: 'var(--type-mobject)',
  coordinate_system: 'var(--type-coordinate-system)',
  number: 'var(--type-number)',
  live_number: 'var(--type-live-number)',
  vector: 'var(--type-vector)',
  color: 'var(--type-color)',
  function: 'var(--type-function)',
  animation: 'var(--type-animation)',
  text: 'var(--type-text)',
  boolean: 'var(--type-boolean)',
  config: 'var(--type-config)',
  scene: 'var(--text-secondary)',
  none: 'var(--text-muted)',
  any: 'var(--text-muted)'
}
