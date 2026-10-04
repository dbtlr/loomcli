import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/counted-implied.mjs', import.meta.url);

/** The four value classes, each the name of a root option and of a child declaring every spelling as it. */
const classes = ['boolean', 'count', 'implied', 'separate'] as const;
type ValueClass = (typeof classes)[number];

/** The words that supply the root's own option of one class before a child's name. */
function supplied(kind: ValueClass): string[] {
  return kind === 'separate' ? ['--separate', 'x'] : [`--${kind}`];
}

/** The value a child of class `kind` reads when the root's own option of that class rebinds to it. */
const bound: Record<ValueClass, unknown> = {
  boolean: true,
  count: 1,
  // A rebound bare spelling supplies the implied value of the option it binds.
  implied: 'child',
  separate: 'x',
};

const pairs = classes.flatMap((parent) => classes.map((child) => [parent, child] as const));

test.each(pairs.filter(([parent, child]) => parent === child))(
  "a parent's own %s option rebinds to the %s child's option of the same value class",
  (parent, child) => {
    const result = invoke(fixture, ['rebind', 'run', ...supplied(parent), child, 'a']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const line = result.stdout.split('\n').find((entry) => entry.startsWith('run:')) ?? '';
    expect(JSON.parse(line.slice('run:'.length))).toMatchObject({
      args: { path: 'a' },
      command: [child],
      options: { [parent]: bound[child] },
    });
  },
);

test.each(pairs.filter(([parent, child]) => parent !== child))(
  "a parent's own %s option is misplaced before the %s child, which declares its spelling with another value class",
  (parent, child) => {
    const result = invoke(fixture, ['rebind', 'run', ...supplied(parent), child, 'a']);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({
      commands: [[child]],
      message: `Option "--${parent}" belongs to command "${child}". Supply it after "${child}".`,
      name: 'MisplacedOptionError',
      path: [child],
      spelling: `--${parent}`,
    });
  },
);
