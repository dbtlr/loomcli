import { Application, Command, DeclarationError } from '@loomcli/core';
import { service } from '@loomcli/plugins/service';

/** An application whose `service()` runs `words`, beside a Command with options and a group. */
function serviceGraphApplication(words: readonly string[]) {
  return new Application('notes', {
    description: 'Keep notes in sync.',
    plugins: [service({ label: 'com.acme.notes', run: [...words] })],
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
}

/** One fault as a line: its rule, its sentence, and its correction. */
function faultLine(fault: DeclarationError): string {
  const correction = fault.correction === undefined ? [] : [fault.correction].flat();
  return `${fault.rule?.identity}: ${[fault.sentence, ...correction].join(' ')}\n`;
}

/** Each fault `check()` reports as a line, or `clean` when it reports none. */
function checked(words: readonly string[]): string {
  const faults = serviceGraphApplication(words).check();
  return faults.length === 0 ? 'clean\n' : faults.map(faultLine).join('');
}

/** The fault `inspect()` throws as a line after `thrown:`, or `inspected` when it throws none. */
function inspected(words: readonly string[]): string {
  try {
    serviceGraphApplication(words).inspect();
    return 'inspected\n';
  } catch (error) {
    if (error instanceof DeclarationError) {
      return `thrown:${faultLine(error)}`;
    }
    throw error;
  }
}

export { checked, inspected, serviceGraphApplication };
