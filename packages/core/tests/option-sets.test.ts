/*
 * Acceptance plan for option sets (docs/core/options.md#sharing-options, ADR-0166).
 *
 * Every case runs an Application in process on a mock process, or reads the fault a declaring call
 * throws.
 *
 * - One by one. A Command or the root built with a set reads the same values in the same key order,
 *   and inspects to the same graph, groups included in call order, as one that declared the same
 *   options and groups one by one.
 * - Groups. A set's group is enforced at run time, and a later group on the Command may name a set's
 *   option beside one of its own.
 * - A value. A group call leaves its receiver unchanged, and a later change to the record changes
 *   nothing the set holds.
 * - Nothing inherits. A parent that applies a set gives its child nothing.
 * - Faults at optionSet(). The rules option() raises at its call, judged between the set's own
 *   entries, each finding rebuilding the entry in the set's record.
 * - Faults at a set's group call. A repeated member and the conflicts no type expresses.
 * - Faults at options() and later. A fault against the receiver, at attach, or when run() starts
 *   rebuilds the options() call with the set's entry marked, on the Command that applied it.
 */
import { Application, Command, extension, optionSet } from '@loomcli/core';
import type { OptionSet, StandardSchemaV1 } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** The options each action run read, in run order. */
const seen: unknown[] = [];

/** One run of an application on a mock process: its status, its stderr, and what the action read. */
async function run(
  application: { run: (options: { process: ReturnType<typeof mockProcess> }) => Promise<number> },
  argv: string[],
): Promise<{ seen: unknown[]; status: number; stderr: string }> {
  seen.length = 0;
  const mock = mockProcess({ argv });
  const status = await application.run({ process: mock });
  return { seen: [...seen], status, stderr: mock.stderr.text };
}

