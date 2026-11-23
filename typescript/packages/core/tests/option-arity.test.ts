/*
 * Acceptance plan for option value arity (docs/core/options.md#option-value-arity, ADR-0161).
 *
 * Every case runs an Application in process on a mock process.
 *
 * - Words. Each occurrence takes exactly the declared count of separate words after its spelling,
 *   through a long spelling, a short letter, and a letter that ends a short group, and `-5` and `-`
 *   are plain words it can take. A multiple option collects one tuple per occurrence.
 * - Attached. A value after `=` or the rest of a short letter's word is the unexpected value.
 * - Too few. The end of the line, a bare `--`, or an option word before the count is met is the
 *   missing value, which names the count, and at an option word that word's spelling alone. The
 *   words the occurrence took supply nothing, and the word that ended it reads as it would have.
 * - Repeat. A repeated scalar occurrence still takes its words.
 * - Routing. A parent's own arity option reads its words before routing goes on, and rebinds only to
 *   a child's option of the same arity, which keeps the parent's fault.
 * - Declaration. An arity that is not a whole number of 2 or more fails at the declaring call.
 */
import {
  Application,
  Command,
  extension,
  locate,
  MissingValueError,
  missingInputError,
  plugin,
  UnexpectedValueError,
  validationContext,
} from '@loomcli/core';
import type { InvocationValues, StandardSchemaV1 } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** A validator that reads one word as an integer, or reports `Use an integer.` */
const integer: StandardSchemaV1<string, number> = {
  '~standard': {
    validate: (value) =>
      typeof value === 'string' && /^-?\d+$/u.test(value)
        ? { value: Number(value) }
        : { issues: [{ message: 'Use an integer.' }] },
    vendor: 'probe',
    version: 1,
  },
};

/** The options each action run read, in run order. */
const seen: unknown[] = [];

/** One run of an application on a mock process: its status, its stderr, and what the action read. */
async function run(
  application: { run: (options: { process: ReturnType<typeof mockProcess> }) => Promise<number> },
  argv: string[],
  env: Record<string, string> = {},
): Promise<{ seen: unknown[]; status: number; stderr: string }> {
  seen.length = 0;
  const mock = mockProcess({ argv, env });
  const status = await application.run({ process: mock });
  return { seen: [...seen], status, stderr: mock.stderr.text };
}

/** An application whose root reads a point, a rename pair, and a few flags. */
function drawing() {
  return new Application('app')
    .option('point', { arity: 2, short: 'p', type: 'string', validate: integer })
    .option('rename', { arity: 2, type: 'string' })
    .option('verbose', { short: 'v', type: 'boolean' })
    .option('old', { short: 'o', type: 'string' })
    .argument('rest', { variadic: true })
    .action(({ args, options }) => {
      seen.push({ point: options.point, rename: options.rename, rest: args.rest });
    });
}

test('an occurrence takes the declared count of separate words after its spelling', async () => {
  await expect(run(drawing(), ['--point', '3', '4', 'tail'])).resolves.toEqual({
    seen: [{ point: [3, 4], rename: undefined, rest: ['tail'] }],
    status: 0,
    stderr: '',
  });
  await expect(run(drawing(), ['-p', '-5', '6'])).resolves.toMatchObject({
    seen: [{ point: [-5, 6] }],
  });
  await expect(run(drawing(), ['--rename', '-', '-5'])).resolves.toMatchObject({
    seen: [{ rename: ['-', '-5'] }],
  });
});

test('a letter that ends a short group with nothing attached takes the next words', async () => {
  const application = new Application('app')
    .option('point', { arity: 2, short: 'p', type: 'string' })
    .option('verbose', { short: 'v', type: 'boolean' })
    .action(({ options }) => {
      seen.push(options);
    });
  await expect(run(application, ['-vp', '3', '4'])).resolves.toEqual({
    seen: [{ point: ['3', '4'], verbose: true }],
    status: 0,
    stderr: '',
  });
});

