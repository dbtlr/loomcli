/*
 * The application at the top of docs/plugins/skills.md, with its `note` Command and the `add` and
 * `list` children of the page's example, whose command references the golden files in
 * `skill-references/` hold. The skills settings come from the test, so one declaration serves the
 * renderer, an install, and `skillFolders`.
 */
import { Application, Command, EX_TEMPFAIL, FatalError } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { refreshSkills, skills } from '@loomcli/plugins/skills';
import type { FolderSkillsSettings, SkillsSettings } from '@loomcli/plugins/skills';
import { skillCommand } from '@loomcli/plugins/skills/extension';
import { table } from '@loomcli/plugins/table';

interface Note {
  readonly id: string;
  readonly tag: string;
  readonly text: string;
}

class StoreLockedError extends FatalError {
  static override readonly code = 'store-locked';
  static override readonly exitCode = EX_TEMPFAIL;

  constructor() {
    super('Another run holds the note file. Run the command again once it finishes.');
    this.name = 'StoreLockedError';
  }
}

const add = new Command('add', { description: 'Add a note.' })
  .stdin({ description: 'The note text.', required: true })
  .action(() => {});

const list = new Command('list', {
  description: 'List the notes, newest first.',
  extensions: [
    skillCommand({
      guidance:
        'Read each row with `--format json`, and pass its `id` to the Command that changes a note.',
    }),
    manifestCommand({
      details: 'Each row holds `id`, `tag`, and `text`.',
      examples: [
        { command: 'note list --tag home --limit 5', note: 'The five newest notes tagged home.' },
      ],
      failures: [{ failure: StoreLockedError, meaning: 'Another run holds the note file.' }],
    }),
  ],
})
  .visibleAlias('ls')
  .option('tag', {
    description: 'Show only notes with this tag.',
    env: 'NOTES_TAG',
    type: 'string',
  })
  .option('untagged', { description: 'Show only notes with no tag.', type: 'boolean' })
  .option('limit', { default: '20', description: 'Show at most this many notes.', type: 'string' })
  .exclusive('tag', 'untagged')
  .rows<Note>({ views: { table: table({ columns: [{ header: 'NOTE', key: 'text' }] }) } })
  .action(() => []);

const note = new Command('note', { description: 'Write and list notes.' })
  .command(add)
  .command(list);

/** The page's application, its skills plugin given the settings, with any further plugins after the page's. */
function notesApplication(
  settings: SkillsSettings | FolderSkillsSettings,
  more: readonly Plugin[] = [],
) {
  return new Application('notes', {
    description: 'Keep short notes in one file.',
    plugins: [
      help(),
      format(),
      skills(settings),
      selfUpdate({ afterReplace: refreshSkills }),
      ...more,
    ],
    version: '1.4.0',
  }).command(note);
}

export { notesApplication };
