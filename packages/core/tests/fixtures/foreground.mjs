import { PassThrough } from 'node:stream';
import { ReadStream } from 'node:tty';

import { Application, processHandle } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';

const app = new Application('foreground', { plugins: [background()] }).action(() => undefined);
const terminal = { stderr: { isTTY: true }, stdin: { isTTY: true }, stdout: { isTTY: true } };

/**
 * Records whether the background query attempted to switch stdin to raw mode. The process starts
 * in a session with no controlling terminal. Its terminal stream represents one opened on /dev/tty.
 */
async function queried(stdin) {
  let attempted = false;
  stdin.setRawMode = () => {
    attempted = true;
    throw new Error('Fixture stream does not offer raw mode.');
  };
  const code = await app.run({
    process: processHandle({
      argv: [],
      env: { FORCE_COLOR: '1', TERM: 'xterm-256color' },
      stderr: new PassThrough(),
      stdin,
      stdout: new PassThrough(),
      terminal,
    }),
  });
  if (code !== 0) {
    throw new Error(`Foreground fixture exited with code ${code}.`);
  }
  return attempted;
}

const result = {
  scripted: await queried(new PassThrough()),
  terminal: await queried(Object.create(ReadStream.prototype)),
};
process.stdout.write(`${JSON.stringify(result)}\n`);
