import { Application, Command, plugin } from '@loomcli/core';

// Each run prints the `ownOptions` record the fixture plugin's middleware reads, then its exit code.
const words = process.argv.slice(2);

/** A validator that accepts lowercase words, rejects `bad`, and throws for `throw`. */
const word = {
  '~standard': {
    validate: (value) => {
      if (value === 'throw') {
        throw new Error('The validator broke.');
      }
      return /^[a-z]+$/u.test(value) && value !== 'bad'
        ? { value: value.toUpperCase() }
        : { issues: [{ message: 'Use a lowercase word.' }] };
    },
    vendor: 'fixture',
    version: 1,
  },
};

/** A validator that accepts decimal digits alone. */
const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/u.test(value) ? { value: Number(value) } : { issues: [{ message: 'Use digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

/**
 * A plugin with a global option of its own and a local option its hook declares on every Command
 * with an action. Its middleware reports the record it reads before it continues.
 */
const owning = plugin('@fixture/owning', {
  middleware: {
    activate: 'always',
    load: async () => ({
      default: async ({ next, ownOptions }) => {
        const entries = Object.entries(ownOptions).map(([name, value]) => [
          name,
          value === undefined ? '<undefined>' : value,
        ]);
        process.stdout.write(
          `${JSON.stringify({ frozen: Object.isFrozen(ownOptions), own: Object.fromEntries(entries) })}\n`,
        );
        await next();
      },
    }),
  },
  onCommandAttach: (command) =>
    command.hasAction ? command.option('local', { type: 'string', validate: word }) : command,
  options: { mine: { type: 'string', validate: word }, spare: { type: 'string' } },
});

/** Another plugin's option, which never appears in the fixture plugin's record. */
const other = plugin('@fixture/other', { options: { theirs: { type: 'string' } } });

const app = new Application('owns', { plugins: [owning, other] })
  .globalOption('app', { type: 'string' })
  .command(
    new Command('get')
      .option('depth', { type: 'string', validate: digits })
      .action(() => undefined),
  );

const code = await app.run({ host: { argv: words } });
process.stdout.write(`exit:${String(code)}\n`);
