import { Application, Command, locate } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { answer } from '../src/completion/answer.js';
import { help } from '../src/help/plugin.js';
import { manifestDocument } from '../src/manifest/document.js';
import { manPages } from '../src/manpage/page.js';
import { service } from '../src/service/plugin.js';

test.each([false, true])(
  'help, man pages, and manifest project passthrough mode %s',
  async (enabled) => {
    const declaration = new Application('copy', { plugins: [help()] })
      .argument('src', { required: true, variadic: true })
      .argument('dest', { required: true });
    const app = (
      enabled ? declaration.passthrough({ description: 'Words for the tool.' }) : declaration
    ).action(() => undefined);
    const result = await app.invoke([], { options: { help: true } }, { process: mockProcess() });
    if (result.status !== 'completed') {
      throw new Error('Help did not complete.');
    }
    expect(result.output).toContain(
      `copy <src...> <dest> [options]${enabled ? ' [-- <args>...]' : ''}`,
    );
    expect(result.output.includes('-- <args>...')).toBe(enabled);
    expect(result.output.includes('Words for the tool.')).toBe(enabled);
    const graph = app.inspect();
    expect(manifestDocument(graph, graph.root).command.passthrough).toEqual(
      enabled ? { description: 'Words for the tool.' } : null,
    );
    const text = manPages(graph)[0]?.text ?? '';
    expect(text.includes('Words for the tool.')).toBe(enabled);
    expect(text).toContain(String.raw`\fBcopy\fR <src...> <dest> [options]`);
    expect(text.includes(String.raw`[\-\- <args>...]`)).toBe(enabled);
    expect(text.includes(String.raw`\-\- \fIargs\fR...`)).toBe(enabled);
  },
);

test.each([false, true])('a Command with no arguments projects mode %s', async (enabled) => {
  const declaration = new Application('forward', { plugins: [help()] });
  const app = (enabled ? declaration.passthrough() : declaration).action(() => undefined);
  const graph = app.inspect();
  expect(manifestDocument(graph, graph.root).command.passthrough).toEqual(
    enabled ? { description: null } : null,
  );
  const result = await app.invoke([], { options: { help: true } }, { process: mockProcess() });
  if (result.status !== 'completed') {
    throw new Error('Help did not complete.');
  }
  expect(result.output.includes('ARGUMENTS\n  -- <args>...')).toBe(enabled);
  expect(manPages(graph)[0]?.text.includes('.SH "ARGUMENTS"')).toBe(enabled);
});

test('completion after -- offers argument values on a Command without passthrough', () => {
  const graph = new Application('choose')
    .argument('name', { validate: z.enum(['alpha', 'beta']) })
    .action(() => undefined)
    .inspect();
  expect(answer(graph, locate(graph, ['--', 'a']))).toBe('alpha\n:4\n');
});

test.each([
  [['convert', '--', '-in.txt'], true],
  [['convert', '--', '-in.txt', 'extra'], false],
  [['forward', '--', '-in.txt', 'extra'], true],
])('service judges every run word in %j', (run, valid) => {
  const app = new Application('tool', { plugins: [service({ label: 'com.acme.tool', run })] })
    .command(new Command('convert').argument('file', {}).action(() => undefined))
    .command(new Command('forward').passthrough().action(() => undefined));
  expect(app.check().length === 0).toBe(valid);
});
