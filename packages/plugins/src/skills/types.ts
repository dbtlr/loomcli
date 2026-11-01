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

/** What the application tells the skills plugin: a skills folder, listed skills, or both. */
export interface SkillsSettings {
  /**
   * A folder whose subfolders are skills, each named for its subfolder: a `file:` URL, or a path. A
   * string that starts with `file:` reads as that URL.
   */
  readonly folder?: URL | string;
  /** Skills whose files a loader returns. */
  readonly skills?: readonly Skill[];
}

/** What `refreshSkills` reads from a self-update's `afterReplace` context, the declaration every refresh shares. */
export type { RefreshContext } from '../refresh.js';
