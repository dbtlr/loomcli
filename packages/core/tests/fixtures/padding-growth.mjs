import { Writable } from 'node:stream';

import { Application, pad } from '@loomcli/core';

// Run after building. Compare unchanged wrappers with a combining mark appended at each level.
const mode = process.argv[2] ?? 'concatenated';
const depths = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1000, 2000, 4000];
if (
  !['unchanged', 'concatenated'].includes(mode) ||
  depths.some((depth) => !Number.isSafeInteger(depth) || depth < 1)
) {
  throw new Error('Use unchanged or concatenated, followed by positive integer depths.');
}
for (const depth of depths) {
  const opening = pad('', 1).slice(0, -1);
  const ending = mode === 'concatenated' ? '\u0301\uE002' : '\uE002';
  const input = `${opening.repeat(depth)}e${ending.repeat(depth)}`;
  let outputBytes = 0;
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      outputBytes += chunk.length;
      callback();
    },
  });
  const app = new Application('padding-growth').action(({ out }) =>
    out.render(input, { render: (value) => value }),
  );
  const started = performance.now();
  const status = await app.run({ host: { argv: [], env: {}, stdout } });
  const elapsedMs = Math.round(performance.now() - started);
  console.log(
    JSON.stringify({ depth, elapsedMs, inputUnits: input.length, mode, outputBytes, status }),
  );
}
