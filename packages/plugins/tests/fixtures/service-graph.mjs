import { Application, Command, processHandle } from '@loomcli/core';
import { service } from '@loomcli/plugins/service';

/**
 * An application whose `service()` runs the words the first argument holds as JSON. `check`
 * prints each fault `check()` reports, `inspect` prints the fault `inspect()` throws, and any other
 * mode runs the application, its build named by `FIXTURE_BUILD`.
 */
const [words, mode] = process.argv.slice(2);

const app = new Application('notes', {
  description: 'Keep notes in sync.',
  plugins: [service({ label: 'com.acme.notes', run: JSON.parse(words) })],
})
  .command(
    new Command('serve', { description: 'Serve the notes.' })
      .option('port', { description: 'The port to serve on.', type: 'string' })
      .option('verbose', { description: 'Write more.', type: 'boolean' })
      .action(({ out }) => out.print('serving')),
  )
  .command(
    new Command('cache', { description: 'Manage the cache.' }).command(
      new Command('clear', { description: 'Clear the cache.' }).action(({ out }) =>
        out.print('cleared'),
      ),
    ),
  );

/** One fault as a line: its rule, its sentence, and its correction. */
function line(fault) {
  return `${fault.rule?.identity}: ${fault.sentence} ${fault.correction}\n`;
}

if (mode === 'check') {
  const faults = app.check();
  process.stdout.write(faults.length === 0 ? 'clean\n' : faults.map(line).join(''));
} else if (mode === 'inspect') {
  try {
    app.inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    process.stdout.write(`thrown:${line(error)}`);
  }
} else {
  process.exitCode = await app.run({
    process: processHandle({
      argv: ['serve'],
      release: { build: process.env.FIXTURE_BUILD ?? 'distributed' },
    }),
  });
}
