import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { Application, Command, NonCallableCommandError, locate } from '../src/index.js';

/*
 * Acceptance plan for arguments beside children (ADR-0160, docs/core/commands.md).
 *
 * - A root with an action declares arguments and holds children. A plain word that names a child
 *   routes into it, and any other plain word fills the first argument, after which no later word
 *   routes. Words after the first bare `--` fill the arguments.
 * - The root's own options read during routing bind to the Command routing reaches.
 * - A group reached through one word from a parent that declares arguments fails with the `--`
 *   sentence, and not under passthrough or from an invocation by name.
 * - `locate` reports the argument a word fills beside the children it may name.
 */

/** The `completion` group of the textstat shape, with one callable child and an alias. */
function completion() {
  return new Command('completion')
    .alias('comp')
    .command(new Command('bash').action(({ out }) => out.print('script')));
}

/** A root that counts its files, with its own `--lines` option and the `completion` group. */
function textstat() {
  return new Application('textstat')
    .argument('files', { variadic: true })
    .option('lines', { type: 'boolean' })
    .command(completion())
    .action(({ args, options, out }) =>
      out.print(`files:${args.files.join(',')} lines:${String(options.lines)}`),
    );
}

/** One run's exit code and streams. */
async function printed(app: { run: Application['run'] }, argv: string[]) {
  const mock = mockProcess({ argv });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test.each([
  [['completion', 'bash'], 'script\n'],
  [['comp', 'bash'], 'script\n'],
  [['a.txt'], 'files:a.txt lines:false\n'],
  [['a.txt', 'completion'], 'files:a.txt,completion lines:false\n'],
  [['--', 'completion'], 'files:completion lines:false\n'],
  [['complete'], 'files:complete lines:false\n'],
  [['--lines', 'a.txt'], 'files:a.txt lines:true\n'],
  [['a.txt', '--lines'], 'files:a.txt lines:true\n'],
  [[], 'files: lines:false\n'],
])('a root with arguments and children reads %j', async (argv, stdout) => {
  await expect(printed(textstat(), argv)).resolves.toEqual({ code: 0, stderr: '', stdout });
});

test('a word that names a child routes first, and one that names none after a group is unknown', async () => {
  const { code, stderr } = await printed(textstat(), ['completion', 'notes.txt']);
  expect(code).toBe(2);
  expect(stderr).toBe('textstat: Unknown command "notes.txt". Use one of: bash.\n');
});

test('a root option read before a child name binds to the child routing reaches', async () => {
  const { code, stderr } = await printed(textstat(), ['--lines', 'completion', 'bash']);
  expect(code).toBe(2);
  expect(stderr).toContain('Unknown option "--lines"');
});

test.each([
  [['completion'], 'completion'],
  [['comp'], 'comp'],
])('a group reached through %j says how to pass its name as an argument', async (argv, word) => {
  const { code, stderr } = await printed(textstat(), argv);
  expect(code).toBe(2);
  expect(stderr).toBe(
    `textstat: Command "completion" requires a subcommand. Use one of: bash. To pass "${word}" as an argument, write -- before it.\n`,
  );
});

test('the sentence is absent where the parent declares no argument or declares passthrough', async () => {
  const bare = new Application('kit').command(completion());
  const bareRun = await printed(bare, ['completion']);
  expect(bareRun.stderr).toBe(
    'kit: Command "completion" requires a subcommand. Use one of: bash.\n',
  );
  const passing = new Application('kit')
    .argument('files', { variadic: true })
    .passthrough()
    .command(completion())
    .action(({ out }) => out.print('ran'));
  const passingRun = await printed(passing, ['completion']);
  expect(passingRun.stderr).toBe(
    'kit: Command "completion" requires a subcommand. Use one of: bash.\n',
  );
});

test('the failure holds the typed word, and a construction without one holds none', () => {
  const typed = new NonCallableCommandError(['completion'], ['bash'], 'comp');
  expect(typed.argument).toBe('comp');
  const bare = new NonCallableCommandError(['completion'], ['bash']);
  expect(bare.argument).toBeUndefined();
  expect(bare.message).not.toContain('--');
});

test('an invocation by name never sets the typed word', async () => {
  const outcome = await textstat().invoke(['completion'], {});
  if (outcome.status !== 'failed') {
    throw new Error('Expected the group to fail.');
  }
  expect(outcome.failure).toBeInstanceOf(NonCallableCommandError);
  expect(outcome.failure).toMatchObject({ argument: undefined });
  expect(outcome.messages).not.toContain('--');
});

test.each([
  [['c'], 'files'],
  [[''], 'files'],
  [['--lines', 'c'], 'files'],
])('locate reads %j as a command position holding the argument', (words, argument) => {
  const position = locate(textstat().inspect(), words);
  expect(position).toMatchObject({ command: { path: [] }, kind: 'command' });
  expect(position.kind === 'command' && position.argument?.name).toBe(argument);
});

test('locate reads a word after an argument or a bare -- as the argument, not a command', () => {
  const graph = textstat().inspect();
  expect(locate(graph, ['a.txt', 'c']).kind).toBe('argument');
  expect(locate(graph, ['--', 'c']).kind).toBe('argument');
});

test('locate holds a null argument at a command position of a Command that declares none', () => {
  const position = locate(new Application('kit').command(completion()).inspect(), ['c']);
  expect(position).toMatchObject({ argument: null, kind: 'command' });
});

test('a group reached from a group, below a root that declares arguments, has no -- sentence', async () => {
  const app = new Application('textstat')
    .argument('files', { variadic: true })
    .command(
      new Command('cache').command(
        new Command('inner').command(new Command('x').action(({ out }) => out.print('x'))),
      ),
    )
    .action(() => undefined);
  const result = await printed(app, ['cache', 'inner']);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe('textstat: Command "inner" requires a subcommand. Use one of: x.\n');
});

/** Attaches a group that declares an argument, which the attach call refuses. */
function attachGroupWithArgument() {
  return new Application('app').command(
    new Command('cache')
      .argument('key', { description: 'k' })
      .command(new Command('x').action(() => undefined)),
  );
}

test("a group's argument fault marks the group's first argument call", () => {
  expect(attachGroupWithArgument).toThrow(
    expect.objectContaining({
      message: expect.stringContaining(
        [
          "    new Command('cache')",
          "      .argument('key', { description: 'k' })",
          '                ^^^^^ the first argument',
        ].join('\n'),
      ),
    }),
  );
});
