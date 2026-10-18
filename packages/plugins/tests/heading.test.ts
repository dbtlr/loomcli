import { expect, test } from 'vite-plus/test';

import { lines } from './fit-render.js';
import { render } from './pack-render.js';

const line = '─';

test.each([40, null])(
  'a level 1 heading is underlined as wide as its text, at %s columns',
  (width) => {
    expect(render({ data: 'Deployment summary', view: 'heading', widths: [width] })).toBe(
      lines('Deployment summary', line.repeat(18)),
    );
  },
);

test.each([40, null])('a level 2 heading is its text alone, at %s columns', (width) => {
  expect(render({ config: { level: 2 }, data: 'Services', view: 'heading', widths: [width] })).toBe(
    lines('Services'),
  );
});

test('heading() renders as the default view of a declared string result', () => {
  expect(render({ data: 'Services', declared: true, view: 'heading', widths: [40] })).toBe(
    lines('Services', line.repeat(8)),
  );
});

test('a level 1 underline is as wide as a CJK text and as a styled text', () => {
  expect(render({ data: '猫の手', view: 'heading', widths: [40] })).toBe(
    lines('猫の手', line.repeat(6)),
  );
  const styled = '["style",[["foreground","red"]]]data';
  expect(render({ data: styled, view: 'heading', widths: [40] })).toBe(
    lines('data', line.repeat(4)),
  );
});

test('a wrapped level 1 underline matches its widest wrapped line', () => {
  const data = 'Quarterly deployment summary for staging';
  expect(render({ data, view: 'heading', widths: [20] })).toBe(
    lines('Quarterly deployment', 'summary for staging', line.repeat(20)),
  );
  expect(render({ data, view: 'heading', widths: [null] })).toBe(lines(data, line.repeat(40)));
});

test('a word wider than columns keeps its line and widens the underline', () => {
  expect(render({ data: 'Configuration overview', view: 'heading', widths: [10] })).toBe(
    lines('Configuration', 'overview', line.repeat(13)),
  );
});

test('a heading that ends in a line break gains no empty line, and the empty string prints nothing', () => {
  expect(render({ data: 'Services\n', view: 'heading', widths: [40, null] })).toBe(
    lines('Services', line.repeat(8), '--', 'Services', line.repeat(8)),
  );
  expect(render({ data: '', view: 'heading', widths: [40, null] })).toBe(lines('--'));
});

test.each(['@@red-empty@@', '@@nowrap-empty@@'])(
  'a heading over %s, which resolves to no character, prints nothing',
  (data) => {
    expect(render({ data, view: 'heading', widths: [30, null] })).toBe(lines('--'));
  },
);

test('a heading styles its text and underline dim and keeps its author styling', () => {
  const data = 'Hi ["style",[["foreground","red"]]]there';
  const rendering = { color: 'always', modifiers: 'always' } as const;
  expect(render({ data, rendering, theme: true, view: 'heading', widths: [40] })).toBe(
    '\u001B[90mHi \u001B[31mthere\u001B[39m\n\u001B[90m────────\u001B[39m\n',
  );
});
