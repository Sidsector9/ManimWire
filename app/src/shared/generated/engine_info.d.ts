/* Generated from ../schema by pnpm generate. Do not edit. */

export type Python = string;
export type Manim = string;
export type Latex = boolean;
export type Dvisvgm = boolean;
export type Renderer = "opengl" | "cairo";
export type Acceleration = "hardware" | "software" | "unknown";
export type Device = string;
export type Vendor = string;
export type Version = string;
export type Backend = string | null;
export type Reason = string | null;

export interface EngineInfo {
  python: Python;
  manim: Manim;
  latex: Latex;
  dvisvgm: Dvisvgm;
  rendering?: RenderDevice | null;
  [k: string]: unknown;
}
export interface RenderDevice {
  renderer?: Renderer;
  acceleration?: Acceleration;
  device?: Device;
  vendor?: Vendor;
  version?: Version;
  backend?: Backend;
  reason?: Reason;
  [k: string]: unknown;
}
