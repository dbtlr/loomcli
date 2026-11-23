/*
 * An input's subject escapes the name it repeats (docs/core/failures.md#failure-message-voice,
 * rule 5). A rejected or missing input's line names the input by its spelling and, for a value an
 * input source filled, by that source, and a control character or a bidirectional control in
 * either prints as its `\uXXXX` escape, so it cannot reorder or break the line.
 *
 * Every case runs an Application in process on a mock process.
 */
import { Application } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

test("a rejected input's line escapes its spelling and the variable that filled it", async () => {
  const mock = mockProcess({ argv: [], env: { 'APP_\u202eLEVEL': 'loud' } });
  const status = await new Application('app')
    .option('lev\u202eel', { env: 'APP_\u202eLEVEL', type: 'count' })
    .action(() => {})
    .run({ process: mock });
  expect({ status, stderr: mock.stderr.text }).toEqual({
    status: 2,
    stderr:
      'app: Option "--lev\\u202eel" (from APP_\\u202eLEVEL): Use a whole number of 0 or more.\n',
  });
});
