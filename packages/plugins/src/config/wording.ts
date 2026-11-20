/*
 * The configuration plugin's table of fixes, under ADR-0200's wording modules: the step each
 * sentence of `messages.ts` ends with for a clause a reader returns, which a translation words in
 * its own sentences. `tests/message-voice.test.ts` reads this module as a message module.
 */
import type { Problem } from './messages.js';
import type { Clause } from './reading.js';

/** What the operator does about one clause: for the file `--config` named, and for a discovered file. */
interface Fix {
  readonly named: string;
  /** Absent for a clause a discovered file is silent about. */
  readonly discovered?: string;
}

/** The English clause of each code, which follows a file's name and ends with a full stop. */
const clauses: Readonly<Record<Clause, string>> = {
  'invalid-json': 'is not valid JSON.',
  'invalid-toml': 'is not valid TOML.',
  'invalid-yaml': 'is not valid YAML.',
  missing: 'does not exist.',
  'not-json-object': 'does not hold a JSON object.',
  'not-yaml-mapping': 'does not hold a YAML mapping.',
  unreadable: 'could not be read.',
};

/** The one table of fixes, so each sentence the plugin writes ends with its step. */
const fixes: Readonly<Record<Clause, Fix>> = {
  'invalid-json': {
    discovered: 'Correct its syntax, or remove it.',
    named: 'Correct its syntax, or supply another file.',
  },
  'invalid-toml': {
    discovered: 'Correct its syntax, or remove it.',
    named: 'Correct its syntax, or supply another file.',
  },
  'invalid-yaml': {
    discovered: 'Correct its syntax, or remove it.',
    named: 'Correct its syntax, or supply another file.',
  },
  missing: { named: 'Supply the path of an existing file.' },
  'not-json-object': {
    discovered: 'Write its settings as one JSON object, or remove it.',
    named: 'Write its settings as one JSON object.',
  },
  'not-yaml-mapping': {
    discovered: 'Write its settings as one YAML mapping, or remove it.',
    named: 'Write its settings as one YAML mapping.',
  },
  unreadable: {
    discovered: 'Make it readable, or remove it.',
    named: 'Supply a file this process can read.',
  },
};

/** Whether a discovered file the problem describes warns, or the lookup passes over it in silence. */
function isSilent(problem: Problem): boolean {
  return 'clause' in problem && fixes[problem.clause].discovered === undefined;
}

export { clauses, fixes, isSilent };
