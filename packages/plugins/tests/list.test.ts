import { expect, test } from 'vite-plus/test';

import { lines } from './fit-render.js';
import { render } from './pack-render.js';

const services = [
  { name: 'api-gateway' },
  { name: 'billing', parts: [{ name: 'invoices' }, { name: 'refunds' }] },
  { name: 'search' },
];

test.each([40, null])(
  'list() prints bullets with nested items at their parent text column, at %s columns',
  (width) => {
    const config = { children: true, format: 'name' };
    expect(render({ config, data: services, view: 'list', widths: [width] })).toBe(
      lines('● api-gateway', '● billing', '  ● invoices', '  ● refunds', '● search'),
    );
  },
);

test('list() renders as the default view of a declared rows result', () => {
  expect(render({ data: ['one', 'two'], declared: true, view: 'list', widths: [40] })).toBe(
    lines('● one', '● two'),
  );
});

test('an ordered list right-aligns its markers from 9. to 10.', () => {
  const data = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const output = render({ config: { ordered: true }, data, view: 'list', widths: [40] });
  expect(output).toBe(
    lines(' 1. a', ' 2. b', ' 3. c', ' 4. d', ' 5. e', ' 6. f', ' 7. g', ' 8. h', ' 9. i', '10. j'),
  );
});

test('two levels of children start at their parent text column, and a nested ordered list counts from 1', () => {
  const data = [
    ...['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'].map((name) => ({ name })),
    { name: 's10', parts: [{ name: 'a' }, { name: 'b', parts: [{ name: 'c' }] }] },
  ];
  const config = { children: true, format: 'name', ordered: true };
  const output = render({ config, data, view: 'list', widths: [40] }).split('\n');
  expect(output.slice(8)).toEqual([' 9. s9', '10. s10', '    1. a', '    2. b', '       1. c', '']);
});

test.each([40, null])(
  'null and undefined items print their marker alone, at %s columns',
  (width) => {
    const data = [null, 'x', '@@undefined@@'];
    expect(render({ data, view: 'list', widths: [width] })).toBe(lines('●', '● x', '●'));
    expect(render({ config: { ordered: true }, data, view: 'list', widths: [width] })).toBe(
      lines('1.', '2. x', '3.'),
    );
  },
);

test('a default item is escaped while a format item is the author marked text', () => {
  const marker = '["style",[["foreground","red"]]]data';
  expect(render({ data: [marker], view: 'list', widths: [null] })).toBe(lines(`● ${marker}`));
  expect(render({ config: { format: 'raw' }, data: [marker], view: 'list', widths: [null] })).toBe(
    lines('● data'),
  );
});

test('format receives each item index among its siblings', () => {
  const config = { children: true, format: 'index' };
  expect(render({ config, data: services, view: 'list', widths: [40] })).toBe(
    lines('● 0:api-gateway', '● 1:billing', '  ● 0:invoices', '  ● 1:refunds', '● 2:search'),
  );
});

test('a wrapped item hangs under its text at 30 columns', () => {
  const data = ['refunds, whose retry policy lands with this deploy'];
  expect(render({ data, view: 'list', widths: [30] })).toBe(
    lines('● refunds, whose retry policy', '  lands with this deploy'),
  );
});

test('a nested item wraps at the columns left after its own text column', () => {
  const data = [{ name: 'billing', parts: [{ name: 'refunds, whose retry policy lands' }] }];
  const config = { children: true, format: 'name', ordered: true };
  expect(render({ config, data, view: 'list', widths: [24] })).toBe(
    lines('1. billing', '   1. refunds, whose', '      retry policy lands'),
  );
});

test('an authored line break hangs under its text when piped', () => {
  expect(render({ data: ['first line\nsecond line'], view: 'list', widths: [null] })).toBe(
    lines('● first line', '  second line'),
  );
});

test.each([30, null])('a blank line inside an item carries no indent, at %s columns', (width) => {
  expect(render({ data: ['above\n\nbelow'], view: 'list', widths: [width] })).toBe(
    lines('● above', '', '  below'),
  );
});

test('a tab in an item expands on a terminal and is kept when piped', () => {
  expect(render({ data: ['a\tb'], view: 'list', widths: [30, null] })).toBe(
    lines('● a       b', '--', '● a\tb'),
  );
});

test('an empty sequence prints nothing, on a terminal and piped', () => {
  expect(render({ data: [], view: 'list', widths: [30, null] })).toBe(lines('--'));
});
