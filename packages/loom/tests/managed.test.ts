import { expect, test } from 'vite-plus/test';

import { driftWarning, hasDrifted, readManaged, renderManaged } from '../src/helpers/managed.js';

/** The SHA-256 of `hello\n`, a known value independent of the code under test. */
const hello = '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03';

/** The SHA-256 of `---\nname: x\n---\nhello\n`, computed apart from the code under test. */
const skill = '75045c8bb85dac831b034c8f7d9905cc5e188004e8938fad92dfb2b320705527';

test('the header on the first line records the checksum of the rest of the file', () => {
  const file = readManaged(`<!-- Managed by loom init. sha256:${hello} -->\nhello\n`);
  expect(file).toEqual({ checksum: hello, content: 'hello\n' });
  expect(file && hasDrifted(file)).toBe(false);
});

test('a header after frontmatter keeps the frontmatter in the content', () => {
  const file = readManaged(
    `---\nname: x\n---\n<!-- Managed by loom init. sha256:${skill} -->\nhello\n`,
  );
  expect(file).toEqual({ checksum: skill, content: '---\nname: x\n---\nhello\n' });
  expect(file && hasDrifted(file)).toBe(false);
});

test('a header line ending in CRLF is removed with its whole line ending', () => {
  const file = readManaged(`<!-- Managed by loom init. sha256:${hello} -->\r\nhello\n`);
  expect(file?.content).toBe('hello\n');
});

test('a file checked out with CRLF line endings has not drifted', () => {
  const file = readManaged(`<!-- Managed by loom init. sha256:${hello} -->\r\nhello\r\n`);
  expect(file && hasDrifted(file)).toBe(false);
});

test('an edited file has drifted', () => {
  const file = readManaged(`<!-- Managed by loom init. sha256:${hello} -->\nhello, edited\n`);
  expect(file && hasDrifted(file)).toBe(true);
});

test.each([
  ['no header', 'hello\n'],
  ['a header below the first line', `hello\n<!-- Managed by loom init. sha256:${hello} -->\n`],
  ['a header with a short checksum', '<!-- Managed by loom init. sha256:abc -->\nhello\n'],
  [
    'a header after a blank first line',
    `\n<!-- Managed by loom init. sha256:${hello} -->\nhello\n`,
  ],
])('a file with %s is not managed', (_case, text) => {
  expect(readManaged(text)).toBeUndefined();
});

test('rendering puts the header on the first line with the checksum of the content', () => {
  expect(renderManaged('hello\n')).toBe(`<!-- Managed by loom init. sha256:${hello} -->\nhello\n`);
});

test('rendering content with frontmatter puts the header on the first line after it', () => {
  expect(renderManaged('---\nname: x\n---\nhello\n')).toBe(
    `---\nname: x\n---\n<!-- Managed by loom init. sha256:${skill} -->\nhello\n`,
  );
});

test.each([
  ['no frontmatter', '\n# Change fragments\n\nName each fragment.\n'],
  ['frontmatter', '---\nname: loom-changelog\n---\n\n# Keep the changelog\n'],
])(
  'content with %s reads back exactly from its rendering and has not drifted',
  (_case, content) => {
    const file = readManaged(renderManaged(content));
    expect(file?.content).toBe(content);
    expect(file && hasDrifted(file)).toBe(false);
  },
);

test('the drift warning names the file and both ways out', () => {
  expect(driftWarning('.changes/README.md')).toBe(
    'warning: .changes/README.md differs from what loom init wrote. Run loom init --force to restore it, or delete its header to keep your edits.',
  );
});
