/* Generated from ../schema by pnpm generate. Do not edit. */

export type Version = 1;
export type PixelWidth = number;
export type PixelHeight = number;
export type FrameRate = number;
export type BackgroundColor = string;
export type Name = string;
export type Id = string;
export type Catalogue = string;
export type Label = string | null;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Position = [unknown, unknown];
export type Collapsed = boolean;
export type Nodes = Node[];
export type Source = string;
export type Target = string;
export type Port = string;
export type Live = boolean;
export type Edges = Edge[];
export type Kind = "play";
export type Animations = string[];
export type Kind1 = "wait";
export type Duration = number;
export type Kind2 = "add";
export type Mobjects = string[];
export type Kind3 = "remove";
export type Mobjects1 = string[];
export type Steps = (PlayStep | WaitStep | AddStep | RemoveStep)[];
export type Scenes = SceneDocument[];

export interface Document {
  version?: Version;
  settings?: Settings;
  scenes?: Scenes;
  [k: string]: unknown;
}
export interface Settings {
  pixel_width?: PixelWidth;
  pixel_height?: PixelHeight;
  frame_rate?: FrameRate;
  background_color?: BackgroundColor;
  [k: string]: unknown;
}
export interface SceneDocument {
  name?: Name;
  nodes?: Nodes;
  edges?: Edges;
  steps?: Steps;
  [k: string]: unknown;
}
export interface Node {
  id: Id;
  catalogue: Catalogue;
  values?: Values;
  label?: Label;
  position?: Position;
  collapsed?: Collapsed;
  [k: string]: unknown;
}
export interface Values {
  [k: string]: string | number | boolean | number[] | null;
}
export interface Edge {
  source: Source;
  target: Target;
  port: Port;
  live?: Live;
  [k: string]: unknown;
}
export interface PlayStep {
  kind?: Kind;
  animations: Animations;
  [k: string]: unknown;
}
export interface WaitStep {
  kind?: Kind1;
  duration?: Duration;
  [k: string]: unknown;
}
export interface AddStep {
  kind?: Kind2;
  mobjects: Mobjects;
  [k: string]: unknown;
}
export interface RemoveStep {
  kind?: Kind3;
  mobjects: Mobjects1;
  [k: string]: unknown;
}
