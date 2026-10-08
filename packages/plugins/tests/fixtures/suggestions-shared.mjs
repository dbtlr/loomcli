import { Application, Command, UnknownOptionError } from '@loomcli/core';
import { suggestions } from '@loomcli/plugins/suggestions';

/** One failure instance an application keeps and throws from two actions, in two runs. */
const shared = new UnknownOptionError('--fiel');

function throwShared() {
  throw shared;
}

/** `near` declares the option the typo is near, and `far` declares none. */
const app = new Application('kit', { plugins: [suggestions()] })
  .command(new Command('near').option('field', { type: 'string' }).action(throwShared))
  .command(new Command('far').action(throwShared));

// `break` is no run: it makes the shared failure's spelling unreadable, so the next hook throws.
const runs = process.argv.slice(2);
for (const name of runs) {
  if (name === 'break') {
    Object.defineProperty(shared, 'spelling', {
      get() {
        throw new Error('The spelling cannot be read.');
      },
    });
  } else {
    process.exitCode = await app.run({ host: { argv: [name], release: { build: 'distributed' } } });
  }
}
