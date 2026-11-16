/*
 * Acceptance plan for visible aliases in core (docs/core/commands.md#visible-aliases,
 * docs/core/options.md#visible-option-aliases, ADR-0168).
 *
 * Every case runs an Application in process on a mock process, reads its graph, or reads the fault
 * a declaring call throws.
 *
 * - Routing. A visible alias routes as an alias does, and the routed path and the candidates of a
 *   routing failure keep canonical names.
 * - Parsing. An option's visible alias binds its option under every long form its polarity
 *   generates, and a reported problem names the option's own spelling.
 * - Inspection. `aliases` holds every alias and `visibleAliases` the visible ones, in the order
 *   `aliases` holds them, on a Command and on an option wherever the option is declared.
 * - Declaration faults. The name rules and the namespace rules an alias raises, with the finding
 *   rebuilt from the call of the alias's kind.
 */
import { Application, Command, locate, optionSet, plugin } from '@loomcli/core';
import type { CommandNode, OptionNode } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** A whole number, so a rejected value shows which spelling validation names. */
const digits = z.string().regex(/^[0-9]+$/u, 'Use a whole number.');

/**
 * The store application: `cache list` advertises `ls` and keeps `dir` unadvertised, and its
 * options each advertise another name.
 */
function store(printed: unknown[]) {
  const list = new Command('list', { description: 'List the cache.' })
    .alias('dir')
    .visibleAlias('ls')
    .option('min-bytes', { type: 'string', validate: digits, visibleAliases: ['minimum'] })
    .option('color', { polarity: 'both', type: 'boolean', visibleAliases: ['colour'] })
    .option('quiet', { polarity: 'negative', type: 'boolean', visibleAliases: ['silent'] })
    .action(({ command, options }) => {
      printed.push({ options, path: command.path });
    });
  const clear = new Command('clear').action(() => {});
  return new Application('store').command(new Command('cache').command(clear).command(list));
}

/** What one run of the store application printed, wrote to stderr, and exited with. */
async function run(argv: string[]) {
  const printed: unknown[] = [];
  const mock = mockProcess({ argv });
  const status = await store(printed).run({ process: mock });
  return { printed, status, stderr: mock.stderr.text };
}

const unset = { color: false, quiet: true };

test.each([['ls'], ['dir'], ['list']])(
  'cache %s dispatches list under its canonical path',
  async (word) => {
    await expect(run(['cache', word])).resolves.toEqual({
      printed: [{ options: unset, path: ['cache', 'list'] }],
      status: 0,
      stderr: '',
    });
  },
);

test('an unknown command lists canonical names alone, a visible alias never among them', async () => {
  await expect(run(['cache', 'nope'])).resolves.toEqual({
    printed: [],
    status: 2,
    stderr: 'store: Unknown command "nope". Use one of: clear, list.\n',
  });
});

test.each([
  [['--minimum', '5'], { 'min-bytes': '5' }],
  [['--minimum=5'], { 'min-bytes': '5' }],
  [['--colour'], { color: true }],
  [['--no-colour'], { color: false }],
  [['--no-silent'], { quiet: false }],
] satisfies [string[], Record<string, unknown>][])(
  'a visible alias binds the option it belongs to %j',
  async (argv, values) => {
    const outcome = await run(['cache', 'ls', ...argv]);
    expect(outcome).toEqual({
      printed: [{ options: { ...unset, ...values }, path: ['cache', 'list'] }],
      status: 0,
      stderr: '',
    });
  },
);

test('a negative-only option’s visible alias has its negative spelling alone', async () => {
  await expect(run(['cache', 'ls', '--silent'])).resolves.toMatchObject({
    status: 2,
    stderr:
      'store: Unknown option "--silent". Supply a declared option; prefix a hyphenated path with "./".\n',
  });
});

test('validation names the option by its own spelling when a visible alias supplied it', async () => {
  await expect(run(['cache', 'ls', '--minimum', 'x'])).resolves.toEqual({
    printed: [],
    status: 2,
    stderr: 'store: Option "--min-bytes": Use a whole number.\n',
  });
});

