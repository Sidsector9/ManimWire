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
export type RunTime = number | null;
export type RateFunc = string | null;
export type LagRatio = number | null;
export type Subcaption = string | null;
export type SubcaptionDuration = number | null;
export type SubcaptionOffset = number;
export type Kind1 = "wait";
export type Duration = number;
export type Kind2 = "add";
export type Mobjects = string[];
export type Kind3 = "remove";
export type Mobjects1 = string[];
export type Kind4 = "bring_to_front";
export type Mobjects2 = string[];
export type Kind5 = "bring_to_back";
export type Mobjects3 = string[];
export type Kind6 = "section";
export type Name1 = string;
export type SkipAnimations = boolean;
export type Kind7 = "sound";
export type File = string;
export type TimeOffset = number;
export type Gain = number | null;
export type Kind8 = "subcaption";
export type Content = string;
export type Duration1 = number;
export type Offset = number;
export type Steps = (
  | PlayStep
  | WaitStep
  | AddStep
  | RemoveStep
  | BringToFrontStep
  | BringToBackStep
  | SectionStep
  | SoundStep
  | SubcaptionStep
)[];
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
/**
 * ``self.play(...)``. Keyword values apply to every animation, as in Manim.
 */
export interface PlayStep {
  kind?: Kind;
  animations: Animations;
  run_time?: RunTime;
  rate_func?: RateFunc;
  lag_ratio?: LagRatio;
  subcaption?: Subcaption;
  subcaption_duration?: SubcaptionDuration;
  subcaption_offset?: SubcaptionOffset;
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
export interface BringToFrontStep {
  kind?: Kind4;
  mobjects: Mobjects2;
  [k: string]: unknown;
}
export interface BringToBackStep {
  kind?: Kind5;
  mobjects: Mobjects3;
  [k: string]: unknown;
}
export interface SectionStep {
  kind?: Kind6;
  name?: Name1;
  skip_animations?: SkipAnimations;
  [k: string]: unknown;
}
export interface SoundStep {
  kind?: Kind7;
  file: File;
  time_offset?: TimeOffset;
  gain?: Gain;
  [k: string]: unknown;
}
export interface SubcaptionStep {
  kind?: Kind8;
  content: Content;
  duration?: Duration1;
  offset?: Offset;
  [k: string]: unknown;
}
