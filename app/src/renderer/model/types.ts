// Connection rules, mirrored from engine/src/engine/document/validate.py so the
// graph can accept or refuse a drag instantly. The engine stays the authority:
// its validation issues are shown after every change.

import type { Descriptor, PortType, TypeRef } from '../../shared/engine'
import { SELF_PORT } from './document'

const SUBTYPES: Partial<Record<PortType, PortType[]>> = {
  coordinate_system: ['mobject'],
  live_number: ['mobject']
}

export function compatible(source: TypeRef, target: TypeRef): boolean {
  if (source.type === 'any' || target.type === 'any') return true
  const targets = new Set<PortType>([target.type, ...(target.accepts ?? [])])
  const sources = [source.type, ...(SUBTYPES[source.type] ?? [])]
  return sources.some((t) => targets.has(t))
}

export type DescriptorIndex = Map<string, Descriptor>

export function indexDescriptors(entries: Descriptor[]): DescriptorIndex {
  return new Map(entries.map((e) => [e.qualname, e]))
}

/** The type a target port accepts, or null when the port does not exist. */
export function portType(descriptor: Descriptor, port: string, index: DescriptorIndex): TypeRef | null {
  if (port === SELF_PORT) {
    if (descriptor.kind !== 'method') return null
    const owner = descriptor.owner ? index.get(descriptor.owner) : undefined
    return owner ? owner.returns : { type: 'any', annotation: '' }
  }
  const param = descriptor.parameters.find((p) => p.name === port)
  return param ? param.type : null
}

export function acceptsManyConnections(descriptor: Descriptor, port: string): boolean {
  return descriptor.parameters.some((p) => p.name === port && p.kind === 'var_positional')
}

/** Ports of `target` that a value of `source` type may be connected to, in parameter order. */
export function acceptingPorts(source: TypeRef, target: Descriptor, index: DescriptorIndex): string[] {
  const ports = target.parameters.map((p) => p.name)
  if (target.kind === 'method') ports.unshift(SELF_PORT)
  return ports.filter((port) => {
    const type = portType(target, port, index)
    return type !== null && compatible(source, type)
  })
}
