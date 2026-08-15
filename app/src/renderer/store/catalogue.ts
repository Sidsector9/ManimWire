import { create } from 'zustand'
import type { Catalogue, Descriptor, PortType } from '../../shared/engine'

interface CatalogueStore {
  catalogue: Catalogue | null
  error: string | null
  load(): Promise<void>
}

export const useCatalogueStore = create<CatalogueStore>((set) => ({
  catalogue: null,
  error: null,
  load: async () => {
    try {
      const catalogue = (await window.engine.call('catalogue.list')) as Catalogue
      set({ catalogue, error: null })
    } catch (error) {
      set({ error: String(error) })
    }
  }
}))

/** Library group names in the order the panel shows them. */
const GROUP_LABELS: Array<[prefix: string, label: string]> = [
  ['geometry', 'Shapes'],
  ['text', 'Text'],
  ['graphing', 'Coordinate systems and plots'],
  ['types', 'Groups'],
  ['three_d', '3D'],
  ['value', 'Values'],
  ['svg', 'SVG and braces'],
  ['mobject', 'Other objects'],
  ['animation.', 'Animations'],
  ['scene', 'Scenes'],
  ['camera', 'Cameras'],
  ['rate_functions', 'Rate functions'],
  ['utils.', 'Utilities']
]

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

/** Classes and functions a user can add, grouped for the Library panel. Methods come through quick add. */
export function groupLibrary(entries: Descriptor[], query = ''): LibraryGroup[] {
  const needle = query.trim().toLowerCase()
  const groups = new Map<string, Descriptor[]>()
  for (const entry of entries) {
    if (entry.kind === 'method' || entry.hidden) continue
    if (needle && !entry.name.toLowerCase().includes(needle)) continue
    const label = groupLabel(entry.category)
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
