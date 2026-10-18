import { nowrap, pad, splitLines, style } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

const link = '\u001B]8;;https://example.com\u001B\\';
const unlink = '\u001B]8;;\u001B\\';
const red = '\u001B[31m';

test('text without a break is one line, unchanged', () => {
  expect(splitLines('one two')).toEqual(['one two']);
  expect(splitLines(style.red('one two'))).toEqual([style.red('one two')]);
  expect(splitLines('')).toEqual(['']);
});

test('a style that spans a break closes on its line and reopens on the next', () => {
  expect(splitLines(style.red('one\ntwo\nthree'))).toEqual([
    style.red('one'),
    style.red('two'),
    style.red('three'),
  ]);
});

test('nested frames reopen in their order, and a frame closed before the break stays closed', () => {
  expect(splitLines(`${style.red(`a ${style.bold('b\nc')} d`)}\ne`)).toEqual([
    style.red(`a ${style.bold('b')}`),
    style.red(`${style.bold('c')} d`),
    'e',
  ]);
});

test('a padding frame and a no-wrap frame close and reopen at a break', () => {
  expect(splitLines(pad('ab\ncd', 4, { align: 'right' }))).toEqual([
    pad('ab', 4, { align: 'right' }),
    pad('cd', 4, { align: 'right' }),
  ]);
  expect(splitLines(nowrap('a b\nc d'))).toEqual([nowrap('a b'), nowrap('c d')]);
});

/** A style frame over a theme token no palette here declares, written as the wire spells it. */
const brand = (body: string) => `["style",[["token","brand"]]]${body}`;

test('a frame whose header names a theme token splits like any style', () => {
  expect(splitLines(brand('a\nb'))).toEqual([brand('a'), brand('b')]);
});

test('a CRLF ends a line as an LF does', () => {
  expect(splitLines('one\r\ntwo')).toEqual(['one', 'two']);
  expect(splitLines(style.red('one\r\ntwo'))).toEqual([style.red('one'), style.red('two')]);
});

test('a trailing line break adds no empty line, as pad adds no padded one, and a blank line inside stays', () => {
  expect(splitLines('one\r\ntwo\n')).toEqual(['one', 'two']);
  expect(splitLines(style.red('one\n'))).toEqual([style.red('one')]);
  expect(splitLines(pad('cat\n', 5))).toEqual([pad('cat', 5)]);
  expect(splitLines('\n')).toEqual(['']);
  expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
  // A padding frame after the last break resolves to spaces, so that line is a line.
  expect(splitLines(`a\n${pad('', 3)}`)).toEqual(['a', pad('', 3)]);
});

test('an escaped delimiter and a glyph frame are text, not frames', () => {
  const glyph = '["glyph","success"]';
  expect(splitLines(`E002 ${glyph}\nnext`)).toEqual([`E002 ${glyph}`, 'next']);
});

test('an embedded SGR attribute is scoped to its line and set again on the next', () => {
  expect(splitLines(`${red}one\ntwo\u001B[39m`)).toEqual([
    style(`${red}one`),
    style(`${red}two\u001B[39m`),
  ]);
  expect(splitLines(style.bold(`${red}a\nb`))).toEqual([
    style(style.bold(`${red}a`)),
    style(style.bold(`${red}b`)),
  ]);
});

test('an SGR attribute set inside a padding frame carries to the next line in its style', () => {
  expect(splitLines(style.bold(`${pad(`${red}a`, 2)} b\nc`))).toEqual([
    style(style.bold(`${pad(`${red}a`, 2)} b`)),
    style(style.bold(`${red}c`)),
  ]);
});

test('an embedded hyperlink closes at the end of its line and opens again on the next', () => {
  expect(splitLines(`${link}one two\nthree${unlink} four`)).toEqual([
    `${link}one two${unlink}`,
    `${link}three${unlink} four`,
  ]);
  // The input leaves the link open past the style's close, so the last line closes it at its end.
  expect(splitLines(style.red(`${link}a\nb`))).toEqual([
    style.red(`${link}a${unlink}`),
    `${style.red(`${link}b`)}${unlink}`,
  ]);
});

test('a line break inside a terminal control string is not a break', () => {
  const title = '\u001B]0;one\ntwo\u0007';
  expect(splitLines(`${title}rest`)).toEqual([`${title}rest`]);
});

test('splitLines rejects a value that is not a string, as pad does', () => {
  // @ts-expect-error The probe passes a number where a string is required.
  expect(() => splitLines(1)).toThrow(new TypeError('Style helpers require a string.'));
});
