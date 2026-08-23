// The descriptor index the graph works with: the catalogue plus one descriptor per
// reusable group in the open project. Mirrors group_descriptor in
// engine/src/engine/document/analysis.py.

import { useMemo } from 'react'
import type { Descriptor, Parameter, PortType, TypeRef } from '../../shared/engine'
import { GROUP_PREFIX, type GroupDefinition } from '../model/document'
import { effectiveDescriptor } from '../model/live'
import type { DescriptorIndex } from '../model/types'
import { selectEntries, selectExpressionNames, useCatalogueStore } from './catalogue'
import { useDocumentStore } from './document'

const NONE: TypeRef = { type: 'none', annotation: 'None', optional: false, collection: false, accepts: [], signature: null, choices: null }

export function groupDescriptor(group: GroupDefinition, index: DescriptorIndex, expressionNames: string[]): Descriptor {
  const parameters: Parameter[] = group.nodes
    .filter((n) => n.catalogue === 'Input')
    .map((n) => {
      const type = (typeof n.values['type'] === 'string' ? n.values['type'] : 'number') as PortType
      return {
        name: typeof n.values['name'] === 'string' ? n.values['name'] : 'input',
        type: { type, annotation: type, optional: true, collection: false, accepts: [], signature: null, choices: null },
        default: 'None',
        display: 'None',
        kind: 'positional',
        owner: group.name
      }
    })
  const output = group.nodes.find((n) => n.catalogue === 'Output')
  const edge = output ? group.edges.find((e) => e.target === output.id && e.port === 'value') : undefined
  const source = edge ? group.nodes.find((n) => n.id === edge.source) : undefined
  const sourceDescriptor = source ? index.get(source.catalogue) : undefined
  const scene = { name: group.name, scene_type: 'Scene' as const, nodes: group.nodes, edges: group.edges, steps: [] }
  const returns = source && sourceDescriptor ? effectiveDescriptor(source, sourceDescriptor, scene, expressionNames, index).returns : NONE
  return {
    name: group.name,
    qualname: GROUP_PREFIX + group.name,
    module: 'project',
    kind: 'group',
    category: 'group',
    parameters,
    accepts_kwargs: false,
    returns,
    doc: `Reusable group ${group.name} from this project.`,
    is_vmobject: false,
    requires_latex: false,
    hidden: false
  }
}

/** Catalogue descriptors plus the project's groups. Two passes, so groups used inside groups resolve. */
export function withGroups(index: DescriptorIndex, groups: GroupDefinition[], expressionNames: string[]): DescriptorIndex {
  if (groups.length === 0) return index
  let combined = new Map(index)
  for (let pass = 0; pass < 2; pass++) {
    const next = new Map(combined)
    for (const group of groups) next.set(GROUP_PREFIX + group.name, groupDescriptor(group, combined, expressionNames))
    combined = next
  }
  return combined
}

export function useDescriptorIndex(): DescriptorIndex {
  const index = useCatalogueStore((s) => s.index)
  const expressionNames = useCatalogueStore(selectExpressionNames)
  const groups = useDocumentStore((s) => s.doc.groups)
  return useMemo(() => withGroups(index, groups, expressionNames), [index, groups, expressionNames])
}

/** Everything a user can add: catalogue entries and group instances. */
export function useEntries(): Descriptor[] {
  const entries = useCatalogueStore(selectEntries)
  const index = useDescriptorIndex()
  return useMemo(() => [...entries, ...[...index.values()].filter((d) => d.kind === 'group')], [entries, index])
}
