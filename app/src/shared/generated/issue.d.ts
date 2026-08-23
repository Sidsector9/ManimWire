/* Generated from ../schema by pnpm generate. Do not edit. */

export type Code = string;
export type Message = string;
export type Node = string | null;
export type Port = string | null;
export type Step = number | null;
export type Group = string | null;

export interface Issue {
  code: Code;
  message: Message;
  node?: Node;
  port?: Port;
  step?: Step;
  group?: Group;
  [k: string]: unknown;
}
