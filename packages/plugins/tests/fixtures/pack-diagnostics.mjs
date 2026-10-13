import { DeclarationError } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { logging } from '@loomcli/plugins/logging';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { service } from '@loomcli/plugins/service';
import { version } from '@loomcli/plugins/version';

/**
 * One faulty call per scenario, each reachable from JavaScript alone. The fixture prints the
 * Developer Diagnostic its message holds.
 */
const scenarios = {
  'config-glob': () => config({ file: '*.json' }),
  'config-list': () => config({ file: '.textstat.{toml,ini}' }),
  'config-path': () => config({ file: '/etc/textstat.json' }),
  'logging-console': () => logging({ file: 'a.jsonl', to: 'console' }),
  'logging-keep': () => logging({ keep: 0 }),
  'self-update-hook': () => selfUpdate({ afterReplace: 1 }),
  'service-label': () => service({ label: 'notes', run: ['serve'] }),
  'service-none': () => service(),
  'service-probe': () => service({ label: 'com.acme.notes', probe: 1, run: ['serve'] }),
  'service-run-control': () => service({ label: 'com.acme.notes', run: ['serve', 'a\u0007b'] }),
  'service-run-empty': () => service({ label: 'com.acme.notes', run: [] }),
  'service-run-word': () => service({ label: 'com.acme.notes', run: ['serve', 8080] }),
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
