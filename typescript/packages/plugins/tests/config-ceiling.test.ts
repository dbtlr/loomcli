/*
 * Acceptance plan for the ceiling a process handle names (docs/plugins/config.md#lookup, ADR-0153).
 *
 * Each case builds a temporary tree, `root/.app.json` above `root/packages/cli`, and runs a small
 * application with the configuration plugin on a handle whose `cwd` is inside that tree. A walk
 * that climbs puts the parent's title in the run's output, so the title is the proof of what the
 * walk looked in. The tree is under the temporary directory and every case removes it.
 *
 * - A mock names its `cwd` as its ceiling, so a file in a parent of `cwd` is never read, with the
 *   `cwd` inside the mock's home and outside it.
 * - A file in the `cwd` itself is read.
 * - A mock given a higher `ceiling` reads the parent's file, and a file above the ceiling stays unread.
 * - A start directory the directory option names outside the ceiling is looked in alone: a
 *   sibling of the `cwd` reads its own file and never the common ancestor's, and a directory below
 *   the sibling reads neither the sibling's file nor the ancestor's, and the notice names its own.
 * - A start directory that is an ancestor of the ceiling, as `--project ..` names, looks nowhere,
 *   and the notice names the home file.
 * - An action's `invoke` carries its run's ceiling, so the invoked Command reads no file above the
 *   mock's `cwd`, and a mock with a higher ceiling reads it.
 * - A handle with no ceiling, as the real process's, walks to the filesystem root as before.
 * - A `cwd` function with no `ceiling` is called twice per run, and one that throws on its second call
 *   fails the run with the working directory failure.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { Application, Command, processHandle } from '@loomcli/core';
import type { ProcessFields } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** A temporary tree: `top`, `root` inside it, and `cli` two levels below `root`. */
interface Tree {
  readonly cli: string;
  readonly root: string;
  readonly top: string;
}

/** Writes a configuration file whose title names the directory it sits in. */
function titled(directory: string, title: string) {
  writeFileSync(join(directory, '.app.json'), JSON.stringify({ title }));
}

/** Runs a case in a fresh tree under the temporary directory and removes the tree after. */
async function inTree(body: (tree: Tree) => Promise<void> | void) {
  const top = mkdtempSync(join(tmpdir(), 'loom-ceiling-'));
  try {
    const root = join(top, 'root');
    const cli = join(root, 'packages', 'cli');
    mkdirSync(cli, { recursive: true });
    await body({ cli, root, top });
  } finally {
    rmSync(top, { force: true, recursive: true });
  }
}

/** The application: one option that the file's `title` answers, printed by the action. */
function application() {
  const { plugin } = configuration({ schema: z.looseObject({}) });
  return new Application('app', { plugins: [plugin] })
    .option('title', {
      description: 'The title.',
      extensions: [configInput({ path: 'title' })],
      type: 'string',
    })
    .action(({ options, out }) => out.print(`title:${options.title ?? 'none'}`));
}

/** The title a run on a mock read. */
async function titleOn(mock: ReturnType<typeof mockProcess>) {
  await application().run({ process: mock });
  return mock.stdout.text.trim();
}

/** The title a run on a real process handle read, with the handle's stdout collected. */
async function titleOnReal(fields: ProcessFields) {
  const chunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  await application().run({ process: processHandle({ ...fields, env: {}, stdout }) });
  return Buffer.concat(chunks).toString('utf8').trim();
}

/**
 * The application with a directory option, `--project`, and the notice on, so a run that finds no
 * file names the file it should create.
 */
function projectApplication() {
  const { plugin } = configuration({
    directory: { name: 'project' },
    notice: true,
    schema: z.looseObject({}),
  });
  return new Application('app', { plugins: [plugin] })
    .option('title', {
      description: 'The title.',
      extensions: [configInput({ path: 'title' })],
      type: 'string',
    })
    .action(({ options, out }) => out.print(`title:${options.title ?? 'none'}`));
}

/** The notice line a run that finds no file writes, as `out.info` prints it. */
function notice(file: string): string {
  return `ℹ Found no configuration file. Create ${file} to configure app.\n`;
}

/** The title and the stderr of a run of the project application on a mock. */
async function projectRun(mock: ReturnType<typeof mockProcess>) {
  await projectApplication().run({ process: mock });
  return { stderr: mock.stderr.text, title: mock.stdout.text.trim() };
}

/**
 * The application whose `outer` action invokes its sibling `show`, which prints the title the file
 * answers, and prints what the call captured.
 */
function invokingApplication() {
  const { plugin } = configuration({ schema: z.looseObject({}) });
  const show = new Command('show', { description: 'Print the title.' })
    .option('title', {
      description: 'The title.',
      extensions: [configInput({ path: 'title' })],
      type: 'string',
    })
    .action(({ options, out }) => out.print(`title:${options.title ?? 'none'}`));
  const outer = new Command('outer', { description: 'Invoke show.' }).action(
    async ({ invoke, out }) => {
      const outcome = await invoke(['show'], {});
      await out.print(outcome.status === 'completed' ? outcome.output.trim() : outcome.status);
    },
  );
  return new Application('app', { plugins: [plugin] }).command(show).command(outer);
}

