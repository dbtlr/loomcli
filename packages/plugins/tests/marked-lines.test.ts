import { style } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { splitMarkedLines } from '../src/marked-lines.js';

const open = '["style",[["foreground","red"]]]';
const close = '';

test('text without a break is one line, unchanged', () => {
  expect(splitMarkedLines('one two')).toEqual(['one two']);
  expect(splitMarkedLines(`${open}one two${close}`)).toEqual([`${open}one two${close}`]);
});

test('a style that spans a break closes on its line and reopens on the next', () => {
  expect(splitMarkedLines(style.red('one\ntwo\nthree'))).toEqual([
    `${open}one${close}`,
    `${open}two${close}`,
    `${open}three${close}`,
  ]);
});

test('nested frames reopen in their order, and a frame closed before the break stays closed', () => {
  const inner = '["style",[["modifier","bold"]]]';
  expect(splitMarkedLines(`${open}a ${inner}b\nc${close} d${close}\ne`)).toEqual([
    `${open}a ${inner}b${close}${close}`,
    `${open}${inner}c${close} d${close}`,
    'e',
  ]);
});

test('a CRLF ends a line as an LF does, and a trailing break leaves an empty last line', () => {
  expect(splitMarkedLines('one\r\ntwo\n')).toEqual(['one', 'two', '']);
});

test('an escaped delimiter and a glyph frame are text, not frames', () => {
  const glyph = '["glyph","success"]';
  expect(splitMarkedLines(`E002 ${glyph}\nnext`)).toEqual([`E002 ${glyph}`, 'next']);
});
