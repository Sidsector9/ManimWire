/* Generated from ../schema by pnpm generate. Do not edit. */

export type Code = string;
export type Code1 = string;
export type Message = string;
export type Node = string | null;
export type Port = string | null;
export type Step = number | null;
export type Issues = Issue[];

/**
 * Code is empty when the scene has issues; the UI shows the issues instead.
 */
export interface GeneratedCode {
  code: Code;
  source_map: SourceMap;
  issues?: Issues;
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
export interface Issue {
  code: Code1;
  message: Message;
  node?: Node;
  port?: Port;
  step?: Step;
  [k: string]: unknown;
}
