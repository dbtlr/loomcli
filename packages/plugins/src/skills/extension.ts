import { extension } from '@loomcli/core';
import type { Extension, StandardSchemaV1 } from '@loomcli/core';
import { check, object, pipe, string } from 'valibot';

import { packageName } from '../constants.js';
import { exactFacts } from '../exact-facts.js';
import { markdownRule } from '../lines.js';

/**
 * The skills plugin's fact on a Command: guidance for an agent that uses the Command through a
 * skill, which the Command's command reference carries.
 *
 * @public
 */
interface SkillCommandFacts {
  /** Markdown for an agent that uses the Command through a skill. */
  readonly guidance: string;
}

const markdown = pipe(string(), check(markdownRule.test, markdownRule.message));

const commandFactsSchema = object({ guidance: markdown });
const commandFacts = exactFacts<SkillCommandFacts>()(commandFactsSchema);

/**
 * Adds guidance for an agent to a Command's command reference, in every skill that selects the
 * Command. The guidance is Markdown that holds a character other than whitespace, carried as
 * written, and a later value replaces an earlier one whole. It ships apart from the plugin's entry,
 * as declarations alone, so a Command library adds guidance without importing the plugin. Its
 * published schema is a Standard Schema over `SkillCommandFacts`, so an author's type check loads no
 * validation library's declarations.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { skillCommand } from '@loomcli/plugins/skills/extension';
 *
 * export const list = new Command('list', {
 *   description: 'List the notes, newest first.',
 *   extensions: [
 *     skillCommand({ guidance: 'Read each row with `--format json`, and pass its `id` to the Command that changes a note.' }),
 *   ],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/skills.md#skill-guidance
 *
 * @public
 */
export const skillCommand: Extension<
  'command',
  StandardSchemaV1<SkillCommandFacts, SkillCommandFacts>
> = extension(`${packageName}/skills/command`, {
  schema: commandFacts,
  target: 'command',
});

export type { SkillCommandFacts };
