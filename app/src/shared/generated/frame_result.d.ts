/* Generated from ../schema by pnpm generate. Do not edit. */

export type Path = string;
export type Time = number;
export type Node = string;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Center = [unknown, unknown];
export type Width = number;
export type Height = number;
export type OnScreen = boolean;
export type Bounds = Bounds1[];
export type RenderMs = number;

export interface FrameResult {
  path: Path;
  time: Time;
  bounds: Bounds;
  render_ms?: RenderMs;
  [k: string]: unknown;
}
export interface Bounds1 {
  node: Node;
  center: Center;
  width: Width;
  height: Height;
  on_screen: OnScreen;
  [k: string]: unknown;
}
