/* Generated from ../schema by pnpm generate. Do not edit. */

export type Rows = string[];
export type Index = number;
export type Kind = string;
export type Start = number;
export type End = number;
export type Label = string;
export type Steps = StepSpan[];
export type Step = number;
export type Node = string;
export type Rows1 = string[];
export type Start1 = number;
export type End1 = number;
export type Label1 = string;
export type RateFunc = string | null;
export type Parent = string | null;
export type Depth = number;
export type Bars = Bar[];
export type Step1 = number;
export type Kind1 = string;
export type Time = number;
export type Label2 = string;
export type Rows2 = string[];
export type Markers = Marker[];
export type Name = string;
export type Start2 = number;
export type End2 = number;
export type SkipAnimations = boolean;
export type Sections = Section[];
export type Total = number;

export interface TimelineLayout {
  rows: Rows;
  steps: Steps;
  bars: Bars;
  markers: Markers;
  sections: Sections;
  total: Total;
  [k: string]: unknown;
}
export interface StepSpan {
  index: Index;
  kind: Kind;
  start: Start;
  end: End;
  label: Label;
  [k: string]: unknown;
}
/**
 * One animation on the timeline. Nested group children carry a parent and depth.
 */
export interface Bar {
  step: Step;
  node: Node;
  rows: Rows1;
  start: Start1;
  end: End1;
  label: Label1;
  rate_func?: RateFunc;
  parent?: Parent;
  depth?: Depth;
  [k: string]: unknown;
}
export interface Marker {
  step: Step1;
  kind: Kind1;
  time: Time;
  label: Label2;
  rows?: Rows2;
  [k: string]: unknown;
}
export interface Section {
  name: Name;
  start: Start2;
  end: End2;
  skip_animations?: SkipAnimations;
  [k: string]: unknown;
}
