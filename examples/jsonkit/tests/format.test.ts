import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { main, withDocuments } from './documents.js';

/** A document with one member of every kind the walk reports, in the order it walks them. */
const walked = '{"name":"loom","tags":["a","b"],"ok":true}';

/** The entries the walk of `walked` yields, root first, in the order `paths` prints them. */
const entries = [
  { kind: 'object with 3 keys', path: '.' },
  { kind: 'string', path: 'name' },
  { kind: 'array with 2 items', path: 'tags' },
  { kind: 'string', path: 'tags.0' },
  { kind: 'string', path: 'tags.1' },
  { kind: 'boolean', path: 'ok' },
];

test('jsonkit paths --format jsonl prints one line per Entry', () => {
  withDocuments({ 'doc.json': walked }, (cwd) => {
    const result = invoke(main, ['paths', '--format', 'jsonl', '-f', 'doc.json'], { cwd });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  });
});

test('jsonkit paths --format ndjson prints the same bytes as jsonl, the unadvertised alias', () => {
  withDocuments({ 'doc.json': walked }, (cwd) => {
    const named = invoke(main, ['paths', '--format', 'jsonl', '-f', 'doc.json'], { cwd });
    const aliased = invoke(main, ['paths', '--format', 'ndjson', '-f', 'doc.json'], { cwd });
    expect(aliased).toEqual(named);
  });
});

test('jsonkit paths --format json prints one indented array', () => {
  withDocuments({ 'doc.json': walked }, (cwd) => {
    const result = invoke(main, ['paths', '--format', 'json', '-f', 'doc.json'], { cwd });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${JSON.stringify(entries, null, 2)}\n`);
  });
});

test('jsonkit get --format json is the unknown-option error, get declares no result', () => {
  withDocuments({ 'doc.json': walked }, (cwd) => {
    const result = invoke(main, ['get', '--format', 'json', 'user.name', '-f', 'doc.json'], {
      cwd,
    });
    expect(result).toEqual({
      status: 2,
      stderr:
        'Invalid input: Unknown option "--format". Supply a declared option; prefix a hyphenated path with "./".\n',
      stdout: '',
    });
  });
});

test('jsonkit paths --format yaml --help still prints the help page, help installed after format', () => {
  withDocuments({ 'doc.json': walked }, (cwd) => {
    const withHelp = invoke(main, ['paths', '--help'], { cwd });
    const result = invoke(main, ['paths', '--format', 'yaml', '--help'], { cwd });
    expect(result).toEqual({ status: 0, stderr: '', stdout: withHelp.stdout });
  });
});

test('jsonkit inspect reports the root has no result and paths gains the formatter views', () => {
  const inspected = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(inspected.status).toBe(0);
  const graph: { root: { result: unknown; children: { name: string; result: unknown }[] } } =
    JSON.parse(inspected.stdout);
  expect(graph.root.result).toBeNull();
  const found = graph.root.children.find((child) => child.name === 'paths');
  expect(found?.result).toEqual({
    default: 'list',
    kind: 'rows',
    views: ['list', 'table', 'json', 'jsonl'],
  });
});
