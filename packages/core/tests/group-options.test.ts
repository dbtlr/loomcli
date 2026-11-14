import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { Application, Command, plugin } from '../src/index.js';
import type { CommandAttachHook, MiddlewareContext } from '../src/index.js';

/*
 * Acceptance plan for a group's own options (docs/core/commands.md#nested-commands-and-groups).
 *
 * - An author's option on a group is read in routing as a parent's own option: it binds to the
 *   child that declares the spelling, is the unknown option on a child that does not, and stays at
 *   the group when routing ends there.
 * - A hook's option on a group reaches its plugin's middleware under `ownOptions`, validated under
 *   the held missing-subcommand fault, which stays the one raised.
 */

/** A Standard Schema validator that accepts a string and returns it in capitals. */
const upper = {
  '~standard': {
    validate: (value: unknown) => ({ value: String(value).toUpperCase() }),
    vendor: 'fixture',
    version: 1 as const,
  },
};

/** A hook that declares a hidden `--tag` on every group. */
const tagOnGroups: CommandAttachHook = (command) =>
  command.hasAction
    ? command
    : command.option('tag', { hidden: true, type: 'string', validate: upper });

/** One run's exit code and streams. */
async function printed(app: { run: Application['run'] }, argv: string[]) {
  const mock = mockProcess({ argv });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** `store`, whose `cache` group declares its own `--force`, over `clear`, which may declare one. */
function store(clearForce: boolean) {
  const clear = clearForce
    ? new Command('clear')
        .option('force', { type: 'boolean' })
        .action(({ options, out }) => out.print(`force:${String(options.force)}`))
    : new Command('clear').action(({ out }) => out.print('cleared'));
  const cache = new Command('cache').option('force', { type: 'boolean' }).command(clear);
  return new Application('store').command(cache);
}

test("an author's option on a group binds to the child that declares the spelling", async () => {
  await expect(printed(store(true), ['cache', '--force', 'clear'])).resolves.toEqual({
    code: 0,
    stderr: '',
    stdout: 'force:true\n',
  });
});

test("an author's option on a group is the unknown option on a child that declares none", async () => {
  const { code, stderr } = await printed(store(false), ['cache', '--force', 'clear']);
  expect(code).toBe(2);
  expect(stderr).toContain('Unknown option "--force".');
});

test("an author's option on a group stays at the group when routing ends there", async () => {
  const { code, stderr } = await printed(store(true), ['cache', '--force']);
  expect(code).toBe(2);
  expect(stderr).toContain('Command "cache" requires a subcommand.');
});

test("a hook's option on a group reaches its plugin's middleware under the held missing subcommand", async () => {
  const read: unknown[] = [];
  const tagging = plugin('@fixture/tag', {
    middleware: {
      activate: 'always',
      load: () =>
        Promise.resolve({
          default: async ({ next, ownOptions }: MiddlewareContext) => {
            read.push(ownOptions.tag);
            await next();
          },
        }),
    },
    onCommandAttach: tagOnGroups,
  });
  const app = new Application('notes', { plugins: [tagging] }).command(
    new Command('list').action(() => {}),
  );
  const { code, stderr } = await printed(app, ['--tag', 'x']);
  expect(code).toBe(2);
  expect(stderr).toContain('A command is required.');
  expect(read).toEqual(['X']);
});
