import assert from 'node:assert/strict';

import { style } from '@loomcli/core';

const rgbHelpers = [
  (options) => style.hex('#7A8F7B', options),
  (options) => style.rgb(122, 143, 123, options),
  (options) => style.bgHex('#7A8F7B', options),
  (options) => style.bgRgb(122, 143, 123, options),
];
const indexedHelpers = [
  (options) => style.ansi256(108, options),
  (options) => style.bgAnsi256(108, options),
];
for (const helper of [...rgbHelpers, ...indexedHelpers]) {
  for (const options of [
    null,
    0,
    'green',
    [],
    new Date(),
    new Map(),
    { unknown: undefined },
    { [Symbol('unknown')]: 1 },
    { ansi16: null },
    { ansi16: 'bgGreen' },
    { ansi16: 2 },
  ]) {
    assert.throws(() => helper(options), TypeError);
  }
  for (const options of [undefined, {}, { ansi16: undefined }, Object.create(null)]) {
    assert.equal(helper(options)('X'), helper()('X'));
  }
  const options = { ansi16: 'green' };
  const chain = helper(options);
  const before = chain('X');
  options.ansi16 = 'red';
  assert.equal(chain('X'), before);
}
for (const helper of rgbHelpers) {
  for (const ansi256 of [-1, 256, 1.5, NaN, Infinity, '108', null]) {
    assert.throws(() => helper({ ansi256 }), RangeError);
  }
  assert.equal(helper({ ansi16: undefined, ansi256: undefined })('X'), helper()('X'));
  const options = { ansi16: 'green', ansi256: 108 };
  const chain = helper(options);
  options.ansi256 = 0;
  options.ansi16 = 'red';
  assert.match(chain('X'), /"ansi256":108/u);
  assert.match(chain('X'), /"ansi16":"green"/u);
}
for (const helper of indexedHelpers) {
  for (const ansi256 of [108, undefined]) {
    assert.throws(() => helper({ ansi256 }), TypeError);
  }
}
assert.throws(() => ['#7A8F7B'].map(style.hex), TypeError);
assert.throws(() => [108].map(style.ansi256), TypeError);
assert.equal(['#7A8F7B'].map((value) => style.hex(value))[0]('X'), style.hex('#7A8F7B')('X'));
console.log('validated and copied');
