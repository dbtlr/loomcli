/*
 * The configuration plugin's -v and -vv lines, under "At -v and in the log" in its reference and
 * ADR-0165. Each case builds a tree under the temporary directory, `home/work/project`, with the
 * mock's home at `home`, its `cwd` at `project`, and its ceiling at `home`, so the walk looks in
 * `project` and `work` and the user scope then looks in `home` and its user folder. Every case
 * removes its tree.
 *
 * - The default verbosity writes no new line.
 * - At -v the file read is named once, before any Ignored line, and a lookup that finds none says
 *   so, unless the notice prints, under --no-config, or after a broken file's warning.
 * - At -vv each place the lookup looked and found nothing is named in order, the variable's missing
 *   file included, and no candidate after the file found in its directory.
 * - The lanes keep their rules: -v -q writes none, and an invocation by name shows the lines in its
 *   messages when its values ask for them.
 * - A control character in a path is escaped.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import type { ConfigurationSettings } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { toml } from '@loomcli/plugins/config/toml';
import { yaml } from '@loomcli/plugins/config/yaml';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** The tree one case runs in. */
interface Tree {
  readonly home: string;
  readonly work: string;
  readonly project: string;
}

/** Runs a case in a fresh tree and removes the tree after. */
async function inTree(body: (tree: Tree) => Promise<void>): Promise<void> {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'loom-config-lines-')));
  try {
    const home = join(top, 'home');
    const work = join(home, 'work');
    const project = join(work, 'project');
    mkdirSync(project, { recursive: true });
    await body({ home, project, work });
  } finally {
    rmSync(top, { force: true, recursive: true });
  }
}

const schema = z.object({ title: z.string().optional() });

type Settings = Omit<ConfigurationSettings<typeof schema>, 'schema'>;

/** The application: one option the file's `title` answers, and -v and -q. */
function application(settings: Settings = {}) {
  const config = configuration({ ...settings, schema });
  return new Application('app', { plugins: [config.plugin, verbose()] })
    .option('title', {
      description: 'The title.',
      extensions: [configInput({ path: 'title' })],
      type: 'string',
    })
    .action(() => {});
}

/** The stderr of one run in the tree, from `project`, with the given argv and environment. */
async function stderrOf(
  tree: Tree,
  argv: readonly string[],
  options: { settings?: Settings; env?: Record<string, string> } = {},
): Promise<string> {
  const mock = mockProcess({
    argv,
    ceiling: tree.home,
    cwd: tree.project,
    env: { HOME: tree.home, ...options.env },
  });
  await application(options.settings).run({ process: mock });
  return mock.stderr.text;
}

const read = (file: string) => `› Read configuration from ${file}.\n`;
const lookedFor = (file: string) => `  ┆ Looked for ${file}: not found.\n`;
const noFile = '› Found no configuration file.\n';

test('the default verbosity writes no line for a file read or for none found', async () => {
  await inTree(async (tree) => {
    await expect(stderrOf(tree, [])).resolves.toBe('');
    writeFileSync(join(tree.project, '.app.json'), '{"title":"x"}');
    await expect(stderrOf(tree, [])).resolves.toBe('');
  });
});

test('-v names the file the lookup read, as its label shows it', async () => {
  await inTree(async (tree) => {
    writeFileSync(join(tree.work, '.app.json'), '{"title":"x"}');
    await expect(stderrOf(tree, ['-v'])).resolves.toBe(read(join(tree.work, '.app.json')));
    writeFileSync(join(tree.project, '.app.json'), '{"title":"x"}');
    await expect(stderrOf(tree, ['-v'])).resolves.toBe(read('.app.json'));
  });
});

test('-v names the --config file as the operator wrote it', async () => {
  await inTree(async (tree) => {
    writeFileSync(join(tree.work, 'named.json'), '{"title":"x"}');
    await expect(stderrOf(tree, ['-vv', '--config', '../named.json'])).resolves.toBe(
      read('../named.json'),
    );
  });
});

test('the file read is named before the Ignored lines about it', async () => {
  await inTree(async (tree) => {
    writeFileSync(join(tree.project, '.app.json'), '{"title":5}');
    await expect(stderrOf(tree, ['-v'])).resolves.toBe(
      `${read('.app.json')}› Ignored title in .app.json: Invalid input: expected string, received number\n`,
    );
  });
});

