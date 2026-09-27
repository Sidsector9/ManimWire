/* Generated from ../schema by pnpm generate. Do not edit. */

export type Path = string;
export type Format = "png" | "rgba";
export type Width = number;
export type Height = number;
export type Stream = string;
export type Time = number;
export type Node = string;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Center = [unknown, unknown];
export type Width1 = number;
export type Height1 = number;
export type OnScreen = boolean;
export type Bounds = Bounds1[];
export type RenderMs = number;

export interface FrameResult {
  path: Path;
  format?: Format;
  width?: Width;
  height?: Height;
  stream?: Stream;
  time: Time;
  bounds: Bounds;
  render_ms?: RenderMs;
  [k: string]: unknown;
}
export interface Bounds1 {
  node: Node;
  center: Center;
  width: Width1;
  height: Height1;
  on_screen: OnScreen;
  [k: string]: unknown;
}