test('locate reads a visible alias of a Command and of an option as routing and parsing do', () => {
  const graph = store([]).inspect();
  const position = locate(graph, ['cache', 'ls', '--minimum', '']);
  expect(position.kind === 'value' && [position.command.path, position.option.name]).toEqual([
    ['cache', 'list'],
    'min-bytes',
  ]);
});

/** The alias facts of one node of a graph. */
function aliasFacts(node: CommandNode | OptionNode | undefined) {
  return node && { aliases: node.aliases, visibleAliases: node.visibleAliases };
}

/** The node of one finished Command, attached alone to an Application. */
function onlyChild(child: Command): CommandNode | undefined {
  const graph = new Application('store').command(child).inspect();
  return graph.root.children[0];
}

test('a Command’s node holds every alias under aliases and the visible ones under visibleAliases', () => {
  const graph = store([]).inspect();
  const [cache] = graph.root.children;
  const list = cache?.children[1];
  expect(aliasFacts(list)).toEqual({ aliases: ['dir', 'ls'], visibleAliases: ['ls'] });
  expect(Object.isFrozen(list?.visibleAliases)).toBe(true);
  expect(aliasFacts(cache)).toEqual({ aliases: [], visibleAliases: [] });
  expect(aliasFacts(graph.root)).toEqual({ aliases: [], visibleAliases: [] });
});

test.each([
  [
    'a repeat of the canonical name or of an earlier name adds nothing',
    new Command('list').visibleAlias('ls', 'list', 'ls').action(() => {}),
    { aliases: ['ls'], visibleAliases: ['ls'] },
  ],
  [
    'a name declared hidden first is visible in its first place',
    new Command('list')
      .alias('ls', 'dir')
      .visibleAlias('ls')
      .action(() => {}),
    { aliases: ['ls', 'dir'], visibleAliases: ['ls'] },
  ],
  [
    'a name declared visible first stays visible when alias() repeats it',
    new Command('list')
      .visibleAlias('dir')
      .alias('ls', 'dir')
      .action(() => {}),
    { aliases: ['dir', 'ls'], visibleAliases: ['dir'] },
  ],
  [
    'the visible ones follow the order aliases holds them',
    new Command('list')
      .alias('a', 'b')
      .visibleAlias('c')
      .visibleAlias('a')
      .action(() => {}),
    { aliases: ['a', 'b', 'c'], visibleAliases: ['a', 'c'] },
  ],
])('%s', (_case, child, expected) => {
  expect(aliasFacts(onlyChild(child))).toEqual(expected);
});

/** One string option that keeps `<name>-old` and advertises `<name>-short`. */
function renamed(name: string) {
  return { aliases: [`${name}-old`], type: 'string', visibleAliases: [`${name}-short`] } as const;
}

/** The alias facts the node of an option `renamed` declared publishes. */
function facts(name: string) {
  return { aliases: [`${name}-old`, `${name}-short`], visibleAliases: [`${name}-short`] };
}

test('an option’s node holds every alias, then the visible ones, wherever the option is declared', () => {
  const hooked = plugin('@test/hooked', {
    onCommandAttach: (command) =>
      command.name === 'list' ? command.option('hooked', renamed('hooked')) : command,
  });
  const brought = plugin('@test/brought', { options: { brought: renamed('brought') } });
  const graph = new Application('store', { plugins: [hooked, brought] })
    .globalOption('global', renamed('global'))
    .command(
      new Command('list')
        .option('local', renamed('local'))
        .options(optionSet({ set: renamed('set') }))
        .option('both', { aliases: ['minimum', 'min'], type: 'string', visibleAliases: ['min'] })
        .action(() => {}),
    )
    .inspect();
  const options = graph.root.children[0]?.options ?? [];
  expect(Object.fromEntries(options.map((option) => [option.name, aliasFacts(option)]))).toEqual({
    both: { aliases: ['minimum', 'min'], visibleAliases: ['min'] },
    hooked: facts('hooked'),
    local: facts('local'),
    set: facts('set'),
  });
  const globals = graph.globals.filter((option) => ['brought', 'global'].includes(option.name));
  expect(Object.fromEntries(globals.map((option) => [option.name, aliasFacts(option)]))).toEqual({
    brought: facts('brought'),
    global: facts('global'),
  });
  const [local] = options;
  expect(local && [local.long, local.short]).toEqual(['--local', null]);
});

