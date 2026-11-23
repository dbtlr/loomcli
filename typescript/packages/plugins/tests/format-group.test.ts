import { Application, Command, locate } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { prose } from '@loomcli/plugins/prose';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/*
 * Acceptance plan for the formatter at a group (docs/plugins/format.md, the hook at a group).
 *
 * - `notes --format json` and `jsonl` write the missing subcommand as the JSON line, and
 *   `notes --format yaml` as text.
 * - `notes --format json list` routes to `list` and selects its `json` view, and
 *   `notes --format json plain` is the unknown option on `plain`, which declares no result.
 * - A child's own `--format` before its name takes the occurrence.
 * - The option is hidden: the root's help page lists no `--format`, and `inspect()` publishes it
 *   with `hidden: true`.
 * - Completion completes past it: `notes --format <Tab>` offers exactly `json` and `jsonl`, through
 *   the completion plugin's own answer, and `notes --format json <Tab>` the root's children.
 */

/** `notes`: a group root over `list`, with a result, `plain`, with none, and `export`, with its own `--format`. */
function notes() {
  return new Application('notes', { plugins: [help(), format()] })
    .command(
      new Command('list')
        .result<string>({ views: { text: prose() } })
        .action(({ out }) => out.results('a')),
    )
    .command(new Command('plain').action(() => {}))
    .command(
      new Command('export')
        .option('format', { type: 'string' })
        .action(({ options, out }) => out.print(`export:${String(options.format)}`)),
    );
}

/** One run's exit code and streams. */
async function printed(argv: string[]) {
  const mock = mockProcess({ argv, env: { NO_COLOR: '1' } });
  const code = await notes().run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

const missing =
  '{"error":{"code":"missing-subcommand","exitCode":2,"message":"A command is required. Use one of: list, plain, export.","hints":["Run \\"notes --help\\" to see the usage."]}}\n';

test('--format json and jsonl at a group write the missing subcommand as the JSON line', async () => {
  for (const name of ['json', 'jsonl', 'ndjson']) {
    await expect(printed(['--format', name])).resolves.toEqual({
      code: 2,
      stderr: missing,
      stdout: '',
    });
  }
});

test('a format the group does not know writes the missing subcommand as text', async () => {
  await expect(printed(['--format', 'yaml'])).resolves.toEqual({
    code: 2,
    stderr:
      'notes: A command is required. Use one of: list, plain, export.\nRun "notes --help" to see the usage.\n',
    stdout: '',
  });
});

test("--format before a child's name routes to it and selects its view", async () => {
  await expect(printed(['--format', 'json', 'list'])).resolves.toEqual({
    code: 0,
    stderr: '',
    stdout: '"a"\n',
  });
});

test('--format before a child that declares no result is the unknown option on that child', async () => {
  const { code, stderr } = await printed(['--format', 'json', 'plain']);
  expect(code).toBe(2);
  expect(stderr).toContain('notes: Unknown option "--format".');
  expect(stderr).toContain('Run "notes plain --help" to see the usage.');
});

test("a child's own --format before its name takes the occurrence", async () => {
  await expect(printed(['--format', 'csv', 'export'])).resolves.toEqual({
    code: 0,
    stderr: '',
    stdout: 'export:csv\n',
  });
});

test("the group's --format is hidden from help and published hidden by inspect()", async () => {
  const { stdout } = await printed(['--help']);
  expect(stdout).not.toContain('--format');
  const declared = notes()
    .inspect()
    .root.options.find(({ name }) => name === 'format');
  expect(declared).toMatchObject({ hidden: true, name: 'format' });
});

test('completion completes past the hidden --format at a group', () => {
  const graph = notes().inspect();
  expect(locate(graph, ['--format', ''])).toMatchObject({
    command: { path: [] },
    kind: 'value',
    option: { name: 'format' },
  });
  expect(locate(graph, ['--format', 'json', ''])).toMatchObject({
    command: { path: [] },
    kind: 'command',
  });
});

test('completion offers exactly json and jsonl after --format at a group', async () => {
  const app = new Application('notes', { plugins: [format(), completion()] }).command(
    new Command('list')
      .result<string>({ views: { text: prose() } })
      .action(({ out }) => out.results('a')),
  );
  const mock = mockProcess({ argv: ['completion', '__complete', '--', '--format', ''] });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe('json\njsonl\n:4\n');
});
