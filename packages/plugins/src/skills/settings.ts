import { DeclarationError, escapeControlCharacters } from '@loomcli/core';

import { packageName } from '../constants.js';
import { skillsSettings } from '../rules.js';
import type { Skill, SkillsSettings } from './types.js';

const identity = `${packageName}/skills`;

/** The longest skill name, the Agent Skills grammar's limit. */
const longestName = 64;

/** Runs of lowercase ASCII letters and digits joined by single hyphens. */
const nameGrammar = /^[\da-z]+(?:-[\da-z]+)*$/u;

/** Whether a value is a skill name: the Agent Skills grammar, safe as one path segment. */
function isSkillName(name: string): boolean {
  return name.length <= longestName && nameGrammar.test(name);
}

/** What the settings declare once judged: the folder as given, and the listed skills. */
interface Declared {
  readonly folder: URL | string | undefined;
  readonly skills: readonly Skill[];
}

/** What a setting's fault says: the sentence after the plugin's name, its correction, and its mark. */
interface FaultText {
  readonly sentence: string;
  readonly correction: string;
  /** The key the finding marks, or the settings whole when left out. */
  readonly key?: 'folder' | 'skills';
}

/** A fault of the settings, marked on the key at fault. */
function settingFault(settings: SkillsSettings, text: FaultText): DeclarationError {
  return new DeclarationError(skillsSettings, {
    correction: text.correction,
    findings: [
      {
        arguments: [settings],
        call: 'skills',
        mark: text.key === undefined ? '0' : `0.${text.key}`,
      },
    ],
    sentence: `Plugin "${identity}" ${text.sentence}`,
  });
}

/** The correction of a folder setting that names no folder. */
const folderCorrection =
  "Name the folder with a file: URL, such as new URL('../skills/', import.meta.url), or a path.";

/** Judges the `folder` setting: a `file:` URL, or a string that is not empty. */
function judgeFolder(settings: SkillsSettings): void {
  const { folder } = settings;
  if (folder instanceof URL && folder.protocol !== 'file:') {
    throw settingFault(settings, {
      correction: folderCorrection,
      key: 'folder',
      sentence: `setting "folder" is the URL ${escapeControlCharacters(folder.href)}, which is not a file URL.`,
    });
  }
  if (folder === '') {
    throw settingFault(settings, {
      correction: folderCorrection,
      key: 'folder',
      sentence: 'setting "folder" is an empty string.',
    });
  }
}

/** Judges the listed skills' names, in order: each a skill name, and none an earlier skill's. */
function judgeNames(settings: SkillsSettings, listed: readonly Skill[]): void {
  const seen = new Set<string>();
  for (const { name } of listed) {
    if (!isSkillName(name)) {
      throw settingFault(settings, {
        correction:
          'Use lowercase letters, digits, and single hyphens, 64 characters at most, such as notes.',
        key: 'skills',
        sentence: `setting "skills" holds a name that is not a skill name: ${escapeControlCharacters(name)}.`,
      });
    }
    if (seen.has(name)) {
      throw settingFault(settings, {
        correction: 'Give each skill its own name.',
        key: 'skills',
        sentence: `setting "skills" holds the skill name ${name} twice.`,
      });
    }
    seen.add(name);
  }
}

/**
 * Judges the settings at the `skills()` call, throwing the first fault: settings that hold neither
 * a folder nor a list, a folder that is not a `file:` URL or is an empty string, then each listed
 * name outside the Agent Skills grammar or held by an earlier skill. An empty list with no folder
 * declares no skill, as it did before the folder existed. A folder skill's name is judged when the
 * folder is read, because only the folder knows it. It answers what the settings declare.
 */
function judgeSettings(settings: SkillsSettings): Declared {
  if (settings.folder === undefined && settings.skills === undefined) {
    throw settingFault(settings, {
      correction:
        "Name a folder of skills, such as folder: new URL('../skills/', import.meta.url), or list a skill in skills.",
      sentence: 'settings name no skills folder and list no skill.',
    });
  }
  const listed = settings.skills ?? [];
  judgeFolder(settings);
  judgeNames(settings, listed);
  return { folder: settings.folder, skills: listed };
}

export type { Declared };
export { identity, isSkillName, judgeSettings };
