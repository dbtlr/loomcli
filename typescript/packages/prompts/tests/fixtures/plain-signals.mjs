import { Application, processHandle } from '@loomcli/core';
import { plain } from '@loomcli/plugins/plain';

import { secret, text } from '../../dist/index.js';

/**
 * One question on the real terminal, asked line by line with `plain` as the first word and
 * redrawn otherwise: `secret`, `text`, `typedAhead`, a text, a secret, and a text in turn, or
 * `exit`, a secret the process exits during. Each handler the action registers reports whether
 * stdin is in raw mode when it runs, and so do the answer and the end of the run, so a test reads
 * raw mode on every path out.
 */
const [form, kind] = process.argv.slice(2);

/** Writes one report line straight to stderr, as a handler that runs inside a signal must. */
function report(line) {
  process.stderr.write(`${line} raw:${process.stdin.isRaw}\n`);
}

/** Asks the scenario's questions, answering a secret asked among others by its length alone. */
async function ask(context) {
  if (kind === 'typedAhead') {
    const name = await text(context, { message: 'Name' });
    const token = await secret(context, { message: 'Token' });
    return [name, token.length, await text(context, { message: 'After' })];
  }
  if (kind === 'secret' || kind === 'exit') {
    return secret(context, { message: 'Token' });
  }
  return text(context, { message: 'Name' });
}

await new Application('signals', { plugins: [plain()] })
  .action(async (context) => {
    // Shutdown and suspend handlers run newest first, so these run after the question's own.
    context.onShutdown(() => {
      report('SHUTDOWN');
    });
    context.onSuspend(() => {
      report('SUSPEND');
    });
    const asking = ask(context);
    if (kind === 'exit') {
      // The process ends while the secret waits, with no signal that aborts the run first.
      setTimeout(() => {
        process.exit(0);
      }, 200);
    }
    // Resume handlers run oldest first, so this one runs after the question's own reader.
    context.onResume(() => {
      report('RESUME');
    });
    report(`ANSWER:${JSON.stringify(await asking)}`);
  })
  .run({
    process: processHandle({ argv: form === 'plain' ? ['--plain'] : [] }),
    rendering: { color: 'never', modifiers: 'never' },
  });
report('DONE');
