import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PortType, TypeRef } from '../../shared/engine'
import { compatible } from './types'

// The engine writes every port type pair with its verdict (python -m engine.schema).
// This mirror must agree with it, or drag feedback and validation would disagree.
interface Row {
  source: PortType
  target: PortType
  accepts?: PortType[]
  ok: boolean
}
const table = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../schema/compatibility.json'), 'utf8')) as Row[]
const ref = (type: PortType, accepts: PortType[] = []): TypeRef => ({ type, annotation: '', optional: false, collection: false, accepts, signature: null, choices: null })

describe('compatible mirrors the engine', () => {
  it('agrees with every pair in schema/compatibility.json', () => {
    expect(table.length).toBeGreaterThan(100)
    for (const row of table) {
      expect(compatible(ref(row.source), ref(row.target, row.accepts ?? [])), `${row.source} -> ${row.target}`).toBe(row.ok)
    }
  })
})
