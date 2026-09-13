/* Generated from ../schema by pnpm generate. Do not edit. */

export type Version = 1;
export type PixelWidth = number;
export type PixelHeight = number;
export type FrameRate = number;
export type BackgroundColor = string;
export type OutputFormat = "mp4" | "mov" | "webm" | "gif" | "png";
export type Name = string;
export type SceneType = "Scene" | "MovingCameraScene" | "ThreeDScene" | "ZoomedScene";
export type Id = string;
export type Catalogue = string;
export type Label = string | null;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Position = [unknown, unknown];
export type Collapsed = boolean;
export type Method = string;
export type Chain = MethodCall[];
export type Name1 = string;
export type PortType =
  | "mobject"
  | "coordinate_system"
  | "number"
  | "live_number"
  | "vector"
  | "color"
  | "function"
  | "animation"
  | "text"
  | "boolean"
  | "config"
  | "scene"
  | "none"
  | "any";
export type Config = ConfigKey[];
export type Parent = string | null;
export type Size = [unknown, unknown] | null;
export type Pinned = string[];
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
export type Name2 = string;
export type SkipAnimations = boolean;
export type Kind7 = "sound";
export type File = string;
export type TimeOffset = number;
export type Gain = number | null;
export type Kind8 = "subcaption";
export type Content = string;
export type Duration1 = number;
export type Offset = number;
export type Kind9 = "updating";
export type Mobjects4 = string[];
export type Action = "suspend" | "resume" | "clear";
export type Kind10 = "camera";
export type Action1 = "orient" | "move";
export type Phi = number | null;
export type Theta = number | null;
export type Gamma = number | null;
export type Zoom = number | null;
export type FocalDistance = number | null;
export type RunTime1 = number | null;
export type Kind11 = "fixed_in_frame";
export type Mobjects5 = string[];
export type Action2 = "add" | "remove";
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
  | UpdatingStep
  | CameraStep
  | FixedInFrameStep
)[];
export type Scenes = SceneDocument[];
export type Name3 = string;
export type Nodes1 = Node[];
export type Edges1 = Edge[];
export type Groups = GroupDefinition[];

export interface Document {
  version?: Version;
  settings?: Settings;
  scenes?: Scenes;
  groups?: Groups;
  [k: string]: unknown;
}
export interface Settings {
  pixel_width?: PixelWidth;
  pixel_height?: PixelHeight;
  frame_rate?: FrameRate;
  background_color?: BackgroundColor;
  output_format?: OutputFormat;
  [k: string]: unknown;
}
export interface SceneDocument {
  name?: Name;
  scene_type?: SceneType;
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
  chain?: Chain;
  config?: Config;
  parent?: Parent;
  size?: Size;
  pinned?: Pinned;
  [k: string]: unknown;
}
export interface Values {
  [k: string]: string | number | boolean | number[] | string[] | number[][] | null;
}
/**
 * One step of an Animate chain: ``.method(**values)``.
 */
export interface MethodCall {
  method: Method;
  values?: Values1;
  [k: string]: unknown;
}
export interface Values1 {
  [k: string]: string | number | boolean | number[] | string[] | number[][] | null;
}
/**
 * One entry of a Config node: the key and the type its value is written as.
 */
export interface ConfigKey {
  name: Name1;
  type?: PortType;
  [k: string]: unknown;
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
  name?: Name2;
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
/**
 * suspend_updating, resume_updating, or clear_updaters on live objects.
 */
export interface UpdatingStep {
  kind?: Kind9;
  mobjects: Mobjects4;
  action?: Action;
  [k: string]: unknown;
}
/**
 * ThreeDScene camera: ``set_camera_orientation``, or ``move_camera`` over time.
 */
export interface CameraStep {
  kind?: Kind10;
  action?: Action1;
  phi?: Phi;
  theta?: Theta;
  gamma?: Gamma;
  zoom?: Zoom;
  focal_distance?: FocalDistance;
  run_time?: RunTime1;
  [k: string]: unknown;
}
/**
 * ``add_fixed_in_frame_mobjects`` or ``remove_fixed_in_frame_mobjects``.
 */
export interface FixedInFrameStep {
  kind?: Kind11;
  mobjects: Mobjects5;
  action?: Action2;
  [k: string]: unknown;
}
/**
 * A reusable subgraph. Input and Output nodes inside it are its ports.
 */
export interface GroupDefinition {
  name: Name3;
  nodes?: Nodes1;
  edges?: Edges1;
  [k: string]: unknown;
}