/** What the repeating applications printed. */
const printed: unknown[] = [];

/** One `both` Boolean option `color` that declares `spellings` as aliases of one list. */
function repeating(list: 'aliases' | 'visibleAliases', spellings: string[]) {
  return new Application('store')
    .option('color', { [list]: spellings, polarity: 'both', type: 'boolean' })
    .action(({ options }) => {
      printed.push(options);
    });
}

test.each(['aliases', 'visibleAliases'] as const)(
  'an alias whose spelling the option accepts adds nothing, in %s: it is left out of inspection and its negative form is unknown',
  async (list) => {
    const app = repeating(list, ['no-color', 'colour', 'colour', 'no-colour']);
    const [color] = app.inspect().root.options;
    expect(aliasFacts(color)).toEqual({
      aliases: ['colour'],
      visibleAliases: list === 'visibleAliases' ? ['colour'] : [],
    });
    printed.length = 0;
    const accepted = mockProcess({ argv: ['--no-color'] });
    await expect(app.run({ process: accepted })).resolves.toBe(0);
    expect(printed).toEqual([{ color: false }]);
    const unknown = mockProcess({ argv: ['--no-no-color'] });
    await expect(app.run({ process: unknown })).resolves.toBe(2);
    expect(unknown.stderr.text).toContain('Unknown option "--no-no-color".');
  },
);

