// Acceptance plan: see packages/prompts/tests/interactive.test.ts.

import { Application, override } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { select } from '../src/index.js';
import { questionFrame } from '../src/views.js';
import { observing } from './support.js';

/**
 * A mock whose stderr is a terminal of `columns` and `rows`. A width of `'unreported'` is a
 * terminal that reports none, which the mock states as 0. COLUMNS, when given, is the run's own.
 */
function terminal(columns: number | 'unreported', rows: number, keys: string[], variable?: string) {
  return mockProcess({
    env: variable === undefined ? {} : { COLUMNS: variable },
    terminal: { columns: columns === 'unreported' ? 0 : columns, keys, rows, streams: ['stderr'] },
  });
}

/** A select over ten choices, `choice-3` its default, asked beside a redraw that counts its rows. */
async function flow(columns: number, rows: number, message: string) {
  const mock = terminal(columns, rows, ['\r']);
  let advanced = 0;
  let answer: unknown = undefined;
  const app = new Application('viewport', { description: 'Render a bounded select frame.' }).action(
    async (context) => {
      const { out } = context;
      answer = await select(
        {
          ...context,
          out: observing(out, async ({ again, view }) => {
            if (view === questionFrame) {
              // The rows the frame moves down, counted by drawing it once more and erasing that copy.
              const count = await again(out);
              advanced = Math.max(advanced, count);
              await out.draw(`\r\u001b[${count}A\u001b[J`, { render: (value) => value });
            }
          }),
        },
        {
          choices: Array.from({ length: 10 }, (_value, index) => `choice-${index}`),
          default: 'choice-3',
          message,
        },
      );
    },
  );
  const code = await app.run({ process: mock });
  return { advanced, answer, code };
}

test.each([
  [80, 5],
  [8, 10],
  [40, 5],
  [8, 5],
  [80, 3],
  [80, 1],
])(
  'the default select frame fits %i columns and %i rows including its cursor row',
  async (columns, rows) => {
    const result = await flow(columns, rows, 'Which database should store this workspace’s tasks?');
    expect(result).toMatchObject({ answer: 'choice-3', code: 0 });
    expect(result.advanced).toBeLessThan(rows);
  },
);

/** The lines of the last frame a one-shot select draw wrote, with terminal controls removed. */
function frameLines(drawn: string): string[] {
  // oxlint-disable-next-line no-control-regex
  const text = drawn.replaceAll(/\u001B\[[0-9;?]*[A-Za-z]/gu, '');
  return text.replaceAll('\r', '').split('\n');
}

const longMessage =
  'Which database should store this workspace’s tasks, now and for every project in the future?';

/** The compact frame clips its title to the width the view context reads. */
async function titleWidth(columns: number | 'unreported', variable?: string): Promise<number> {
  const mock = terminal(columns, 3, [], variable);
  const app = new Application('viewport', { description: 'Render a bounded select frame.' }).action(
    ({ out }) =>
      out.draw(
        {
          above: 3,
          below: 2,
          choices: ['choice-3', 'choice-4', 'choice-5', 'choice-6', 'choice-7'],
          highlighted: 0,
          issue: undefined,
          kind: 'select',
          message: longMessage,
          rows: 3,
        },
        questionFrame,
      ),
  );
  await expect(app.run({ process: mock })).resolves.toBe(0);
  return (frameLines(mock.stderr.text)[0] ?? '').length;
}

test('the compact select frame clips at the context columns, narrowed by COLUMNS', async () => {
  await expect(titleWidth(100)).resolves.toBe(`? ${longMessage}`.length);
  await expect(titleWidth(100, '60')).resolves.toBeLessThanOrEqual(60);
  await expect(titleWidth(100, '60')).resolves.toBeGreaterThan(40);
});

test('the compact select frame clips at 80 columns when the terminal reports none', async () => {
  const width = await titleWidth('unreported');
  expect(width).toBeLessThanOrEqual(80);
  expect(width).toBeGreaterThan(60);
});

/**
 * A select over ten choices whose stderr height is read live. The plan gives the rows of the first
 * frame and, for each frame after it, the rows to set and the key to press. The keys are typed with
 * Enter after the last, and each frame's hook sets the rows its step names before the next is
 * drawn. Without a plan, the window shrinks from 30 rows to 6 before the second frame and grows
 * to 30 again before the third, with Down pressed before each.
 */
async function resized(plan: { rows: number; steps: { key: 'down' | 'up'; rows?: number }[] }) {
  const keys = { down: '\u001B[B', up: '\u001B[A' };
  const mock = mockProcess({
    terminal: {
      columns: 80,
      keys: [`${plan.steps.map((step) => keys[step.key]).join('')}\r`],
      rows: plan.rows,
      streams: ['stderr'],
    },
  });
  const shown: { above: number; choices: number; rows: number | undefined }[] = [];
  const steps = [...plan.steps];
  const app = new Application('resize', {
    description: 'Ask a select across resizes.',
    views: [
      override(questionFrame, {
        render: (data, context) => {
          if (data.kind === 'select') {
            shown.push({ above: data.above, choices: data.choices.length, rows: data.rows });
          }
          return questionFrame.render(data, context);
        },
      }),
    ],
  }).action(async (context) => {
    await select(
      {
        ...context,
        out: observing(context.out, ({ view }) => {
          const next = view === questionFrame ? steps.shift() : undefined;
          if (next?.rows !== undefined) {
            mock.resize(80, next.rows);
          }
        }),
      },
      {
        choices: Array.from({ length: 10 }, (_value, index) => `choice-${index}`),
        message: 'Backend',
      },
    );
  });
  const code = await app.run({ process: mock });
  return { code, shown };
}

test('the select window reads the rows at each frame, so its count follows a resize', async () => {
  await expect(
    resized({
      rows: 30,
      steps: [
        { key: 'down', rows: 6 },
        { key: 'down', rows: 30 },
      ],
    }),
  ).resolves.toEqual({
    code: 0,
    shown: [
      { above: 0, choices: 7, rows: 30 },
      { above: 0, choices: 2, rows: 6 },
      { above: 0, choices: 7, rows: 30 },
    ],
  });
});

/*
 * At most seven choices show, fewer when stderr has fewer rows. At 6 rows the window shows two, so
 * eight presses of Down scroll it to the ninth choice with seven above. When the window grows to
 * 30 rows and Up moves to the eighth choice, seven choices fit again, and the window holds the last
 * seven, three above them and none below, rather than the three it scrolled to.
 */
test('a window that grows after scrolling shows as many choices as fit, ending at the last', async () => {
  const steps = [
    ...Array.from({ length: 8 }, () => ({ key: 'down' as const })),
    { key: 'up' as const, rows: 30 },
  ];
  const { code, shown } = await resized({ rows: 6, steps });
  expect(code).toBe(0);
  expect(shown.at(-2)).toEqual({ above: 7, choices: 2, rows: 6 });
  expect(shown.at(-1)).toEqual({ above: 3, choices: 7, rows: 30 });
});