test('a multiple arity option collects one tuple per occurrence, and an omitted one reads []', async () => {
  const application = new Application('app')
    .option('point', { arity: 2, multiple: true, type: 'string', validate: integer })
    .action(({ options }) => {
      seen.push(options.point);
    });
  await expect(run(application, ['--point', '1', '2', '--point', '3', '4'])).resolves.toEqual({
    seen: [
      [
        [1, 2],
        [3, 4],
      ],
    ],
    status: 0,
    stderr: '',
  });
  await expect(run(application, [])).resolves.toMatchObject({ seen: [[]] });
});

const attached =
  'app: Option "--point" takes its values as separate words. Supply each one after "--point" as its own word.\n';

test('a value attached after = or to a short letter is the unexpected value', async () => {
  await expect(run(drawing(), ['--point=3', '4'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr: attached,
  });
  await expect(run(drawing(), ['-p3', '4'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr: attached.replaceAll('--point', '-p'),
  });
  await expect(run(drawing(), ['-vp=3', '4'])).resolves.toMatchObject({
    stderr: attached.replaceAll('--point', '-p'),
  });
});

test('too few words at the end of the line or at a bare -- names the count and what it received', async () => {
  await expect(run(drawing(), ['--point', '3'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr:
      'app: Option "--point" requires 2 values and received 1. Supply 2 values after "--point".\n',
  });
  await expect(run(drawing(), ['--rename', '--', 'a', 'b'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr:
      'app: Option "--rename" requires 2 values and received 0. Supply 2 values after "--rename".\n',
  });
});

const refused = (word: string) =>
  `app: Option "--rename" requires 2 values, and "${word}" reads as an option. Supply 2 values after "--rename"; a value that reads as an option cannot be one of them.\n`;

test('an option word before the count is met names that word by its spelling alone', async () => {
  await expect(run(drawing(), ['--rename', 'a', '--old'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr: refused('--old'),
  });
  await expect(run(drawing(), ['--rename', 'a', '--token=s3cret'])).resolves.toMatchObject({
    stderr: refused('--token'),
  });
  await expect(run(drawing(), ['--rename', 'a', '-old'])).resolves.toMatchObject({
    stderr: refused('-o'),
  });
});

test('MissingValueError carries the count, null for an option without one', () => {
  const short = new MissingValueError('--point', 'separate', { arity: 2, received: 1 });
  expect({ arity: short.arity, message: short.message, spelling: short.spelling }).toEqual({
    arity: 2,
    message: 'Option "--point" requires 2 values and received 1. Supply 2 values after "--point".',
    spelling: '--point',
  });
  const ended = new MissingValueError('--rename', 'separate', {
    arity: 3,
    received: 1,
    refused: '-o',
  });
  expect(ended.message).toBe(
    'Option "--rename" requires 3 values, and "-o" reads as an option. Supply 3 values after "--rename"; a value that reads as an option cannot be one of them.',
  );
  expect(new MissingValueError('--name').arity).toBeNull();
});

test('UnexpectedValueError of kind arity names the separate words', () => {
  expect(new UnexpectedValueError('--point', '3', 'arity').message).toBe(
    'Option "--point" takes its values as separate words. Supply each one after "--point" as its own word.',
  );
});

/**
 * A root group whose own `--size` takes two words, a global `--origin` that takes two, and children
 * that declare `--size` variously.
 */
function group() {
  return new Application('app')
    .globalOption('origin', { arity: 2, type: 'string' })
    .option('size', { arity: 2, type: 'string' })
    .option('verbose', { type: 'boolean' })
    .command(
      new Command('pair').option('size', { arity: 2, type: 'string' }).action(({ options }) => {
        seen.push({ pair: options.size });
      }),
    )
    .command(
      new Command('single').option('size', { type: 'string' }).action(({ options }) => {
        seen.push({ single: options.size });
      }),
    )
    .command(
      new Command('triple').option('size', { arity: 3, type: 'string' }).action(({ options }) => {
        seen.push({ triple: options.size });
      }),
    );
}

test("routing reads a parent's own arity option with its words and rebinds it to the same arity", async () => {
  await expect(run(group(), ['--size', '800', '600', 'pair'])).resolves.toEqual({
    seen: [{ pair: ['800', '600'] }],
    status: 0,
    stderr: '',
  });
});

test("a parent's own arity option before a child's option of another arity is misplaced", async () => {
  for (const name of ['single', 'triple']) {
    await expect(run(group(), ['--size', '800', '600', name])).resolves.toEqual({
      seen: [],
      status: 2,
      stderr: `app: Option "--size" belongs to command "${name}". Supply it after "${name}".\n`,
    });
  }
});

test('an occurrence rebound to the same arity keeps the fault the parent found', async () => {
  await expect(run(group(), ['--size=8', 'pair'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr:
      'app: Option "--size" takes its values as separate words. Supply each one after "--size" as its own word.\n',
  });
});

test('a short occurrence under routing still takes the words it read, so routing goes on', async () => {
  await expect(run(group(), ['--size', '800', '--verbose', 'pair'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr:
      'app: Option "--size" requires 2 values, and "--verbose" reads as an option. Supply 2 values after "--size"; a value that reads as an option cannot be one of them.\n',
  });
});

test('a repeated occurrence still takes the words its count names, so routing goes on', async () => {
  // A global option binds where routing reads it, so its second occurrence is the repeat there.
  // Had the repeat taken no words, routing would read "3" as an unknown Command.
  const words = ['--origin', '1', '2', '--origin', '3', '4', 'pair'];
  await expect(run(group(), words)).resolves.toEqual({
    seen: [],
    status: 2,
    stderr: 'app: Option "--origin" can be supplied only once. Remove the repeated option.\n',
  });
  await expect(run(group(), ['--size', '1', '2', '--size', '3', '4', 'pair'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr: 'app: Option "--size" can be supplied only once. Remove the repeated option.\n',
  });
});

test('an arity that is not a whole number of 2 or more fails at the declaring call', () => {
  for (const arity of [1, 0, 1.5, -2]) {
    expect(() => new Command('c').option('point', { arity, type: 'string' })).toThrow(
      `Option "point" declares arity ${String(arity)}.`,
    );
  }
  expect(() => new Application('app').globalOption('point', { arity: 1, type: 'string' })).toThrow(
    '@loomcli/core/option-arity',
  );
});

/** An application whose root reads a scalar `resize` and a multiple `point`, each word an integer. */
function shapes() {
  return new Application('app')
    .option('resize', { arity: 2, type: 'string', validate: integer })
    .option('point', { arity: 2, multiple: true, type: 'string', validate: integer })
    .action(({ options }) => {
      seen.push(options);
    });
}

test('the validator reads each word, and an issue names the word, after its occurrence', async () => {
  await expect(run(shapes(), ['--resize', '800', 'x'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr: 'app: Option "--resize" at 1: Use an integer.\n',
  });
  await expect(
    run(shapes(), ['--point', '1', '2', '--point', '3', '4', '--point', 'x', 'y']),
  ).resolves.toEqual({
    seen: [],
    status: 2,
    stderr:
      'app: Option "--point" at 2.0: Use an integer.\napp: Option "--point" at 2.1: Use an integer.\n',
  });
});

test('a validator receives one word per call and reads the raw tuples in the supplied record', async () => {
  const calls: unknown[] = [];
  const recording: StandardSchemaV1<string, string> = {
    '~standard': {
      validate: (value, options) => {
        const context = validationContext(options);
        calls.push([value, context?.phase === 'invocation' ? context.supplied.options : undefined]);
        return { value: String(value) };
      },
      vendor: 'probe',
      version: 1,
    },
  };
  const application = new Application('app')
    .option('point', { arity: 2, multiple: true, type: 'string', validate: recording })
    .action(() => {});
  await run(application, ['--point', '1', '2', '--point', '3', '4']);
  const supplied = {
    point: [
      ['1', '2'],
      ['3', '4'],
    ],
  };
  expect(calls).toEqual([
    ['1', supplied],
    ['2', supplied],
    ['3', supplied],
    ['4', supplied],
  ]);
});

test("a global arity option's words appear in the supplied record under a child", async () => {
  const supplied: unknown[] = [];
  const recording: StandardSchemaV1<string, string> = {
    '~standard': {
      validate: (value, options) => {
        const context = validationContext(options);
        if (context?.phase === 'invocation') {
          supplied.push(context.supplied.options.gp);
        }
        return { value: String(value) };
      },
      vendor: 'probe',
      version: 1,
    },
  };
  const application = new Application('app')
    .globalOption('gp', { arity: 2, type: 'string', validate: recording })
    .command(new Command('child').action(() => {}));
  await run(application, ['--gp', '1', '2', 'child']);
  expect(supplied).toEqual([
    ['1', '2'],
    ['1', '2'],
  ]);
});

test("a default's words pass the validator, and a supplied occurrence replaces the default", async () => {
  const application = new Application('app')
    .option('size', { arity: 2, default: ['800', '600'], type: 'string', validate: integer })
    .option('pair', { arity: 2, default: [['a', 'b']], multiple: true, type: 'string' })
    .action(({ options }) => {
      seen.push(structuredClone(options));
      // The action owns its value, so a write here never reaches the next run.
      options.pair[0]?.push('written');
    });
  await expect(run(application, [])).resolves.toMatchObject({
    seen: [{ pair: [['a', 'b']], size: [800, 600] }],
  });
  await expect(run(application, ['--size', '1', '2'])).resolves.toMatchObject({
    seen: [{ pair: [['a', 'b']], size: [1, 2] }],
  });
  const rejected = await run(
    new Application('app')
      .option('size', { arity: 2, default: ['800', 'x'], type: 'string', validate: integer })
      .action(() => {}),
    [],
  );
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).toContain('Option "size" at 1: Use an integer.');
});

test('a required arity option names its count in the fix clause', async () => {
  const required = new Application('app')
    .option('point', { arity: 2, required: true, type: 'string' })
    .action(() => {});
  await expect(run(required, [])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr: 'app: Option "--point" is required. Supply 2 values.\n',
  });
  const collected = new Application('app')
    .option('point', { arity: 2, multiple: true, required: true, type: 'string' })
    .action(() => {});
  await expect(run(collected, [])).resolves.toMatchObject({
    stderr: 'app: Option "--point" is required. Supply at least one set of 2 values.\n',
  });
});

test('missingInputError names the count in its fix clause too', async () => {
  const messages: string[] = [];
  const application = new Application('app')
    .option('point', { arity: 2, required: 'non-interactive', type: 'string' })
    .option('points', { arity: 3, multiple: true, type: 'string' })
    .action((context) => {
      messages.push(missingInputError(context, 'point').message);
      messages.push(missingInputError(context, 'points').message);
    });
  await run(application, ['--point', '1', '2']);
  expect(messages).toEqual([
    'Option "--point" is required when input is not interactive. Supply 2 values.',
    'Option "--points" is required when input is not interactive. Supply at least one set of 3 values.',
  ]);
});

test('withdrawing a losing exclusive-group member clears its tuple', async () => {
  const application = new Application('app')
    .option('size', { arity: 2, env: 'BOX_SIZE', envDelimiter: 'x', type: 'string' })
    .option('preset', { type: 'string' })
    .exclusive('size', 'preset')
    .action(({ options }) => {
      seen.push({ preset: options.preset, size: options.size });
    });
  await expect(run(application, ['--preset', 'a'], { BOX_SIZE: '1x2' })).resolves.toEqual({
    seen: [{ preset: 'a', size: undefined }],
    status: 0,
    stderr: '',
  });
});

/** An application whose `size` binds a variable its delimiter splits into the two words. */
function sized() {
  return new Application('app')
    .option('size', {
      arity: 2,
      default: ['1', '1'],
      env: ['BOX_SIZE', 'OLD_SIZE'],
      envDelimiter: 'x',
      type: 'string',
    })
    .action(({ options }) => {
      seen.push(options.size);
    });
}

test('a variable splits at its delimiter into exactly the declared count of words', async () => {
  await expect(run(sized(), [], { BOX_SIZE: '800x600' })).resolves.toEqual({
    seen: [['800', '600']],
    status: 0,
    stderr: '',
  });
  await expect(run(sized(), [], { BOX_SIZE: 'x' })).resolves.toMatchObject({
    seen: [['', '']],
  });
  await expect(run(sized(), ['--size', '3', '4'], { BOX_SIZE: '800x600' })).resolves.toMatchObject({
    seen: [['3', '4']],
  });
});

test('a variable of another count is the invalid value, and an empty one is unset', async () => {
  for (const value of ['800', '800x600x1', ' 800 x 600 x']) {
    await expect(run(sized(), [], { BOX_SIZE: value })).resolves.toEqual({
      seen: [],
      status: 2,
      stderr: 'app: Option "--size" (from BOX_SIZE): Use 2 values separated by "x".\n',
    });
  }
  await expect(run(sized(), [], { BOX_SIZE: '', OLD_SIZE: '5x6' })).resolves.toMatchObject({
    seen: [['5', '6']],
  });
  await expect(run(sized(), [], { BOX_SIZE: '' })).resolves.toMatchObject({ seen: [['1', '1']] });
});

const sourceKey = extension('@fixture/source/key', { schema: z.string(), target: 'option' });

/** The values a fixture source answers, by option name, a shape core may reject included. */
type Answers = Record<string, readonly string[] | readonly (readonly string[])[]>;

/** A configuration source that answers each option it is asked for with the value `answers` holds. */
function answering(answers: Answers) {
  return plugin('@fixture/source', {
    extensions: [sourceKey],
    source: {
      binding: sourceKey,
      load: () =>
        Promise.resolve({
          default: async ({ requests }) =>
            Object.fromEntries(
              requests.map(({ name }) => [
                name,
                { label: 'the fixture', value: answers[name] ?? [] },
              ]),
            ),
        }),
    },
  });
}

/** An application whose arity options a configuration source answers. */
function configured(answers: Answers) {
  return new Application('app', { plugins: [answering(answers)] })
    .option('size', {
      arity: 2,
      extensions: [sourceKey('size')],
      type: 'string',
      validate: integer,
    })
    .option('point', {
      arity: 2,
      extensions: [sourceKey('point')],
      multiple: true,
      type: 'string',
    })
    .action(({ options }) => {
      seen.push(options);
    });
}

test('a source answers a tuple, or a list of tuples on a multiple option, as one fill', async () => {
  await expect(run(configured({ point: [['1', '2']], size: ['800', '600'] }), [])).resolves.toEqual(
    {
      seen: [{ point: [['1', '2']], size: [800, 600] }],
      status: 0,
      stderr: '',
    },
  );
});

test('a source answer of another shape or length is the source-answers defect', async () => {
  const short = await run(configured({ point: [], size: ['800'] }), []);
  expect(short.status).toBe(1);
  expect(short.stderr).toContain(
    'Plugin "@fixture/source" answered option "size" with a value that is not an array of 2 strings.',
  );
  const flat = await run(configured({ point: ['1', '2'], size: ['1', '2'] }), []);
  expect(flat.stderr).toContain(
    'Plugin "@fixture/source" answered option "point" with a value that is not an array of arrays, each of 2 strings.',
  );
});

test('a source answer whose word the validator rejects drops the whole answer', async () => {
  await expect(run(configured({ point: [], size: ['800', 'x'] }), [])).resolves.toMatchObject({
    seen: [{ point: [], size: undefined }],
    status: 0,
  });
});

/** The values one call by name gave the action, or the failure's messages. */
async function byName(values: NonNullable<InvocationValues['options']>): Promise<unknown> {
  const application = new Application('app')
    .option('size', { arity: 2, type: 'string', validate: integer })
    .option('point', { arity: 2, multiple: true, type: 'string' })
    .action(async ({ options, out }) => {
      await out.print(JSON.stringify(options));
    });
  const outcome = await application.invoke([], { options: values }, { process: mockProcess({}) });
  if (outcome.status === 'cancelled') {
    return outcome.status;
  }
  return outcome.status === 'failed' ? outcome.messages : JSON.parse(outcome.output);
}

test('invoke lowers a tuple to one occurrence, and a list of tuples to one each', async () => {
  await expect(
    byName({
      point: [
        [1, 2],
        ['--', '-x'],
      ],
      size: [800, '600'],
    }),
  ).resolves.toEqual({
    point: [
      ['1', '2'],
      ['--', '-x'],
    ],
    size: [800, 600],
  });
  await expect(byName({ point: ['3', '4'] })).resolves.toEqual({ point: [['3', '4']] });
  await expect(byName({ point: [] })).resolves.toEqual({ point: [] });
});

test('invoke reports a value of another shape or length as the unlowerable value', async () => {
  await expect(byName({ size: ['800'] })).resolves.toBe(
    'app: Option "size": Use a list of 2 strings or numbers.\n',
  );
  await expect(
    byName({
      size: [
        [1, 2],
        [3, 4],
      ],
    }),
  ).resolves.toBe('app: Option "size": Use a list of 2 strings or numbers.\n');
  await expect(byName({ point: [['1']] })).resolves.toBe(
    'app: Option "point": Use a list of 2 strings or numbers, or a list of such lists.\n',
  );
});

test('the graph publishes the arity, null on a string option without one', () => {
  const graph = new Application('app')
    .option('point', { arity: 2, type: 'string' })
    .option('name', { type: 'string' })
    .action(() => {})
    .inspect();
  const [point, name] = graph.root.options;
  expect([point?.type === 'string' && point.arity, name?.type === 'string' && name.arity]).toEqual([
    2,
    null,
  ]);
  expect(Object.isFrozen(point)).toBe(true);
});

test('locate reads each word after an arity spelling as its value until the count is met', () => {
  const graph = new Application('app')
    .option('point', { arity: 2, short: 'p', type: 'string' })
    .argument('file', {})
    .action(() => {})
    .inspect();
  const [point] = graph.root.options;
  const at = (words: string[]) => locate(graph, words);
  expect(at(['--point', ''])).toMatchObject({ kind: 'value', option: point, prefix: '' });
  expect(at(['--point', '3', '4'])).toMatchObject({ kind: 'value', option: point, prefix: '4' });
  expect(at(['-p', '3', ''])).toMatchObject({ kind: 'value', option: point });
  expect(at(['--point', '3', '4', 'f'])).toMatchObject({ kind: 'argument', prefix: 'f' });
  expect(at(['--point='])).toEqual({ kind: 'none' });
  expect(at(['-p3'])).toEqual({ kind: 'none' });
});

test("locate reads a parent's own arity option's words under routing the same way", () => {
  const graph = new Application('app')
    .option('size', { arity: 2, type: 'string' })
    .command(new Command('child').action(() => {}))
    .inspect();
  const [size] = graph.root.options;
  expect(locate(graph, ['--size', '800', ''])).toMatchObject({ kind: 'value', option: size });
  expect(locate(graph, ['--size', '800', '600', 'ch'])).toMatchObject({
    kind: 'command',
    prefix: 'ch',
  });
});

test('an empty delimiter on a scalar arity option is a declaration error at the declaring call', () => {
  expect(() =>
    new Command('c').option('size', { arity: 2, env: 'SIZE', envDelimiter: '', type: 'string' }),
  ).toThrow('@loomcli/core/env-delimiter');
});
