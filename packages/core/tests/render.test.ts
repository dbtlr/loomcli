import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function render(scenario: string) {
  return invoke(new URL('fixtures/render.mjs', import.meta.url), [scenario]);
}

const internal = 'render: Something went wrong.\n';

test('a rendered value writes the view text to stdout', () => {
  expect(render('bytes')).toEqual({
    status: 0,
    stderr: '',
    stdout: '6  one.txt\n2  two words.txt\nresolved:0\n',
  });
});

test('the view owns every byte, so core adds no newline of its own', () => {
  expect(render('exact')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'one.txt two words.txtresolved:0\n',
  });
});

test('a rendered value and a plain message keep the order the action issued them', () => {
  expect(render('order')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'before\n6  one.txt\n2  two words.txt\nafter\nresolved:0\n',
  });
});

test('a failing view the action never awaited writes nothing for its call and fails the run', () => {
  expect(render('unawaited')).toEqual({
    status: 1,
    stderr: internal,
    stdout: 'after\nresolved:1\n',
  });
});

test('an action that awaits and catches a view rejection decides the outcome', () => {
  expect(render('caught')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'caught:Cannot render the table.\nafter\nresolved:0\n',
  });
});

test('a render failure raised after the action returned still ends the invocation', () => {
  expect(render('late')).toEqual({
    status: 1,
    stderr: internal,
    stdout: 'late\nresolved:1\n',
  });
});

test('an action failure stays primary over a view failure', () => {
  expect(render('action-failure')).toEqual({
    status: 1,
    stderr: 'render: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
});
