import { Writable } from 'node:stream';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { Application, processHandle } from '@loomcli/core';

// A full collection, under Bun through its own call and under Node through the flag V8 reads once set.
function collect() {
  if (globalThis.Bun !== undefined) {
    globalThis.Bun.gc(true);
    return;
  }
  setFlagsFromString('--expose-gc');
  runInNewContext('gc')();
}

const discard = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

// Three settled calls, each held only through a weak reference once it has resolved.
async function settled(out) {
  const calls = [out.print('line'), out.info('note'), out.warn('caution')];
  const references = calls.map((call) => new WeakRef(call));
  await Promise.all(calls);
  return references;
}

let retained = -1;
const app = new Application('settled').action(async ({ out }) => {
  const references = await settled(out);
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  collect();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  collect();
  retained = references.filter((reference) => reference.deref() !== undefined).length;
});
const code = await app.run({
  process: processHandle({
    argv: [],
    release: { build: 'distributed' },
    stderr: discard,
    stdout: discard,
  }),
});
process.stdout.write(`${JSON.stringify({ code, retained })}\n`);
