import { PassThrough } from 'node:stream';

import { Application, processHandle } from '@loomcli/core';
import type { Child, ChildExit, ChildOutput, Host, SpawnOptions } from '@loomcli/core';

declare const host: Host;

// One call shape starts a child the run waits for, one that streams, and one released to outlive the run.
const waited: Child = host.spawn('git', ['rev-parse', 'HEAD'], { cwd: 'notes', input: 'text' });
const streamed: Child = host.spawn('git', ['log'], {
  stderr: 'inherit',
  stdout: new PassThrough(),
});
const interactive: Child = host.spawn('vi', ['notes.md'], { stdin: 'inherit', stdout: 'inherit' });
const released: Child = host.spawn('notes', ['refresh'], { detached: true });
const bare: Child = host.spawn('true', []);

// @ts-expect-error TS2345: A child reads input or the run's stdin, never both.
host.spawn('cat', [], { input: 'text', stdin: 'inherit' });

// @ts-expect-error TS2353: A detached child takes no signal, because nothing in the run ends it.
host.spawn('notes', [], { detached: true, signal: AbortSignal.timeout(1) });

// @ts-expect-error TS2353: A detached child's streams are all ignored.
host.spawn('notes', [], { detached: true, stdout: 'capture' });

// @ts-expect-error TS2345: stdin inherits or is omitted; there is no other stdin choice.
host.spawn('cat', [], { stdin: 'capture' });

async function read(child: Child): Promise<string> {
  const exit: ChildExit = await child.exited;
  if (exit.kind === 'unstarted') {
    const error: Error = exit.error;
    return error.message;
  }
  const code: number = exit.code;
  const output: ChildOutput = exit.stdout;
  const bytes: Uint8Array = output.bytes;
  return `${code} ${output.text} ${bytes.length}`;
}

void read(waited);
void read(streamed);
void read(interactive);
void read(released);
bare.kill();
bare.kill('SIGINT');
bare.kill('SIGKILL');

// The host's folders are strings.
const home: string = host.home;
const scratch: string = host.tmpdir;
void home;
void scratch;

// A handle states its own folders, and takes no spawn of its own.
void new Application('folders').run({
  process: processHandle({ home: '/home/me', tmpdir: '/tmp' }),
});
void new Application('folders').run({
  process: processHandle({
    // @ts-expect-error TS2353: A supplied field cannot replace how the real process starts children.
    spawn: () => bare,
  }),
});

const options: SpawnOptions = { env: {}, stdout: 'ignore' };
void options;