test('a mock reads no file above its cwd, with the cwd inside its home', () =>
  inTree(async ({ cli, root }) => {
    titled(join(root, 'packages'), 'parent');
    const mock = mockProcess({ cwd: cli, env: {}, home: root });
    await expect(titleOn(mock)).resolves.toBe('title:none');
    expect(mock.ceiling).toBe(cli);
  }));

test('a mock reads no file above its cwd, with the cwd outside its home', () =>
  inTree(async ({ cli, root, top }) => {
    titled(root, 'parent');
    titled(top, 'grandparent');
    const mock = mockProcess({ cwd: cli, env: {}, home: join(top, 'home') });
    await expect(titleOn(mock)).resolves.toBe('title:none');
  }));

test('a mock reads the file in its cwd', () =>
  inTree(async ({ cli, root }) => {
    titled(root, 'parent');
    titled(cli, 'here');
    await expect(titleOn(mockProcess({ cwd: cli, env: {} }))).resolves.toBe('title:here');
  }));

test('a named ceiling reads the parent file and nothing above it', () =>
  inTree(async ({ cli, root, top }) => {
    titled(top, 'above');
    const mock = () => mockProcess({ ceiling: root, cwd: cli, env: {}, home: join(top, 'home') });
    await expect(titleOn(mock())).resolves.toBe('title:none');
    titled(root, 'parent');
    await expect(titleOn(mock())).resolves.toBe('title:parent');
    expect(mock().ceiling).toBe(root);
  }));

test('a start directory outside the ceiling is looked in alone', () =>
  inTree(async ({ cli, root, top }) => {
    const ancestor = join(root, 'packages');
    const sibling = join(ancestor, 'other');
    const deep = join(sibling, 'deep');
    mkdirSync(deep, { recursive: true });
    titled(ancestor, 'ancestor');
    titled(sibling, 'sibling');
    const mock = (project: string) =>
      mockProcess({ argv: ['--project', project], cwd: cli, env: {}, home: join(top, 'home') });
    await expect(projectRun(mock(sibling))).resolves.toEqual({
      stderr: '',
      title: 'title:sibling',
    });
    await expect(projectRun(mock(deep))).resolves.toEqual({
      stderr: notice(join(deep, '.app.json')),
      title: 'title:none',
    });
  }));

test('a start directory that is an ancestor of the ceiling looks nowhere', () =>
  inTree(async ({ cli, root, top }) => {
    const home = join(top, 'home');
    titled(join(root, 'packages'), 'ancestor');
    const mock = mockProcess({ argv: ['--project', '..'], cwd: cli, env: {}, home });
    await expect(projectRun(mock)).resolves.toEqual({
      stderr: notice(join(home, '.app.json')),
      title: 'title:none',
    });
  }));

test("an action's invoke reads no file above the mock's cwd, and a higher ceiling reads it", () =>
  inTree(async ({ cli, root, top }) => {
    titled(root, 'parent');
    const home = join(top, 'home');
    const sealed = mockProcess({ argv: ['outer'], cwd: cli, env: {}, home });
    await invokingApplication().run({ process: sealed });
    expect(sealed.stdout.text.trim()).toBe('title:none');
    const raised = mockProcess({ argv: ['outer'], ceiling: root, cwd: cli, env: {}, home });
    await invokingApplication().run({ process: raised });
    expect(raised.stdout.text.trim()).toBe('title:parent');
  }));

test('a handle with no ceiling walks to the filesystem root as before', () =>
  inTree(async ({ cli, root }) => {
    titled(root, 'parent');
    const home = join(root, 'no-home');
    expect(processHandle({ cwd: cli, home }).ceiling).toBeUndefined();
    expect('ceiling' in processHandle({ cwd: cli, home })).toBe(false);
    await expect(titleOnReal({ cwd: cli, home })).resolves.toBe('title:parent');
    await expect(titleOn(mockProcess({ ceiling: '/', cwd: cli, env: {} }))).resolves.toBe(
      'title:parent',
    );
  }));

test('a real handle that names a ceiling stops the walk there', () =>
  inTree(async ({ cli, root }) => {
    titled(root, 'parent');
    const home = join(root, 'no-home');
    await expect(titleOnReal({ ceiling: cli, cwd: cli, home })).resolves.toBe('title:none');
    await expect(titleOnReal({ ceiling: root, cwd: cli, home })).resolves.toBe('title:parent');
  }));

test('a cwd function with no ceiling answers the ceiling too, and a throw on that call fails the run', () =>
  inTree(async ({ cli, root }) => {
    titled(root, 'parent');
    let calls = 0;
    const counted = mockProcess({
      cwd: () => {
        calls += 1;
        return cli;
      },
      env: {},
    });
    await expect(titleOn(counted)).resolves.toBe('title:none');
    expect(calls).toBe(2);
    let reads = 0;
    const failing = mockProcess({
      cwd: () => {
        reads += 1;
        if (reads > 1) {
          throw new Error('gone');
        }
        return cli;
      },
      env: {},
    });
    await expect(application().run({ process: failing })).resolves.toBe(1);
    expect(failing.stderr.text).toContain('working directory cannot be read');
  }));
