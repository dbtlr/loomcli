import { Application, Command, UnknownOptionError } from '@loomcli/core';
import { suggestions } from '@loomcli/plugins/suggestions';
import { mockProcess } from '@loomcli/testing';

/**
 * Runs the named Commands of one application in turn, each on a mock process of its own, and
 * answers what they wrote to stderr in order. Every run throws the one failure instance the
 * application keeps. `near` declares the option the typo is near, and `far` declares none. `break`
 * is no run: it makes the shared failure's spelling unreadable, so the next hook throws.
 */
async function runShared(names: readonly string[]): Promise<string> {
  const shared = new UnknownOptionError('--fiel');
  const throwShared = () => {
    throw shared;
  };
  const app = new Application('kit', { plugins: [suggestions()] })
    .command(new Command('near').option('field', { type: 'string' }).action(throwShared))
    .command(new Command('far').action(throwShared));
  let stderr = '';
  for (const name of names) {
    if (name === 'break') {
      Object.defineProperty(shared, 'spelling', {
        get() {
          throw new Error('The spelling cannot be read.');
        },
      });
    } else {
      const mock = mockProcess({ argv: [name], release: { build: 'distributed' } });
      await app.run({ process: mock });
      stderr += mock.stderr.text;
    }
  }
  return stderr;
}

export { runShared };
