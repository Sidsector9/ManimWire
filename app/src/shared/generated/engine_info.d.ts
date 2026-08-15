/* Generated from ../schema by pnpm generate. Do not edit. */

export type Python = string;
export type Manim = string;
export type Latex = boolean;
export type Dvisvgm = boolean;

export interface EngineInfo {
  python: Python;
  manim: Manim;
  latex: Latex;
  dvisvgm: Dvisvgm;
  [k: string]: unknown;
}