/** The Developer Diagnostic a declaring call throws, or a note that it threw nothing. */
function thrown(declare: () => unknown): string {
  try {
    declare();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'nothing thrown';
}

const level = z.string().transform(Number);

/** The set the cases share: two exclusive formats, a count, a repeated tag, and a validated level. */
const output = optionSet({
  json: { description: 'Print JSON.', type: 'boolean' },
  level: { default: '1', short: 'l', type: 'string', validate: level },
  tag: { multiple: true, type: 'string' },
  verbose: { short: 'v', type: 'count' },
  yaml: { description: 'Print YAML.', type: 'boolean' },
}).exclusive('json', 'yaml');

/** The same options and group, declared one by one in the set's order. */
function oneByOne() {
  return new Command('list')
    .option('json', { description: 'Print JSON.', type: 'boolean' })
    .option('level', { default: '1', short: 'l', type: 'string', validate: level })
    .option('tag', { multiple: true, type: 'string' })
    .option('verbose', { short: 'v', type: 'count' })
    .option('yaml', { description: 'Print YAML.', type: 'boolean' })
    .exclusive('json', 'yaml');
}

test('a Command built with a set inspects to the graph of one built one by one', () => {
  const built = new Application('app')
    .command(new Command('list').options(output).action(() => undefined))
    .inspect();
  const declared = new Application('app').command(oneByOne().action(() => undefined)).inspect();
  expect(built).toEqual(declared);
  expect(built.root.children[0]?.optionGroups).toEqual([
    { kind: 'exclusive', options: ['json', 'yaml'] },
  ]);
});

test('the root built with a set inspects to the graph of one built one by one', () => {
  const built = new Application('app')
    .option('wide', { type: 'boolean' })
    .options(output)
    .exclusive('json', 'wide')
    .action(() => undefined)
    .inspect();
  const declared = new Application('app')
    .option('wide', { type: 'boolean' })
    .option('json', { description: 'Print JSON.', type: 'boolean' })
    .option('level', { default: '1', short: 'l', type: 'string', validate: level })
    .option('tag', { multiple: true, type: 'string' })
    .option('verbose', { short: 'v', type: 'count' })
    .option('yaml', { description: 'Print YAML.', type: 'boolean' })
    .exclusive('json', 'yaml')
    .exclusive('json', 'wide')
    .action(() => undefined)
    .inspect();
  expect(built).toEqual(declared);
});

test("a set's options reach the action as one-by-one declarations do", async () => {
  const argv = ['list', '--json', '-vv', '--tag', 'a', '--tag', 'b', '-l', '3'];
  const withSet = await run(
    new Application('app').command(
      new Command('list').options(output).action(({ options }) => {
        seen.push(options);
      }),
    ),
    argv,
  );
  const declared = await run(
    new Application('app').command(
      oneByOne().action(({ options }) => {
        seen.push(options);
      }),
    ),
    argv,
  );
  expect(withSet).toEqual(declared);
  expect(withSet).toEqual({
    seen: [{ json: true, level: 3, tag: ['a', 'b'], verbose: 2, yaml: false }],
    status: 0,
    stderr: '',
  });
});

test("an option declared before a set comes first in the action's options, as one by one", async () => {
  const formats = optionSet({ json: { type: 'boolean' }, yaml: { type: 'boolean' } });
  const withSet = await run(
    new Application('app').command(
      new Command('list')
        .option('wide', { type: 'boolean' })
        .options(formats)
        .action(({ options }) => {
          seen.push(Object.keys(options));
        }),
    ),
    ['list'],
  );
  const declared = await run(
    new Application('app').command(
      new Command('list')
        .option('wide', { type: 'boolean' })
        .option('json', { type: 'boolean' })
        .option('yaml', { type: 'boolean' })
        .action(({ options }) => {
          seen.push(Object.keys(options));
        }),
    ),
    ['list'],
  );
  expect(withSet).toEqual(declared);
  expect(withSet.seen).toEqual([['wide', 'json', 'yaml']]);
});

/** A set with two groups, made by an exclusive call and then a required-together call. */
const credentials = optionSet({
  json: { type: 'boolean' },
  password: { type: 'string' },
  user: { type: 'string' },
  yaml: { type: 'boolean' },
})
  .exclusive('json', 'yaml')
  .requiredTogether('user', 'password');

test("a set's groups inspect in the order its group calls were made, as one by one", () => {
  const built = new Application('app')
    .command(new Command('login').options(credentials).action(() => undefined))
    .inspect();
  const declared = new Application('app')
    .command(
      new Command('login')
        .option('json', { type: 'boolean' })
        .option('password', { type: 'string' })
        .option('user', { type: 'string' })
        .option('yaml', { type: 'boolean' })
        .exclusive('json', 'yaml')
        .requiredTogether('user', 'password')
        .action(() => undefined),
    )
    .inspect();
  expect(built.root.children[0]?.optionGroups).toEqual(declared.root.children[0]?.optionGroups);
  expect(built.root.children[0]?.optionGroups).toEqual([
    { kind: 'exclusive', options: ['json', 'yaml'] },
    { kind: 'requiredTogether', options: ['user', 'password'] },
  ]);
});

/** An application whose `list` applies a set that holds `json`, and records what it reads. */
function lister(set: OptionSet<{ json: { type: 'boolean' } }> = output) {
  return new Application('app').command(
    new Command('list').options(set).action(({ options }) => {
      seen.push(options.json);
    }),
  );
}

test("a set's group is enforced at run time", async () => {
  await expect(run(lister(), ['list', '--json', '--yaml'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr:
      'app: Options "--json" and "--yaml" cannot be used together. Supply only one of them.\n',
  });
});

test("a later group on the Command names a set's option beside one of its own", async () => {
  const application = new Application('app')
    .option('wide', { type: 'boolean' })
    .options(output)
    .exclusive('json', 'wide')
    .action(({ options }) => {
      seen.push(options.wide);
    });
  await expect(run(application, ['--json', '--wide'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr:
      'app: Options "--json" and "--wide" cannot be used together. Supply only one of them.\n',
  });
});

test('a group call returns a new set and leaves its receiver unchanged', async () => {
  const plain = optionSet({ json: { type: 'boolean' }, yaml: { type: 'boolean' } });
  const grouped = plain.requiredTogether('json', 'yaml');
  expect(grouped).not.toBe(plain);
  await expect(run(lister(plain), ['list', '--json'])).resolves.toMatchObject({ status: 0 });
  await expect(run(lister(grouped), ['list', '--json'])).resolves.toMatchObject({ status: 2 });
});

test('a later change to the record or an entry changes nothing the set holds', () => {
  const json = { type: 'boolean' } as const;
  const record = { json };
  const set = optionSet(record);
  Reflect.set(json, 'short', 'j');
  Reflect.set(record, 'yaml', { type: 'boolean' });
  const graph = new Application('app')
    .options(set)
    .action(() => undefined)
    .inspect();
  expect(graph.root.options.map((option) => [option.name, option.short])).toEqual([['json', null]]);
});

test('an empty set declares nothing', () => {
  const graph = new Application('app')
    .options(optionSet({}))
    .action(() => undefined)
    .inspect();
  expect(graph).toEqual(new Application('app').action(() => undefined).inspect());
});

test('a parent that applies a set gives its child nothing', async () => {
  const application = new Application('app').command(
    new Command('parent')
      .options(output)
      .command(
        new Command('child').action(({ options }) => {
          seen.push(options);
        }),
      )
      .action(() => undefined),
  );
  await expect(run(application, ['parent', 'child'])).resolves.toMatchObject({
    seen: [{}],
    status: 0,
  });
  await expect(run(application, ['parent', 'child', '--json'])).resolves.toMatchObject({
    seen: [],
    status: 2,
  });
});

/**
 * The parts of one Developer Diagnostic a case pins: the rule's identity, the sentence, the code
 * of each finding, and the correction. The explanation is the rule's own, which its tests pin.
 */
function partsOf(message: string): {
  code: string[];
  correction: string | undefined;
  identity: string | undefined;
  sentence: string | undefined;
} {
  const lines = message.split('\n');
  return {
    code: lines.filter((line) => line.startsWith('    ')).map((line) => line.slice(4)),
    correction: lines.at(-1),
    identity: /(?<identity>@loomcli\/core\/[a-z-]+)$/u.exec(lines[0] ?? '')?.groups?.identity,
    sentence: lines[2],
  };
}

test('two entries that share a spelling fail at optionSet() with a finding for each entry', () => {
  const message = thrown(() =>
    optionSet({ all: { short: 'a', type: 'boolean' }, any: { short: 'a', type: 'boolean' } }),
  );
  expect(partsOf(message)).toEqual({
    code: [
      "optionSet({ all: { short: 'a', type: 'boolean' } })",
      '                   ^^^^^^^^^^',
      "optionSet({ any: { short: 'a', type: 'boolean' } })",
      '                   ^^^^^^^^^^',
    ],
    correction: 'Change one declaration.',
    identity: '@loomcli/core/spelling-taken',
    sentence: 'Option spelling "-a" is used by both "all" and "any".',
  });
});

test.each([
  [
    'an invalid name',
    () => optionSet({ '-x': { type: 'boolean' } }),
    '@loomcli/core/declared-name',
    'Option name "-x" is invalid.',
    ["optionSet({ '-x': … })", '            ^^^^^^^'],
  ],
  [
    'an invalid alias',
    () => optionSet({ all: { aliases: ['a b'], type: 'boolean' } }),
    '@loomcli/core/declared-name',
    'Option "all" declares an alias named "a b".',
    [
      "optionSet({ all: { aliases: ['a b'], type: 'boolean' } })",
      '                             ^^^^^',
    ],
  ],
  [
    'an alias that is another entry’s name',
    () => optionSet({ all: { type: 'boolean' }, every: { aliases: ['all'], type: 'boolean' } }),
    '@loomcli/core/spelling-taken',
    'Option spelling "--all" is used by both "all" and "every".',
    [
      "optionSet({ all: { type: 'boolean' } })",
      '            ^^^^^^^^^^^^^^^^^^^^^^^^',
      "optionSet({ every: { aliases: ['all'], type: 'boolean' } })",
      '                               ^^^^^',
    ],
  ],
  [
    'a generated negative form another entry spells',
    () =>
      optionSet({
        color: { polarity: 'both', type: 'boolean' },
        'no-color': { type: 'boolean' },
      }),
    '@loomcli/core/spelling-taken',
    'Option spelling "--no-color" is used by both "color" and "no-color".',
    [
      "optionSet({ color: { polarity: 'both', type: 'boolean' } })",
      '                     ^^^^^^^^^^^^^^^^',
      "optionSet({ 'no-color': { type: 'boolean' } })",
      '            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
    ],
  ],
  [
    'two entries that bind one variable',
    () => optionSet({ from: { env: 'AT', type: 'string' }, to: { env: 'AT', type: 'string' } }),
    '@loomcli/core/variable-bound-twice',
    'Variable "AT" is bound by an option set option "from" and an option set option "to".',
    [
      "optionSet({ from: { env: 'AT', type: 'string' } })",
      '                    ^^^^^^^^^',
      "optionSet({ to: { env: 'AT', type: 'string' } })",
      '                  ^^^^^^^^^',
    ],
  ],
  [
    'an empty envDelimiter',
    () => optionSet({ tag: { env: 'TAGS', envDelimiter: '', multiple: true, type: 'string' } }),
    '@loomcli/core/env-delimiter',
    'Option "tag" declares an empty envDelimiter.',
    [
      "optionSet({ tag: { env: 'TAGS', envDelimiter: '', multiple: true, type: 'string' } })",
      '                                ^^^^^^^^^^^^^^^^',
    ],
  ],
  [
    'an arity below 2',
    () => optionSet({ point: { arity: 1, type: 'string' } }),
    '@loomcli/core/option-arity',
    'Option "point" declares arity 1.',
    ["optionSet({ point: { arity: 1, type: 'string' } })", '                     ^^^^^^^^'],
  ],
  [
    'two content entries that claim stdin',
    () =>
      optionSet({
        from: { stdin: true, type: 'content' },
        to: { stdin: true, type: 'content' },
      }),
    '@loomcli/core/stdin-claimed-twice',
    'An option set declares more than one stdin target.',
    [
      "optionSet({ from: { stdin: true, type: 'content' } })",
      '            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ claims stdin',
      "optionSet({ to: { stdin: true, type: 'content' } })",
      '            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ claims stdin',
    ],
  ],
])('%s fails at optionSet() as option() fails', (_case, declare, identity, sentence, code) => {
  expect(partsOf(thrown(declare))).toMatchObject({ code, identity, sentence });
});

/** A descriptor that accepts a nonempty label, under an identity two installed copies can share. */
function labelExtension() {
  const schema: StandardSchemaV1<string, string> = {
    '~standard': {
      validate: (value) =>
        typeof value === 'string' && value !== ''
          ? { value }
          : { issues: [{ message: 'Use a nonempty label.' }] },
      vendor: 'test',
      version: 1,
    },
  };
  return extension('@acme/label', { schema, target: 'option' });
}

test('an extension value its schema rejects fails at optionSet()', () => {
  const label = labelExtension();
  const message = thrown(() => optionSet({ all: { extensions: [label('')], type: 'boolean' } }));
  expect(partsOf(message)).toMatchObject({
    code: [
      "optionSet({ all: { extensions: […], type: 'boolean' } })",
      '                                ^ extension "@acme/label"',
    ],
    identity: '@loomcli/core/invalid-extension-value',
    sentence:
      'An option set option "all" holds an invalid "@acme/label" value: Use a nonempty label.',
  });
});

test('two copies of one descriptor fail where they meet: in the set, or on the receiver', () => {
  const first = labelExtension();
  const second = labelExtension();
  expect(
    partsOf(
      thrown(() =>
        optionSet({
          all: { extensions: [first('a')], type: 'boolean' },
          any: { extensions: [second('b')], type: 'boolean' },
        }),
      ),
    ),
  ).toMatchObject({ identity: '@loomcli/core/two-package-copies' });
  const set = optionSet({ any: { extensions: [second('b')], type: 'boolean' } });
  const receiver = new Command('list').option('all', { extensions: [first('a')], type: 'boolean' });
  expect(partsOf(thrown(() => receiver.options(set)))).toMatchObject({
    code: [
      '// list',
      "new Command('list')",
      "  .options(optionSet({ any: { extensions: […], type: 'boolean' } }))",
      '                                           ^ another "@acme/label"',
    ],
    identity: '@loomcli/core/two-package-copies',
  });
});

test.each([
  [
    'a repeated member',
    () =>
      optionSet({ json: { type: 'boolean' }, yaml: { type: 'boolean' } }).exclusive('json', 'json'),
    'An option set exclusive repeats option "json".',
    'Name each option once.',
    ["optionSet({ … }).exclusive('json', 'json')"],
  ],
  [
    'an exclusive group with a required member',
    () =>
      optionSet({ cc: { type: 'string' }, to: { required: true, type: 'string' } }).exclusive(
        'to',
        'cc',
      ),
    'An option set exclusive group contains required option "to".',
    'Remove the presence requirement or remove the exclusive group.',
    ["optionSet({ … }).exclusive('to', 'cc')"],
  ],
  [
    'an exclusive group after a required-together group over two of its members',
    () =>
      optionSet({ from: { type: 'boolean' }, to: { type: 'boolean' } })
        .requiredTogether('from', 'to')
        .exclusive('from', 'to'),
    'An option set exclusive and requiredTogether groups share at least two options.',
    'Remove one of the conflicting group rules.',
    ["optionSet({ … }).exclusive('from', 'to')"],
  ],
  [
    'a required-together group after an exclusive group over two of its members',
    () =>
      optionSet({ from: { type: 'boolean' }, to: { type: 'boolean' } })
        .exclusive('from', 'to')
        .requiredTogether('to', 'from'),
    'An option set exclusive and requiredTogether groups share at least two options.',
    'Remove one of the conflicting group rules.',
    ["optionSet({ … }).requiredTogether('to', 'from')"],
  ],
])("%s fails at the set's group call", (_case, declare, sentence, correction, code) => {
  expect(partsOf(thrown(declare))).toEqual({
    code,
    correction,
    identity: '@loomcli/core/option-group',
    sentence,
  });
});

test('a spelling the receiver holds fails at options() with a finding for each side', () => {
  const receiver = new Command('list').option('json', { short: 'j', type: 'boolean' });
  const set = optionSet({ jobs: { short: 'j', type: 'string' } });
  expect(partsOf(thrown(() => receiver.options(set)))).toEqual({
    code: [
      '// list',
      "new Command('list')",
      "  .option('json', { short: 'j', type: 'boolean' })",
      '                    ^^^^^^^^^^',
      '// list',
      "new Command('list')",
      "  .options(optionSet({ jobs: { short: 'j', type: 'string' } }))",
      '                               ^^^^^^^^^^',
    ],
    correction: 'Change one declaration.',
    identity: '@loomcli/core/spelling-taken',
    sentence: 'Option spelling "-j" is used by both "json" and "jobs".',
  });
});

test('a later option() that repeats a set’s option names the options() call first', () => {
  const declared = new Command('list').options(optionSet({ json: { type: 'boolean' } }));
  // The types of option() do not judge a repeated local name, so this compiles and core judges it.
  expect(partsOf(thrown(() => declared.option('json', { type: 'boolean' })))).toMatchObject({
    code: [
      '// list',
      "new Command('list')",
      "  .options(optionSet({ json: { type: 'boolean' } }))",
      '                       ^^^^^^^^^^^^^^^^^^^^^^^^^ the first declaration',
      '// list',
      "new Command('list')",
      "  .option('json', { type: 'boolean' })",
      '          ^^^^^^ the second declaration',
    ],
    identity: '@loomcli/core/option-declared-twice',
  });
});

test('a second stdin claim fails at options() against the receiver', () => {
  const receiver = new Command('read').stdin({});
  const set = optionSet({ file: { stdin: true, type: 'content' } });
  expect(partsOf(thrown(() => receiver.options(set)))).toMatchObject({
    code: [
      '// read',
      "new Command('read')",
      "  .options(optionSet({ file: { stdin: true, type: 'content' } }))",
      '                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ claims stdin',
      '// read',
      "new Command('read')",
      '  .stdin({})',
      '         ^^',
    ],
    identity: '@loomcli/core/stdin-claimed-twice',
  });
});

test('on the root, a spelling a global option holds fails at options()', () => {
  const root = new Application('app').globalOption('quiet', { short: 'q', type: 'boolean' });
  const set = optionSet({ query: { short: 'q', type: 'string' } });
  expect(partsOf(thrown(() => root.options(set)))).toMatchObject({
    code: [
      'new Application(…)',
      "  .globalOption('quiet', { short: 'q', type: 'boolean' })",
      '                           ^^^^^^^^^^ the global option',
      'new Application(…)',
      "  .options(optionSet({ query: { short: 'q', type: 'string' } }))",
      '                                ^^^^^^^^^^ the local option',
    ],
    identity: '@loomcli/core/spelling-taken',
  });
});

test('a default its validator rejects fails when run() starts, naming the options() call', async () => {
  // The validator's input type is any string, so the types accept the default its check rejects.
  const low = z.string().refine((value) => value === 'low');
  const set = optionSet({ level: { default: 'high', type: 'string', validate: low } });
  const application = new Application('app').options(set).action(() => undefined);
  const result = await run(application, []);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('@loomcli/core/invalid-default');
  expect(result.stderr).toContain(
    [
      "    new Application('app')",
      "      .options(optionSet({ level: { default: 'high', type: 'string', validate: … } }))",
    ].join('\n'),
  );
});

test('a set two Commands apply names the Command that ran when its default fails', async () => {
  // The validator's input type is any string, so the types accept the default its check rejects.
  const low = z.string().refine((value) => value === 'low');
  const set = optionSet({ level: { default: 'high', type: 'string', validate: low } });
  const application = new Application('app')
    .command(new Command('alpha').options(set).action(() => undefined))
    .command(new Command('beta').options(set).action(() => undefined));
  const result = await run(application, ['alpha']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    [
      '    // app alpha',
      "    new Command('alpha')",
      "      .options(optionSet({ level: { default: 'high', type: 'string', validate: … } }))",
    ].join('\n'),
  );
});

test('a set another installed copy of core built fails at options()', () => {
  // A set the other copy built carries no facts this copy recorded.
  const foreign: unknown = JSON.parse('{}');
  const receiver = new Command('list');
  expect(partsOf(thrown(() => Reflect.apply(receiver.options, receiver, [foreign])))).toMatchObject(
    {
      correction:
        'Install one copy of @loomcli/core, so the Application and every plugin package share it.',
      identity: '@loomcli/core/foreign-value',
      sentence:
        'Command "list" applies an option set another installed copy of @loomcli/core built.',
    },
  );
});

// The fault a declaring call raises names the first member that breaks a rule, in member order.
test.each<[string, [string, string, ...string[]], string]>([
  ['a repeat with the member undeclared', ['x', 'x'], 'names undeclared local option "x"'],
  [
    'an undeclared member before a repeat of a declared one',
    ['z', 'a', 'a'],
    'names undeclared local option "z"',
  ],
  ['a repeat of a declared member before an undeclared one', ['a', 'a', 'z'], 'repeats option "a"'],
])(
  'a Command group call with %s reports the first fault in member order',
  (_name, names, fault) => {
    const command = new Command('get').option('a', { type: 'boolean' });
    expect(() =>
      // @ts-expect-error The probe names options the Command does not declare.
      command.exclusive(...names),
    ).toThrow(`Command "get" exclusive ${fault}.`);
  },
);

// A name fault is judged before the config is read, so no getter on the config runs.
test('an invalid option name reads none of its config, on option() and on an optionSet entry', () => {
  let reads = 0;
  const config = {
    get description(): string {
      reads += 1;
      return 'Read me.';
    },
    type: 'boolean',
  } as const;
  expect(() => new Command('get').option('-raw', config)).toThrow('Option name "-raw" is invalid.');
  expect(() => optionSet({ '-raw': config })).toThrow('Option name "-raw" is invalid.');
  expect(reads).toBe(0);
});

// Entries are judged in the record's order, as one-by-one declarations are.
// The keys are already in sorted order, so the key-sorting lint fix leaves the record's order alone.
test('an earlier entry fault reports before a later entry invalid name', () => {
  const shared = { short: 'q', type: 'boolean' } as const;
  const fault = 'Option spelling "-q" is used by both "alpha" and "beta".';
  expect(() => optionSet({ alpha: shared, beta: shared, 'zed=raw': { type: 'boolean' } })).toThrow(
    fault,
  );
  expect(() =>
    new Command('get')
      .option('alpha', shared)
      .option('beta', shared)
      .option('zed=raw', { type: 'boolean' }),
  ).toThrow(fault);
});
