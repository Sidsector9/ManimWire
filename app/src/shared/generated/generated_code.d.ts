/* Generated from ../schema by pnpm generate. Do not edit. */

export type Code = string;

export interface GeneratedCode {
  code: Code;
  source_map: SourceMap;
  [k: string]: unknown;
}
/**
 * 1-based line numbers of the generated code, by node id and by step index.
 */
export interface SourceMap {
  nodes?: Nodes;
  steps?: Steps;
  [k: string]: unknown;
}
export interface Nodes {
  [k: string]: number[];
}
export interface Steps {
  [k: string]: number[];
}
