import type { skills } from '@loomcli/plugins/skills';

export interface SkillEntry {
  readonly name: string;
  readonly files?: readonly {
    readonly path: string;
    readonly bytes?: readonly number[];
    readonly content?: string;
    readonly executable?: boolean;
  }[];
  readonly throws?: boolean;
  readonly result?: unknown;
}

// The export returns the actual plugin; no claim is made about the loader's unknown result.
export declare function skillsDeclaration(
  entries: readonly SkillEntry[],
  loaded: string,
): ReturnType<typeof skills>;
