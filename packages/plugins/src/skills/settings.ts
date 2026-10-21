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

/** What a setting's fault says: the rest of its sentence after the plugin's setting, and its correction. */
interface FaultText {
  readonly sentence: string;
  readonly correction: string;
}

/** The fault of the `skills` setting, marked on its key. */
function settingFault(settings: SkillsSettings, text: FaultText): DeclarationError {
  return new DeclarationError(skillsSettings, {
    correction: text.correction,
    findings: [{ arguments: [settings], call: 'skills', mark: '0.skills' }],
    sentence: `Plugin "${identity}" setting "skills" ${text.sentence}`,
  });
}

/**
 * Judges the skill names at the `skills()` call, in order, throwing the first fault: a name outside
 * the Agent Skills grammar, or a name an earlier skill holds. It answers the skills.
 */
function judgeSettings(settings: SkillsSettings): readonly Skill[] {
  const seen = new Set<string>();
  for (const { name } of settings.skills) {
    if (!isSkillName(name)) {
      throw settingFault(settings, {
        correction:
          'Use lowercase letters, digits, and single hyphens, 64 characters at most, such as notes.',
        sentence: `holds a name that is not a skill name: ${escapeControlCharacters(name)}.`,
      });
    }
    if (seen.has(name)) {
      throw settingFault(settings, {
        correction: 'Give each skill its own name.',
        sentence: `holds the skill name ${name} twice.`,
      });
    }
    seen.add(name);
  }
  return settings.skills;
}

export { identity, isSkillName, judgeSettings };
