/**
 * One file of a skill's folder.
 *
 * @public
 */
export interface SkillFile {
  /** The path relative to the skill's folder, such as references/workflow.md. */
  readonly path: string;
  /** The file's text or bytes. */
  readonly content: string | Uint8Array;
  /** Written with mode 755 when true, else 644. */
  readonly executable?: boolean;
}

/**
 * One skill the application installs for coding agents, whose files a loader returns.
 *
 * @public
 */
export interface Skill {
  /** The skill's folder name, such as notes. */
  readonly name: string;
  /** Loads the skill's files, called when a skills Command installs or reports on the skill, or skillFolders reads it. */
  readonly files: () => Promise<readonly SkillFile[]> | readonly SkillFile[];
  /**
   * The Commands whose command references the plugin generates, each by its path from the root;
   * the path [] selects the whole application.
   */
  readonly commands?: readonly (readonly string[])[];
}

/**
 * An entry that names a skill the skills folder holds, which supplies its files, and adds the
 * Commands whose command references the plugin generates for it.
 *
 * @public
 */
export interface FolderSkillCommands {
  /** The name of a skill the skills folder holds, which supplies its files. */
  readonly name: string;
  /** Never given: the skills folder supplies the files. */
  readonly files?: never;
  /** The Commands whose command references the plugin generates for that skill. */
  readonly commands: readonly (readonly string[])[];
}

/**
 * What the application tells the skills plugin: a skills folder, listed skills, or both.
 *
 * @public
 */
export interface SkillsSettings {
  /**
   * A folder whose subfolders are skills, each named for its subfolder: a `file:` URL, or a path. A
   * string that starts with `file:` reads as that URL.
   */
  readonly folder?: URL | string;
  /** Skills whose files a loader returns. */
  readonly skills?: readonly Skill[];
}

/**
 * Settings that name a skills folder and may list an entry without files, which selects Commands
 * for the folder's skill of its name.
 *
 * @public
 */
export interface FolderSkillsSettings {
  /**
   * A folder whose subfolders are skills, each named for its subfolder: a `file:` URL, or a path. A
   * string that starts with `file:` reads as that URL.
   */
  readonly folder: URL | string;
  /** Listed skills, and the Commands folder skills select. */
  readonly skills?: readonly (Skill | FolderSkillCommands)[];
}

/**
 * What `commandReferences` renders: the Commands it selects, and whether each file carries its
 * Command's skill guidance.
 *
 * @public
 */
export interface CommandReferenceSettings {
  /** The paths of the Commands to render, as a skill's `commands` selects them. */
  readonly commands: readonly (readonly string[])[];
  /** Whether each file carries its Command's `skillCommand` guidance. */
  readonly guidance: boolean;
}

/**
 * One generated file: `index.md`, or one Command's command reference.
 *
 * @public
 * @sealed
 */
export interface CommandReferenceFile {
  /** The file's name, such as index.md or notes-note-list.md. */
  readonly name: string;
  /** The file's text. */
  readonly content: string;
}

/**
 * One declared skill with every file an install writes in its folder.
 *
 * @public
 * @sealed
 */
export interface SkillFolder {
  /** The skill's name. */
  readonly name: string;
  /** Every file an install writes in the skill's folder, the generated files included. */
  readonly files: readonly SkillFile[];
}

/**
 * How `skillFolders` reads the skills folder.
 *
 * @public
 */
export interface SkillFoldersOptions {
  /** The application module's directory, which a relative folder setting resolves against. */
  readonly moduleDirectory?: string;
}

/** What `refreshSkills` reads from a self-update's `afterReplace` context, the declaration every refresh shares. */
export type { RefreshContext } from '../refresh.js';

/**
 * What status found for a skill at one target, in precedence order.
 *
 * @example
 * ```ts
 * import type { SkillState } from '@loomcli/plugins/skills';
 * export const current: SkillState = 'current';
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/skills.md#status
 * @public
 * @sealed
 */
export type SkillState = 'missing' | 'unmanaged' | 'modified' | 'stale' | 'current';
/**
 * One declared skill's installation state at one agent target.
 *
 * @example
 * ```ts
 * import type { SkillStatus } from '@loomcli/plugins/skills';
 * export function isCurrent(row: SkillStatus): boolean { return row.state === 'current'; }
 * ```
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/skills.md#status
 * @public
 * @sealed
 */
export interface SkillStatus {
  /** The declared skill's name. */
  readonly skill: string;
  /** The agent target. */
  readonly target: 'claude' | 'agents';
  /** The installation scope. */
  readonly scope: 'global' | 'project';
  /** What status found. */
  readonly state: SkillState;
  /** The absolute folder path as configured. */
  readonly folder: string;
  /** Relative paths that differ, sorted in code-point order. */
  readonly files: readonly string[];
  /** Steps for this state, empty when current. */
  readonly notes: readonly string[];
}
