import { Application, Command } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/*
 * Each declaring call judges what it adds when it is made, so a fault throws from the call that
 * caused it, and a Command or Application value is never changed by a call made on it.
 */

/** The value one declaring call throws, or `undefined` when the call returns. */
function thrownBy(declare: () => unknown): unknown {
  try {
    declare();
  } catch (error) {
    return error;
  }
  return undefined;
}

test("a local option named like a global option reports the shared name before its config's faults", () => {
  const app = new Application('app').globalOption('verbose', { type: 'boolean' });
  // The types reject the shared name, so the call is made as an untyped JavaScript caller makes it.
  const declare = () =>
    Reflect.apply(app.option, app, ['verbose', { aliases: ['-v'], type: 'boolean' }]);
  expect(thrownBy(declare)).toMatchObject({
    name: 'DeclarationError',
    rule: { identity: '@loomcli/core/option-declared-twice' },
  });
});

test('an argument that claims stdin after an option claimed it throws from the argument() call', () => {
  const read = new Command('read').option('input', { stdin: true, type: 'content' });
  expect(thrownBy(() => read.argument('file', { stdin: true, type: 'content' }))).toMatchObject({
    name: 'DeclarationError',
    rule: { identity: '@loomcli/core/stdin-claimed-twice' },
  });
});

test('two branches of one Command value each declare the same option name their own way', async () => {
  const base = new Command('get').option('file', { type: 'string' });
  const flag = base.option('raw', { short: 'r', type: 'boolean' });
  const text = base.option('raw', { short: 'r', type: 'string' });
  const seen: unknown[] = [];
  for (const [command, argv] of [
    [flag, ['get', '-r']],
    [text, ['get', '-r', 'bytes']],
  ] as const) {
    const mock = mockProcess({ argv: [...argv] });
    const app = new Application('tool').command(
      command.action(({ options }) => {
        seen.push(options.raw);
      }),
    );
    await expect(app.run({ process: mock })).resolves.toBe(0);
  }
  expect(seen).toEqual([true, 'bytes']);
});
