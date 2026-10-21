import { DeclarationError } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { dotenv } from '@loomcli/plugins/dotenv';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { service } from '@loomcli/plugins/service';
import { skills } from '@loomcli/plugins/skills';
import { version } from '@loomcli/plugins/version';

/**
 * One faulty call per scenario, each reachable from JavaScript alone. The fixture prints the
 * Developer Diagnostic its message holds.
 */
const scenarios = {
  'config-glob': () => config({ file: '*.json' }),
  'config-list': () => config({ file: '.textstat.{toml,ini}' }),
  'config-path': () => config({ file: '/etc/textstat.json' }),
  'dotenv-except': () => dotenv({ except: ['1X'] }),
  'dotenv-only': () => dotenv({ only: ['API_TOKEN', 'API-TOKEN'] }),
  'self-update-notices-env': () => selfUpdate({ notices: { env: '1X' } }),
  'self-update-notices-hyphen': () => selfUpdate({ notices: { env: 'A-B' } }),
  'service-label': () => service({ label: 'notes', run: ['serve'] }),
  'service-none': () => service(),
  'skills-empty': () => skills({ skills: [] }),
  'skills-entry': () => skills({ skills: [1] }),
  'skills-files': () => skills({ skills: [{ files: 'notes.md', name: 'notes' }] }),
  'skills-list': () => skills({ skills: 'notes' }),
  'skills-name': () => skills({ skills: [{ files: () => [], name: 'Notes' }] }),
  'skills-name-none': () => skills({ skills: [{ files: () => [] }] }),
  'skills-none': () => skills(),
  'skills-twice': () =>
    skills({
      skills: [
        { files: () => [], name: 'notes' },
        { files: () => [], name: 'notes' },
      ],
    }),
  'version-blank': () => version({ postfix: ' ' }),
  'version-lines': () => version({ postfix: 'schema\nv1' }),
  'version-number': () => version({ postfix: 1 }),
};

try {
  scenarios[process.argv[2]]();
  process.stdout.write('returned\n');
} catch (error) {
  if (!(error instanceof DeclarationError)) {
    throw error;
  }
  process.stdout.write(`${error.message}\n`);
}
