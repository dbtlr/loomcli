import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { blockCases, inlineCases } from './markdown-cases.js';

/** Runs Markdown through the shipped help view, with an independent expected block. */
function run(details: string, options: Record<string, unknown> = {}) {
  return invoke(new URL('fixtures/markdown-help.mjs', import.meta.url), [
    JSON.stringify({ details, ...options }),
  ]);
}

/** The complete plain page around Details, authored from the contract. */
function page(lines: string[]) {
  return {
    status: 0,
    stderr: '',
    stdout: [
      'app',
      '',
      ...lines,
      ...(lines.length === 0 ? [] : ['']),
      'USAGE',
      '  app [options]',
      '',
      'OPTIONS',
      '  -h, --help      Show this help.',
      "      --manifest  Print this command's manifest as JSON.",
      '',
    ].join('\n'),
  };
}

test('Details renders authored paragraphs, headings, lists, code, and links', () => {
  expect(
    run(
      'Intro.\n\n# Title\n- A **key**: `a.b`.\n- See [format](https://example.org).\n\n```ts\n**literal**\n```',
    ),
  ).toEqual(
    page([
      '  Intro.',
      '',
      '  Title',
      '  - A key: `a.b`.',
      '  - See format (https://example.org).',
      '',
      '    **literal**',
    ]),
  );
});

test.each(blockCases)('built Markdown blocks: %s', (_name, source, lines) => {
  expect(run(source)).toEqual(page(lines));
});

test.each(inlineCases)('built Markdown inline: %s', (_name, source, line) => {
  expect(run(source)).toEqual(page([`  ${line}`]));
});

test('the manifest retains Markdown source bytes including its final terminator', () => {
  expect(run('# Heading\n\n- item\n', { inspect: true })).toEqual({
    status: 0,
    stderr: '',
    stdout: '[{"details":"# Heading\\n\\n- item\\n"}]\n',
  });
});
