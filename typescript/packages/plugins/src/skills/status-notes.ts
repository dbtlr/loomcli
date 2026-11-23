/*
 * The note under a skill's status row: the choice of sentence for the skill's state, said as a
 * phrase so the text view renders it in the run's language.
 */
import type { Phrase } from '@loomcli/core';

import { skillsPhrase } from './phrases.js';
import type { SkillState } from './types.js';
import { installStep } from './wording.js';
import type { NoteScope } from './wording.js';

function projectNote(name: string, state: SkillState, install: string): Phrase[] {
  if (state === 'missing') {
    return [skillsPhrase('projectSkillMissing', install)];
  }
  if (state === 'unmanaged') {
    return [skillsPhrase('projectSkillUnmanaged', name, install)];
  }
  return [skillsPhrase('projectSkillOutdated', install)];
}
/** The global notes explain refusal conditions before offering a replacing command. */
function globalNote(name: string, state: SkillState, install: string): Phrase[] {
  if (state === 'missing') {
    return [skillsPhrase('globalSkillMissing', install)];
  }
  if (state === 'unmanaged') {
    return [skillsPhrase('globalSkillUnmanaged', install)];
  }
  if (state === 'modified') {
    return [skillsPhrase('globalSkillModified', name, install)];
  }
  return [skillsPhrase('globalSkillOutdated', name)];
}
function statusNote(name: string, state: SkillState, scope: NoteScope): Phrase[] {
  if (state === 'current') {
    return [];
  }
  return (scope.project ? projectNote : globalNote)(name, state, installStep(name, scope));
}

export { statusNote };
