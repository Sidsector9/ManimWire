/* Generated from ../schema by pnpm generate. Do not edit. */

export type ManimVersion = string;
export type Name = string;
export type Qualname = string;
export type Module = string;
export type Kind = "class" | "method" | "function";
export type Category = string;
export type Owner = string | null;
export type Bases = string[];
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
export type Annotation = string;
export type Optional = boolean;
export type Collection = boolean;
export type Accepts = PortType[];
export type Signature = string | null;
export type Choices = string[] | null;
export type Kind1 = "positional" | "keyword_only" | "var_positional";
export type Default = string | null;
export type Display = string | null;
export type Owner1 = string;
export type Parameters = Parameter[];
export type AcceptsKwargs = boolean;
export type Doc = string;
export type IsVmobject = boolean;
export type Hidden = boolean;
export type Entries = Descriptor[];
export type Name2 = string;
export type Hex = string;
export type Colors = ColorEntry[];
export type UnknownAnnotations = string[];

export interface Catalogue {
  manim_version: ManimVersion;
  entries: Entries;
  colors: Colors;
  unknown_annotations: UnknownAnnotations;
  [k: string]: unknown;
}
export interface Descriptor {
  name: Name;
  qualname: Qualname;
  module: Module;
  kind: Kind;
  category: Category;
  owner?: Owner;
  bases?: Bases;
  parameters: Parameters;
  accepts_kwargs?: AcceptsKwargs;
  returns: TypeRef;
  doc?: Doc;
  is_vmobject?: IsVmobject;
  hidden?: Hidden;
  [k: string]: unknown;
}
export interface Parameter {
  name: Name1;
  type: TypeRef;
  kind?: Kind1;
  default?: Default;
  display?: Display;
  owner: Owner1;
  [k: string]: unknown;
}
/**
 * A port type derived from an annotation.
 */
export interface TypeRef {
  type: PortType;
  annotation: Annotation;
  optional?: Optional;
  collection?: Collection;
  accepts?: Accepts;
  signature?: Signature;
  choices?: Choices;
  [k: string]: unknown;
}
export interface ColorEntry {
  name: Name2;
  hex: Hex;
  [k: string]: unknown;
}
