/* Generated from ../schema by pnpm generate. Do not edit. */

export type Entries = number;
export type Parameters = number;
export type Unpresentable = number;
export type Qualname = string;
export type Kind = string;
export type Unpresentable1 = string[];
export type Incomplete = EntryCoverage[];
export type UnknownAnnotations = string[];

export interface CoverageReport {
  entries: Entries;
  parameters: Parameters;
  unpresentable: Unpresentable;
  incomplete: Incomplete;
  unknown_annotations: UnknownAnnotations;
  [k: string]: unknown;
}
export interface EntryCoverage {
  qualname: Qualname;
  kind: Kind;
  unpresentable: Unpresentable1;
  [k: string]: unknown;
}