/** The Developer Diagnostic a declaring call throws, or a note that it threw nothing. */
function thrown(declare: () => unknown): string {
  try {
    declare();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'nothing thrown';
}

/**
 * The rule, the sentence, and the code lines of every finding of one Developer Diagnostic: the
 * indented lines after the sentence, up to the explanation, without their path comments.
 */
function faultOf(message: string) {
  const [heading = '', , sentence, ...rest] = message.split('\n');
  const end = rest.findIndex((line) => line !== '' && !line.startsWith(' '));
  return {
    findings: rest
      .slice(0, end)
      .filter((line) => line !== '' && !line.trimStart().startsWith('//')),
    rule: /(?<identity>@loomcli\/core\/[a-z-]+)$/u.exec(heading)?.groups?.identity,
    sentence,
  };
}

const act = () => {};

test('a visible alias that is not a portable name fails at its call, which the finding rebuilds', () => {
  expect(
    faultOf(thrown(() => new Command('keys').alias('dir').visibleAlias('ls', 'bad name'))),
  ).toEqual({
    findings: [
      "    new Command('keys')",
      "      .visibleAlias('ls', 'bad name')",
      '                          ^^^^^^^^^^',
    ],
    rule: '@loomcli/core/portable-name',
    sentence: 'Command "keys" declares an alias named "bad name".',
  });
});

test.each([
  [
    'a sibling’s name',
    () =>
      new Command('store')
        .command(new Command('get').action(act))
        .command(new Command('keys').alias('dir').visibleAlias('get').action(act)),
    'Command "store" attaches child "keys" with alias "get", which is also the name of child "get".',
    ["      .command(new Command('get'))", "      .visibleAlias('get')"],
  ],
  [
    'a sibling’s alias',
    () =>
      new Command('store')
        .command(new Command('select').alias('ls').visibleAlias('sel').action(act))
        .command(new Command('keys').alias('dir').visibleAlias('ls').action(act)),
    'Command "store" attaches child "keys" with alias "ls", which is also an alias of child "select".',
    ["      .alias('ls')", "      .visibleAlias('ls')"],
  ],
  [
    'a sibling’s visible alias',
    () =>
      new Command('store')
        .command(new Command('select').alias('sel').visibleAlias('pick', 'ls').action(act))
        .command(new Command('keys').visibleAlias('ls').action(act)),
    'Command "store" attaches child "keys" with alias "ls", which is also an alias of child "select".',
    ["      .visibleAlias('pick', 'ls')", "      .visibleAlias('ls')"],
  ],
  [
    'a name declared both ways',
    () =>
      new Command('store')
        .command(new Command('select').alias('ls').action(act))
        .command(new Command('keys').alias('ls', 'dir').visibleAlias('ls').action(act)),
    'Command "store" attaches child "keys" with alias "ls", which is also an alias of child "select".',
    ["      .alias('ls')", "      .visibleAlias('ls')"],
  ],
  [
    'a later sibling’s name',
    () =>
      new Command('store')
        .command(new Command('keys').alias('dir').visibleAlias('get').action(act))
        .command(new Command('get').action(act)),
    'Command "store" attaches child "keys" with alias "get", which is also the name of child "get".',
    ["      .visibleAlias('get')", "      .command(new Command('get'))"],
  ],
] satisfies [string, () => unknown, string, string[]][])(
  'a visible alias that repeats %s fails at the attaching command() call',
  (_case, declare, sentence, calls) => {
    const fault = faultOf(thrown(declare));
    expect([fault.rule, fault.sentence]).toEqual(['@loomcli/core/sibling-name-taken', sentence]);
    expect(fault.findings.filter((line) => /^ {6}\./u.test(line))).toEqual(calls);
  },
);

test('an option’s visible alias that is not a declared name fails, marked in visibleAliases', () => {
  const message = thrown(() =>
    new Application('store').option('min-bytes', { type: 'string', visibleAliases: ['bad=name'] }),
  );
  expect(faultOf(message)).toEqual({
    findings: [
      '    new Application(…)',
      "      .option('min-bytes', { type: 'string', visibleAliases: ['bad=name'] })",
      `${' '.repeat(62)}^^^^^^^^^^`,
    ],
    rule: '@loomcli/core/declared-name',
    sentence: 'Option "min-bytes" declares an alias named "bad=name".',
  });
});

test.each([
  [
    'its long form',
    () =>
      new Application('store')
        .option('min-bytes', { type: 'string', visibleAliases: ['m'] })
        .option('m', { type: 'string' }),
    'Option spelling "--m" is used by both "min-bytes" and "m".',
    "      .option('min-bytes', { type: 'string', visibleAliases: ['m'] })",
    `${' '.repeat(62)}^^^`,
  ],
  [
    'its generated negative form',
    () =>
      new Application('store')
        .option('color', { polarity: 'both', type: 'boolean', visibleAliases: ['colour'] })
        .option('no-colour', { type: 'boolean' }),
    'Option spelling "--no-colour" is used by both "color" and "no-colour".',
    "      .option('color', { polarity: 'both', type: 'boolean', visibleAliases: ['colour'] })",
    `${' '.repeat(77)}^^^^^^^^`,
  ],
  [
    'a name both lists hold',
    () =>
      new Application('store')
        .option('min-bytes', { aliases: ['m'], type: 'string', visibleAliases: ['m'] })
        .option('m', { type: 'string' }),
    'Option spelling "--m" is used by both "min-bytes" and "m".',
    "      .option('min-bytes', { aliases: ['m'], type: 'string', visibleAliases: ['m'] })",
    `${' '.repeat(78)}^^^`,
  ],
  [
    'a global option’s spelling',
    () =>
      new Application('store')
        .globalOption('m', { type: 'string' })
        .option('min-bytes', { type: 'string', visibleAliases: ['m'] }),
    'Option spelling "--m" is used by the global option "m" and the local option "min-bytes" on the root Command.',
    "      .option('min-bytes', { type: 'string', visibleAliases: ['m'] })",
    `${' '.repeat(62)}^^^ the local option`,
  ],
] satisfies [string, () => unknown, string, string, string][])(
  'a visible alias that takes %s fails, marked in visibleAliases',
  (_case, declare, sentence, call, mark) => {
    const fault = faultOf(thrown(declare));
    expect([fault.rule, fault.sentence]).toEqual(['@loomcli/core/spelling-taken', sentence]);
    const at = fault.findings.indexOf(call);
    expect(fault.findings.slice(at, at + 2)).toEqual([call, mark]);
  },
);
