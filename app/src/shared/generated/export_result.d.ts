/* Generated from ../schema by pnpm generate. Do not edit. */

export type Path = string;
export type Duration = number;
export type Subtitles = string | null;

export interface ExportResult {
  path: Path;
  duration: Duration;
  subtitles?: Subtitles;
  [k: string]: unknown;
}
