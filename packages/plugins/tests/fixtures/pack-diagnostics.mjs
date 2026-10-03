import { DeclarationError } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';

/**
 * One faulty call per scenario, each reachable from JavaScript alone. The fixture prints the
 * Developer Diagnostic its message holds.
 */
const scenarios = {
  'config-glob': () => config({ file: '*.json' }),
  'config-list': () => config({ file: '.textstat.{toml,ini}' }),
  'config-path': () => config({ file: '/etc/textstat.json' }),
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