test('-vv names each place the lookup looked, in order, before the -v line', async () => {
  await inTree(async (tree) => {
    await expect(stderrOf(tree, ['-vv'])).resolves.toBe(
      lookedFor('.app.json') +
        lookedFor(join(tree.work, '.app.json')) +
        lookedFor(join(tree.home, '.app.json')) +
        lookedFor(join(tree.home, '.config', 'app', 'config.json')) +
        noFile,
    );
    writeFileSync(join(tree.home, '.app.json'), '{"title":"x"}');
    await expect(stderrOf(tree, ['-vv'])).resolves.toBe(
      lookedFor('.app.json') +
        lookedFor(join(tree.work, '.app.json')) +
        read(join(tree.home, '.app.json')),
    );
  });
});

test('-vv names the candidates before the file found in its directory, and none after it', async () => {
  await inTree(async (tree) => {
    writeFileSync(join(tree.project, '.app.json'), '{"title":"x"}');
    const settings: Settings = { file: '.app.{toml,json,yaml}', formats: [toml, yaml] };
    await expect(stderrOf(tree, ['-vv'], { settings })).resolves.toBe(
      lookedFor('.app.toml') + read('.app.json'),
    );
  });
});

test("the variable's missing file is looked for and then no file is found", async () => {
  await inTree(async (tree) => {
    const settings: Settings = { env: 'APP_CONFIG', notice: true };
    await expect(
      stderrOf(tree, ['-vv'], { env: { APP_CONFIG: 'missing.json' }, settings }),
    ).resolves.toBe(lookedFor('missing.json') + noFile);
  });
});

test('the notice replaces the -v line when it prints, and a lookup that looks nowhere writes the line', async () => {
  await inTree(async (tree) => {
    await expect(stderrOf(tree, ['-v'], { settings: { notice: true } })).resolves.toBe(
      'ℹ Found no configuration file. Create .app.json to configure app.\n',
    );
    const nowhere = await (async () => {
      const mock = mockProcess({ argv: ['-v'], cwd: tree.home, env: { HOME: tree.home } });
      await application({ notice: true, scopes: ['project'] }).run({ process: mock });
      return mock.stderr.text;
    })();
    expect(nowhere).toBe(noFile);
  });
});

test('--no-config writes no line, and a broken file writes its warning alone', async () => {
  await inTree(async (tree) => {
    await expect(stderrOf(tree, ['-vv', '--no-config'])).resolves.toBe('');
    writeFileSync(join(tree.work, '.app.json'), '{');
    await expect(stderrOf(tree, ['-vv'])).resolves.toBe(
      `${lookedFor('.app.json')}⚠ Skipped ${join(tree.work, '.app.json')}: the file is not valid JSON at line 1, column 2, so this run reads no configuration. Correct its syntax, or remove it.\n`,
    );
  });
});

test('-v -q writes no line, and -vv -q writes the -v lines alone', async () => {
  await inTree(async (tree) => {
    await expect(stderrOf(tree, ['-v', '-q'])).resolves.toBe('');
    await expect(stderrOf(tree, ['-vv', '-q'])).resolves.toBe(noFile);
  });
});

test('an invocation by name shows the lines in its messages when its values ask for them', async () => {
  await inTree(async (tree) => {
    const handle = mockProcess({ ceiling: tree.home, cwd: tree.project, env: { HOME: tree.home } });
    writeFileSync(join(tree.project, '.app.json'), '{"title":"x"}');
    const app = application();
    await expect(app.invoke([], {}, { process: handle })).resolves.toMatchObject({
      messages: '',
    });
    await expect(
      app.invoke([], { options: { verbose: 1 } }, { process: handle }),
    ).resolves.toMatchObject({
      messages: read('.app.json'),
    });
  });
});

test('a control character in a path is escaped', async () => {
  await inTree(async (tree) => {
    const settings: Settings = { env: 'APP_CONFIG' };
    await expect(
      stderrOf(tree, ['-vv'], { env: { APP_CONFIG: 'bell\u0007.json' }, settings }),
    ).resolves.toBe(lookedFor(String.raw`bell\u0007.json`) + noFile);
  });
});
