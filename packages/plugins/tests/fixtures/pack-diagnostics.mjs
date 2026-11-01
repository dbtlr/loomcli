// JavaScript intentionally supplies settings and declarations that the public types reject.
import { DeclarationError } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { dotenv } from '@loomcli/plugins/dotenv';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { service } from '@loomcli/plugins/service';
import { skills } from '@loomcli/plugins/skills';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

const schema = z.object({});

/**
 * One faulty call per scenario, each reachable from JavaScript alone. The fixture prints the
 * Developer Diagnostic its message holds.
 */
const scenarios = {
  'config-glob': () => configuration({ file: '*.json', schema }),
  'config-list': () => configuration({ file: '.textstat.{toml,ini}', schema }),
  'config-path': () => configuration({ file: '/etc/textstat.json', schema }),
  'config-root': () => configuration({ root: 'packages/cli', schema }),
  'config-root-scope': () => configuration({ root: '.git', schema, scopes: ['user'] }),
  'config-variable': () => configuration({ env: 'TEXTSTAT-CONFIG', schema }),
  'dotenv-except': () => dotenv({ except: ['1X'] }),
  'dotenv-only': () => dotenv({ only: ['API_TOKEN', 'API-TOKEN'] }),
  'self-update-notices-env': () => selfUpdate({ notices: { env: '1X' } }),
  'self-update-notices-hyphen': () => selfUpdate({ notices: { env: 'A-B' } }),
  'service-label': () => service({ label: 'notes', run: ['serve'] }),
  'skills-empty-folder': () => skills({ folder: '' }),
  'skills-empty-list': () => skills({ skills: [] }),
  'skills-name': () => skills({ skills: [{ files: () => [], name: 'Notes' }] }),
  'skills-neither': () => skills({}),
  'skills-twice': () =>
    skills({
      skills: [
        { files: () => [], name: 'notes' },
        { files: () => [], name: 'notes' },
      ],
    }),
  'skills-web-folder': () => skills({ folder: new URL('https://example.com/skills/') }),
  'version-blank': () => version({ postfix: ' ' }),
  'version-lines': () => version({ postfix: 'schema\nv1' }),
  'version-number': () => version({ postfix: 1 }),
};

export function diagnostic(scenario) {
  try {
    scenarios[scenario]();
    return 'returned\n';
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    return `${error.message}\n`;
  }
}
