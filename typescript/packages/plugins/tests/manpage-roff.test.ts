// Acceptance plan: see packages/plugins/tests/manpage.test.ts.

import { expect, test } from 'vite-plus/test';

import {
  escapeText,
  escapeUnbroken,
  inFont,
  request,
  textLine,
  writeRuns,
} from '../src/manpage/roff.js';

/** A character by its code point, so the test source stays ASCII. */
const char = (point: number) => String.fromCodePoint(point);

test('the backslash, the hyphen, the quote characters, the caret, and the tilde are escaped', () => {
  expect(escapeText('a\\b-c\'d`e^f~g"h')).toBe(String.raw`a\eb\-c\(aqd\(gae\(haf\(tig\(dqh`);
  expect(escapeText(String.raw`\fB`)).toBe(String.raw`\efB`);
});

test('a tab is a space in filled text and kept in no-fill text', () => {
  expect(escapeText('a\tb')).toBe('a b');
  expect(escapeText('a\tb', 'noFill')).toBe('a\tb');
});

test('unbroken text escapes each space, a tab included, so man never wraps inside it', () => {
  expect(escapeUnbroken('" a\tb"')).toBe(String.raw`\(dq\ a\ b\(dq`);
});

test('a control character and a line separator show as their escape, its backslash escaped', () => {
  expect(escapeText(`a${char(0x1b)}b`)).toBe(String.raw`a\eu001bb`);
  expect(escapeText(`${char(0x7f)}${char(0x85)}${char(0x9f)}`)).toBe(
    String.raw`\eu007f\eu0085\eu009f`,
  );
  expect(escapeText(`${char(0x20_28)}${char(0x20_29)}`)).toBe(String.raw`\eu2028\eu2029`);
  expect(escapeText(`a${char(0)}b\nc`, 'noFill')).toBe(String.raw`a\eu0000b\eu000ac`);
});

test('every other character above ASCII is written as its code point in uppercase hexadecimal', () => {
  expect(escapeText(`caf${char(0xe9)} ${char(0x20_14)} ${char(0x4e_2d)}`)).toBe(
    String.raw`caf\[u00E9] \[u2014] \[u4E2D]`,
  );
  expect(escapeText(char(0x1_f6_00))).toBe(String.raw`\[u1F600]`);
  expect(escapeText(`${char(0x20_2e)}${char(0x20_0f)}${char(0xa0)}`)).toBe(
    String.raw`\[u202E]\[u200F]\[u00A0]`,
  );
});

test('a text line that would start with a period starts with the zero-width escape', () => {
  expect(textLine('.TH not a request')).toBe(String.raw`\&.TH not a request`);
  expect(textLine('plain. text')).toBe('plain. text');
});

test('a run in a font opens with its escape and returns to the regular font', () => {
  expect(inFont('a-b', 'bold')).toBe(String.raw`\fBa\-b\fR`);
  expect(inFont('path', 'italic')).toBe(String.raw`\fIpath\fR`);
  expect(inFont('both', 'boldItalic')).toBe(String.raw`\f(BIboth\fR`);
  expect(inFont('plain', 'regular')).toBe('plain');
  expect(inFont('', 'bold')).toBe('');
});

test('runs in one font join before they are written, so a font opens once', () => {
  expect(
    writeRuns([
      { font: 'bold', text: 'a' },
      { font: 'bold', text: 'b' },
      { font: 'regular', text: ' and ' },
      { font: 'italic', text: 'c' },
      { font: 'italic', text: '' },
    ]),
  ).toBe(String.raw`\fBab\fR and \fIc\fR`);
});

test('a request writes each argument in double quotes, escaped', () => {
  expect(request('SH', ['NAME'])).toBe('.SH "NAME"');
  expect(request('SS', ['SAY "HI"'])).toBe(String.raw`.SS "SAY \(dqHI\(dq"`);
  expect(request('TH', ['JSONKIT-GET', '1', '', 'jsonkit 0.0.0', ''])).toBe(
    String.raw`.TH "JSONKIT\-GET" "1" "" "jsonkit 0.0.0" ""`,
  );
});
