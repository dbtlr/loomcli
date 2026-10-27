// Acceptance plan: see packages/plugins/tests/service.test.ts.

import { nowrap, style } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { holdsControlCharacter } from '../src/control-character.js';
import { readPrinted } from '../src/service/launchd.js';
import { isLabel } from '../src/service/settings.js';
import { stateOf, statusOf, statusText } from '../src/service/status.js';
import { readShown } from '../src/service/systemd.js';
import { launchdPlist, systemdUnit } from '../src/service/unit.js';

const values = {
  description: 'Notes 100% & <sync>',
  home: '/home/me 50%',
  label: 'com.acme.notes',
  words: ['/bin/notes', String.raw`a\b`, 'say "hi"', '$HOME', '%h', "it's <b>&"],
};

test(
  String.raw`systemd wraps each ExecStart word in quotes, escapes \, ", and $, and doubles % in every value`,
  () => {
    const unit = systemdUnit(values);
    expect(unit.split('\n')[1]).toBe('Description=Notes 100%% & <sync>');
    expect(unit).toContain(
      `${String.raw`ExecStart="/bin/notes" "a\\b" "say \"hi\"" "$$HOME" "%%h" "it's <b>&"`}\n`,
    );
    expect(unit).toContain('\nWorkingDirectory=/home/me 50%%\n');
    expect(unit.endsWith('WantedBy=default.target\n')).toBe(true);
    expect(unit.endsWith('\n\n')).toBe(false);
  },
);

test('a property list escapes &, <, >, ", and \' as XML entities in every value', () => {
  const plist = launchdPlist({ ...values, label: 'com.acme.notes' });
  expect(plist).toContain('    <string>a\\b</string>\n');
  expect(plist).toContain('    <string>say &quot;hi&quot;</string>\n');
  expect(plist).toContain('    <string>it&apos;s &lt;b&gt;&amp;</string>\n');
  expect(plist).toContain('    <string>%h</string>\n');
  expect(plist).toContain('  <string>/home/me 50%</string>\n');
  expect(plist.endsWith('</plist>\n')).toBe(true);
});

test.each([
  ['com.acme.notes', true],
  ['a.b', true],
  ['A1.b-2.c--d', true],
  ['notes', false],
  ['.com.acme', false],
  ['com..acme', false],
  ['com.acme.', false],
  ['com.-acme', false],
  ['com.acme_notes', false],
  ['com.acmé', false],
  [`a.${'b'.repeat(245)}`, true],
  [`a.${'b'.repeat(246)}`, false],
])('the label %s is %s under the grammar', (label, valid) => {
  expect(isLabel(label)).toBe(valid);
});

test.each([
  ['\u0000', true],
  ['\u001f', true],
  ['\u007f', true],
  ['\u009f', true],
  [String.fromCodePoint(0xa0), false],
  [String.fromCodePoint(0x20_28), false],
  [' plain ', false],
])('the control character test reads %j as %s', (text, holds) => {
  expect(holdsControlCharacter(`a${text}b`)).toBe(holds);
});

test.each([
  ['ActiveState=active\nMainPID=4120\n', true, { pid: 4120, running: true, state: 'active' }],
  ['ActiveState=active\nMainPID=0\n', true, { running: false, state: 'active' }],
  ['MainPID=12\nActiveState=activating\n', true, { pid: 12, running: false, state: 'activating' }],
  ['ActiveState=inactive\nMainPID=0\n', false, { running: false, state: 'not installed' }],
  ['ActiveState=inactive\nMainPID=0\n', true, { running: false, state: 'inactive' }],
  ['ActiveState=failed\nMainPID=0\n', false, { running: false, state: 'failed' }],
  ['ActiveState=active\nMainPID=31\n', false, { pid: 31, running: true, state: 'active' }],
])('systemctl show %j reads its state', (stdout, installed, reading) => {
  expect(readShown(stdout, installed)).toEqual(reading);
});

test.each([
  [
    'gui/501/com.acme.notes = {\n\tactive count = 1\n\tstate = running\n\tpid = 4120\n}\n',
    { pid: 4120, running: true, state: 'running' },
  ],
  [
    'gui/501/com.acme.notes = {\n\tstate = not running\n\tendpoints = {\n\t\tpid = 5\n\t\tstate = running\n\t}\n}\n',
    { running: false, state: 'not running' },
  ],
  [
    'gui/501/com.acme.notes = {\n\tstate = waiting\n\tpid = 77\n}\n',
    { pid: 77, running: true, state: 'waiting' },
  ],
  ['gui/501/com.acme.notes = {\n\tpid = 7a\n}\n', { running: false, state: 'unknown' }],
])('launchctl print reads its top level one tab in: %j', (stdout, reading) => {
  expect(readPrinted(stdout)).toEqual(reading);
});

test('the text view keeps the unit path whole for line breaking', () => {
  const unit = '/Users/me/Library/Application Support/com.acme.notes.plist';
  const state = stateOf(
    { installed: true, label: 'com.acme.notes', unit },
    { notes: [], running: false, state: 'not running' },
  );
  expect(statusText(statusOf(state, []), style)).toBe(
    `com.acme.notes: not running\n  unit  ${nowrap(unit)}\n`,
  );
});

test('the text view pads the names to the longest plus two, prints author rows as given, and escapes manager words and paths', () => {
  const state = stateOf(
    { installed: true, label: 'com.acme.notes', unit: '/units/a\nb.service' },
    { notes: ['A note.'], pid: 9, running: true, state: 'active' },
  );
  const status = statusOf(state, [{ name: 'connections', value: '3' }]);
  expect(statusText(status, style)).toBe(
    `com.acme.notes: running (pid 9)\n  unit         ${nowrap(String.raw`/units/a\u000ab.service`)}\n  connections  3\n  note         A note.\n`,
  );
  const unknown = statusOf(
    stateOf(
      { installed: false, label: 'com.acme.notes', unit: '/u' },
      { notes: [], running: false, state: 'odd\u001bword' },
    ),
    [],
  );
  expect(statusText(unknown, style)).toBe(
    `com.acme.notes: odd\\u001bword\n  unit  ${nowrap('/u')}\n`,
  );
  expect(
    statusText(
      statusOf(
        stateOf(
          { installed: true, label: 'com.acme.notes', unit: '/u' },
          { notes: [], running: true, state: 'running' },
        ),
        [],
      ),
      style,
    ),
  ).toBe(`com.acme.notes: running\n  unit  ${nowrap('/u')}\n`);
});

test('the status members keep the order the type lists them, with no pid when none is reported', () => {
  const withPid = statusOf(
    stateOf(
      { installed: true, label: 'l.m', unit: '/u' },
      { notes: [], pid: 1, running: true, state: 'active' },
    ),
    [],
  );
  expect(Object.keys(withPid)).toEqual([
    'label',
    'unit',
    'installed',
    'running',
    'state',
    'pid',
    'notes',
    'details',
  ]);
  const withoutPid = statusOf(
    stateOf(
      { installed: true, label: 'l.m', unit: '/u' },
      { notes: [], running: false, state: 'failed' },
    ),
    [],
  );
  expect(Object.keys(withoutPid)).not.toContain('pid');
});
