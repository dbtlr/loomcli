import { DeclarationError, escapeControlCharacters } from '@loomcli/core';

import { packageName } from '../constants.js';
import { skillsSettings } from '../rules.js';
import type { Skill, SkillsSettings } from './types.js';

const identity = `${packageName}/skills`;

/** The longest skill name, the Agent Skills grammar's limit. */
const longestName = 64;

/** Runs of lowercase ASCII letters and digits joined by single hyphens. */
const nameGrammar = /^[\da-z]+(?:-[\da-z]+)*$/u;

/** The length of an empty list. */
const empty = 0;

/** Whether a value is a skill name: the Agent Skills grammar, safe as one path segment. */
function isSkillName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= longestName && nameGrammar.test(value);
}

/** What a setting's fault says: the rest of its sentence after the plugin's setting, and its correction. */
interface FaultText {
  readonly sentence: string;
  readonly correction: string;
}

/** The fault of the `skills` setting, marked on its key. */
function settingFault(settings: unknown, text: FaultText): DeclarationError {
  return new DeclarationError(skillsSettings, {
    correction: text.correction,
    findings: [
      { arguments: settings === undefined ? [] : [settings], call: 'skills', mark: '0.skills' },
    ],
    sentence: `Plugin "${identity}" setting "skills" ${text.sentence}`,
  });
}

/** A name as a sentence repeats it: escaped, and `(none)` for one that is missing or not a string. */
function shownName(name: unknown): string {
  return typeof name === 'string' ? escapeControlCharacters(name) : '(none)';
}

/** Whether a value is an object a skill could be, not null and not a list. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The fault of an entry that is not an object. */
function notSkill(settings: unknown): DeclarationError {
  return settingFault(settings, {
    correction: 'Supply each skill as { name, files }.',
    sentence: 'holds an entry that is not a skill.',
  });
}

/** The fault of a name outside the grammar, or one that is missing. */
function badName(settings: unknown, name: unknown): DeclarationError {
  return settingFault(settings, {
    correction:
      'Use lowercase letters, digits, and single hyphens, 64 characters at most, such as notes.',
    sentence: `holds a name that is not a skill name: ${shownName(name)}.`,
  });
}

/** The fault of a name a second entry repeats. */
function repeated(settings: unknown, name: string): DeclarationError {
  return settingFault(settings, {
    correction: 'Give each skill its own name.',
    sentence: `holds the skill name ${name} twice.`,
  });
}

/** The fault of a skill whose `files` is not a function. */
function notFunction(settings: unknown, name: string): DeclarationError {
  return settingFault(settings, {
    correction: "Supply a function that returns the skill's files.",
    sentence: `holds a skill whose files is not a function: ${name}.`,
  });
}

/**
 * The fault of one entry of the list, or the entry's name when it has none. `seen` holds the names
 * of the entries before it.
 */
function judgeEntry(
  settings: unknown,
  entry: unknown,
  seen: ReadonlySet<string>,
): DeclarationError | string {
  if (!isObject(entry)) {
    return notSkill(settings);
  }
  const name: unknown = Reflect.get(entry, 'name');
  if (!isSkillName(name)) {
    return badName(settings, name);
  }
  if (seen.has(name)) {
    return repeated(settings, name);
  }
  return typeof Reflect.get(entry, 'files') === 'function' ? name : notFunction(settings, name);
}

/** The fault of the list or of the first entry that is not a skill, or none. */
function listFault(settings: SkillsSettings | undefined): DeclarationError | undefined {
  const list: unknown = settings?.skills;
  if (!Array.isArray(list) || list.length === empty) {
    return settingFault(settings, {
      correction: "Supply at least one skill, such as { name: 'notes', files: loadNotesSkill }.",
      sentence: 'is not a list of skills.',
    });
  }
  const seen = new Set<string>();
  for (const entry of list) {
    const judged = judgeEntry(settings, entry, seen);
    if (judged instanceof DeclarationError) {
      return judged;
    }
    seen.add(judged);
  }
  return undefined;
}

/**
 * Judges the settings at the `skills()` call: the list, then each skill in order, throwing the
 * first fault. Settings are required, so none is the list fault. It answers a copy of the skills,
 * so a later change to the author's list changes nothing.
 */
function judgeSettings(given: SkillsSettings | undefined): readonly Skill[] {
  const fault = listFault(given);
  if (fault !== undefined) {
    throw fault;
  }
  const list = given?.skills ?? [];
  return Object.freeze(list.map(({ files, name }) => Object.freeze({ files, name })));
}

export { identity, isSkillName, judgeSettings };
