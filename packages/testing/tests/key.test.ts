import { key } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

test('the readonly key table publishes terminal encodings', () => {
  expect(Object.isFrozen(key)).toBe(true);
  expect(key).toMatchObject({
    backspace: '\u007f',
    delete: '\u001b[3~',
    down: '\u001b[B',
    end: '\u001b[F',
    enter: '\r',
    escape: '\u001b',
    home: '\u001b[H',
    left: '\u001b[D',
    right: '\u001b[C',
    space: ' ',
    tab: '\t',
    up: '\u001b[A',
  });
  expect(key.ctrl('a')).toBe('\u0001');
  expect(key.ctrl('z')).toBe('\u001a');
  expect(key.alt('b')).toBe('\u001bb');
});
