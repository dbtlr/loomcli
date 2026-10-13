import type { Host, Log } from '@loomcli/core';

/** One file of a skill's folder. */
export interface SkillFile {
  /** The path relative to the skill's folder, such as references/commands.md. */
  readonly path: string;
  /** The file's text or bytes. */
  readonly content: string | Uint8Array;
  /** Written with mode 755 when true, else 644. */
  readonly executable?: boolean;
}

/** One skill the application installs for coding agents. */
export interface Skill {
  /** The skill's folder name, such as notes. */
  readonly name: string;
  /** Loads the skill's files, called only when a skills Command runs. */
  readonly files: () => Promise<readonly SkillFile[]> | readonly SkillFile[];
}

/** What the application tells the skills plugin. */
export interface SkillsSettings {
  /** The skills the application installs. */
  readonly skills: readonly Skill[];
}

/** What `refreshSkills` reads from a self-update's `afterReplace` context. */
export interface RefreshContext {
  /** The binary that replaced this one. */
  readonly path: string;
  /** The run's host. */
  readonly host: Host;
  /** The run signal. */
  readonly signal: AbortSignal;
  /** The run's log. */
  readonly log: Log;
}
