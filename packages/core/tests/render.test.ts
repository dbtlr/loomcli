import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function render(scenario: string) {
  return invoke(new URL('fixtures/render.mjs', import.meta.url), [scenario]);
}

const internal = 'Internal error: Rendering output failed: Cannot render the table.\n';

test('a rendered value writes the renderer text to stdout', () => {
  expect(render('bytes')).toEqual({
    status: 0,
    stderr: '',
    stdout: '6  one.txt\n2  two words.txt\nresolved:0\n',
  });
});

test('the renderer owns every byte, so core adds no newline of its own', () => {
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

test('a failing renderer writes nothing for its call and lets later output through', () => {
  expect(render('unawaited')).toEqual({
    status: 1,
    stderr: internal,
    stdout: 'after\nresolved:1\n',
  });
});

test('a failing renderer rejects its own call and still ends the invocation', () => {
  expect(render('caught')).toEqual({
    status: 1,
    stderr: internal,
    stdout: 'caught:Cannot render the table.\nafter\nresolved:1\n',
  });
});

test('a renderer that returns a non-string fails the call with a stated reason', () => {
  const reason = 'The renderer returned number instead of a string.';
  expect(render('non-string')).toEqual({
    status: 1,
    stderr: `Internal error: Rendering output failed: ${reason}\n`,
    stdout: `caught:${reason}\nresolved:1\n`,
  });
});

test('two failing renderers report the first failure once', () => {
  expect(render('twice')).toEqual({
    status: 1,
    stderr: internal,
    stdout: 'after\nresolved:1\n',
  });
});

test('an action failure stays primary over a renderer failure', () => {
  expect(render('action-failure')).toEqual({
    status: 1,
    stderr: 'Internal error: The action failed.\n',
    stdout: 'resolved:1\n',
  });
});
