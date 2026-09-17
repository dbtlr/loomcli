import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { main, withDocuments } from './documents.js';

/** A document with one member of every kind the walk reports, in the order it walks them. */
const walked = '{"name":"loom","tags":["a","b"],"ok":true}';

/** A document whose second key the walk refuses, so the sequence stops with rows already written. */
const refused = '{"name":"loom","boom":{"deep":1}}';

/** The incomplete-result line core writes before the fault's own report. */
function incomplete(yielded: number, written: number) {
  return `Output is incomplete: Command "paths" stopped after ${String(yielded)} rows, ${String(written)} written.\n`;
}

test('jsonkit paths writes one row per path as the walk yields it, the root first', () => {
  withDocuments({ 'doc.json': walked }, (cwd) => {
    expect(invoke(main, ['paths', '-f', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: [
        'kind  object with 3 keys',
        'path  .',
        '',
        'kind  string',
        'path  name',
        '',
        'kind  array with 2 items',
        'path  tags',
        '',
        'kind  string',
        'path  tags.0',
        '',
        'kind  string',
        'path  tags.1',
        '',
        'kind  boolean',
        'path  ok',
        '',
        '6 records',
        '',
      ].join('\n'),
    });
  });
});

test('a walk that throws leaves its written rows behind, under the line and the report', () => {
  withDocuments({ 'doc.json': refused }, (cwd) => {
    expect(invoke(main, ['paths', '-f', 'doc.json'], { cwd })).toEqual({
      status: 1,
      stderr: `${incomplete(2, 2)}Cannot walk boom\n`,
      stdout: 'kind  object with 2 keys\npath  .\n\nkind  string\npath  name\n',
    });
  });
});

test('the declared result names both views and the formatter appends its own, the row view first', () => {
  const inspected = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(inspected.status).toBe(0);
  const graph: { root: { children: { name: string; result: unknown }[] } } = JSON.parse(
    inspected.stdout,
  );
  const found = graph.root.children.find((child) => child.name === 'paths');
  expect(found?.result).toEqual({
    default: 'list',
    kind: 'rows',
    views: ['list', 'table', 'json', 'jsonl'],
  });
});

test('the hidden Command stays off the help page and out of the candidate list', () => {
  withDocuments({ 'doc.json': walked }, (cwd) => {
    expect(invoke(main, ['--help'], { cwd }).stdout).not.toContain('paths');
    expect(invoke(main, ['typo', '-f', 'doc.json'], { cwd })).toEqual({
      status: 2,
      stderr: 'jsonkit: unknown command "typo"; try get, keys, select, fetch.\n',
      stdout: '',
    });
  });
});
