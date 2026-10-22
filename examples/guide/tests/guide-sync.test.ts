import { expect, test } from 'vite-plus/test';

import { checkPage, extractRegion, parseFences } from './guide-sync.js';

/** Joins lines into one text that ends in a newline, as a file on disk does. */
function lines(...rows: string[]): string {
  return `${rows.join('\n')}\n`;
}

/** A read function over a fixed set of repository-relative files. */
function readFrom(files: Record<string, string>) {
  return (path: string) => files[path];
}

const source = lines(
  'import { a } from "a";',
  '',
  'export function run() {',
  '  // #region body',
  '    first();',
  '      second();',
  '',
  '    third();',
  '  // #endregion',
  '  // #region other',
  '  skipped();',
  '  // #endregion',
  '}',
);

test('a region is the lines between its marker and the next end marker, dedented together', () => {
  expect(extractRegion(source, 'body')).toBe('first();\n  second();\n\nthird();');
  expect(extractRegion(source, 'other')).toBe('skipped();');
});

test('a region that is absent or never closed is an error that names the region', () => {
  expect(() => extractRegion(source, 'nope')).toThrow('"// #region nope"');
  expect(() => extractRegion('// #region open\nx\n', 'open')).toThrow('"// #endregion"');
});

test('a binding comment on the line above an opening fence binds that fence', () => {
  const markdown = lines(
    '# Title',
    '',
    '<!-- example: ../../examples/guide/src/a.ts#body -->',
    '```ts',
    'first();',
    '```',
    '',
    '<!-- transcript: ../../examples/guide/transcripts/t.txt -->',
    '```console',
    '$ pace',
    '```',
  );
  const { fences, strayBindings } = parseFences(markdown);
  expect(strayBindings).toEqual([]);
  expect(fences).toMatchObject([
    {
      binding: { kind: 'example', path: '../../examples/guide/src/a.ts', region: 'body' },
      body: 'first();',
      language: 'ts',
      line: 4,
    },
    {
      binding: { kind: 'transcript', path: '../../examples/guide/transcripts/t.txt' },
      body: '$ pace',
      language: 'console',
      line: 9,
    },
  ]);
});

test('a binding comment separated from the fence by a blank line binds nothing', () => {
  const { fences, strayBindings } = parseFences(
    lines('<!-- example: a.ts -->', '', '```ts', 'x', '```'),
  );
  expect(fences[0]?.binding).toBeUndefined();
  expect(strayBindings).toMatchObject([{ line: 1 }]);
});

test('a longer fence holds a shorter fence line as body and an unclosed fence is reported', () => {
  const { fences } = parseFences(lines('````ts', '```', '````'));
  expect(fences).toMatchObject([{ body: '```', closed: true }]);
  expect(parseFences(lines('```ts', 'x')).fences).toMatchObject([{ closed: false, line: 1 }]);
});

const files = {
  'examples/guide/src/a.ts': source,
  'examples/guide/transcripts/t.txt': '$ pace\nhello\n',
};

function page(...fenceLines: string[]): string {
  return lines(...fenceLines);
}

function check(markdown: string, extra: Record<string, string> = {}) {
  return checkPage({
    file: 'docs/guide/page.md',
    markdown,
    read: readFrom({ ...files, ...extra }),
  });
}

test('a page whose bound fences match their sources has no problems', () => {
  const result = check(
    page(
      '<!-- example: ../../examples/guide/src/a.ts#body -->',
      '```ts',
      'first();',
      '  second();',
      '',
      'third();',
      '```',
      '<!-- transcript: ../../examples/guide/transcripts/t.txt -->',
      '```console',
      '$ pace',
      'hello',
      '```',
      '```sh',
      'free',
      '```',
    ),
  );
  expect(result.problems).toEqual([]);
});

test('a fence with no region equals the whole file without its trailing newline', () => {
  const whole = lines('a', 'b');
  const matching = check(page('<!-- example: ../../x.ts -->', '```ts', 'a', 'b', '```'), {
    'x.ts': whole,
  });
  expect(matching.problems).toEqual([]);
});

test('a stale fence is reported with file, line, first difference, and the way to fix it', () => {
  const result = check(
    page(
      '<!-- transcript: ../../examples/guide/transcripts/t.txt -->',
      '```console',
      '$ pace',
      'bye',
      '```',
    ),
  );
  expect(result.problems).toHaveLength(1);
  const [problem] = result.problems;
  expect(problem).toMatchObject({ line: 2, stale: true });
  expect(problem?.message).toContain('docs/guide/page.md:2:');
  expect(problem?.message).toContain('examples/guide/transcripts/t.txt');
  expect(problem?.message).toContain('line 2');
  expect(problem?.message).toContain('"hello"');
  expect(problem?.message).toContain('"bye"');
  expect(problem?.message).toContain('UPDATE_GUIDE=1');
  expect(result.updated).toBe(
    page(
      '<!-- transcript: ../../examples/guide/transcripts/t.txt -->',
      '```console',
      '$ pace',
      'hello',
      '```',
    ),
  );
});

test('a ts or console fence with no binding fails and names its line', () => {
  for (const language of ['ts', 'typescript', 'console']) {
    const { problems } = check(page('text', '', `\`\`\`${language}`, 'x', '```'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 3, stale: false });
    expect(problems[0]?.message).toContain('docs/guide/page.md:3:');
    expect(problems[0]?.message).toContain('<!-- ');
  }
});

test('a fence in another language needs no binding', () => {
  expect(check(page('```json', '{}', '```', '```text', 'x', '```')).problems).toEqual([]);
});

test('a binding of the wrong kind, a missing file, a missing region, and a stray comment fail', () => {
  const wrongKind = check(page('<!-- transcript: ../../x.ts -->', '```ts', 'a', '```'), {
    'x.ts': 'a\n',
  });
  expect(wrongKind.problems[0]?.message).toContain('example');
  const missing = check(page('<!-- example: ../../gone.ts -->', '```ts', 'a', '```'));
  expect(missing.problems[0]?.message).toContain('gone.ts');
  expect(missing.problems[0]).toMatchObject({ stale: false });
  const noRegion = check(
    page('<!-- example: ../../examples/guide/src/a.ts#nope -->', '```ts', 'a', '```'),
  );
  expect(noRegion.problems[0]?.message).toContain('#region nope');
  const stray = check(page('<!-- example: ../../x.ts -->', '', 'prose'));
  expect(stray.problems[0]).toMatchObject({ line: 1 });
  expect(stray.problems[0]?.message).toContain('directly above');
});

test('a fence indented under a list item compares and rewrites without its indent', () => {
  const markdown = page(
    '- item',
    '',
    '  <!-- transcript: ../../examples/guide/transcripts/t.txt -->',
    '  ```console',
    '  $ pace',
    '  old',
    '  ```',
  );
  const result = check(markdown);
  expect(result.problems).toMatchObject([{ line: 4, stale: true }]);
  expect(result.updated).toContain('  hello\n');
});
