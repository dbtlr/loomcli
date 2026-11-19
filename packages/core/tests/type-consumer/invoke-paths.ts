import { Application, Command, plugin } from '@loomcli/core';
import type { CommandPaths, InvocationOutcome, PathsOf } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';

const add = new Command('add')
  .argument('name', { required: true })
  .argument('urls', { variadic: true })
  .option('force', { type: 'boolean' })
  .option('depth', { type: 'count' })
  .action(() => undefined);
const remote = new Command('remote').option('scope', { type: 'string' }).command(add);
const get = new Command('get')
  .alias('fetch')
  .argument('path', { required: true })
  .option('raw', { type: 'boolean' })
  .option('tag', { multiple: true, type: 'string' })
  .option('level', { implied: 'info', type: 'string' })
  .option('pair', { arity: 2, type: 'string' })
  .action(() => undefined);

const app = new Application('probe')
  .globalOption('file', { type: 'string' })
  .option('pretty', { type: 'boolean' })
  .command(get)
  .command(remote);

// A literal path types its values against the Command it names, every global option included.
const typed: Promise<InvocationOutcome> = app.invoke(['get'], {
  args: { path: 'name' },
  options: { file: 'x', level: true, pair: ['a', 1], raw: true, tag: ['a', 'b'] },
});
const nested = app.invoke(['remote', 'add'], {
  args: { name: 'origin', urls: ['a', 'b'] },
  options: { depth: 2, file: 'x', force: true },
});

// The empty path is the root, whose own options join the global ones.
const root = app.invoke([], { options: { file: 'x', pretty: true } });

// A number lowers to one token as a string does, so a string input takes either.
const numeric = app.invoke(['get'], { args: { path: 1 } });

// @ts-expect-error TS2322: A path names the Commands its level declares, so a mistyped name is rejected.
const unknownName = app.invoke(['gte'], {});

// @ts-expect-error TS2322: A nested level names its own children.
const unknownChild = app.invoke(['remote', 'ad'], {});

// @ts-expect-error TS2345: A Command with no children ends the path.
const pastLeaf = app.invoke(['get', 'more'], {});

// @ts-expect-error TS2322: An alias goes through the dynamic form, so a literal path takes canonical names.
const alias = app.invoke(['fetch'], {});

// @ts-expect-error TS2353: An option the routed Command and the globals do not declare is rejected.
const unknownOption = app.invoke(['get'], { options: { flie: 'x' } });

// @ts-expect-error TS2353: A sibling's local option is not this Command's.
const siblingOption = app.invoke(['get'], { options: { scope: 'x' } });

// @ts-expect-error TS2353: A parent's local option is not its child's.
const parentOption = app.invoke(['remote', 'add'], { options: { scope: 'x' } });

// @ts-expect-error TS2561: An argument the routed Command does not declare is rejected.
const unknownArgument = app.invoke(['remote', 'add'], { args: { nme: 'x' } });

// @ts-expect-error TS2322: A Boolean option takes a Boolean.
const wrongBoolean = app.invoke(['get'], { options: { raw: 'yes' } });

// @ts-expect-error TS2322: A counted option takes a count.
const wrongCount = app.invoke(['remote', 'add'], { options: { depth: true } });

// @ts-expect-error TS2322: A scalar argument takes one token.
const wrongArgument = app.invoke(['get'], { args: { path: ['a', 'b'] } });

// @ts-expect-error TS2322: Only an option with an implied value takes `true` for its bare spelling.
const wrongImplied = app.invoke([], { options: { file: true } });

// @ts-expect-error TS2353: A Command without arguments takes none, and the error names the key.
const noArguments = app.invoke(['remote'], { args: { name: 'x' } });

// A path typed as an array takes the dynamic values, as an MCP tool call or a graph walk supplies.
const dynamic: readonly string[] = ['gte'];
const untyped = app.invoke(dynamic, { args: { anything: 1 }, options: { flie: 'x' } });

// A tuple with an element typed as the wide `string` is dynamic too.
declare const word: string;
const partly = app.invoke(['remote', word], { options: { anything: true } });

// Five levels of Commands: a path deeper than four reads dynamically.
const level5 = new Command('e').option('fifth', { type: 'boolean' }).action(() => undefined);
const level4 = new Command('d').option('fourth', { type: 'boolean' }).command(level5);
const level3 = new Command('c').command(level4);
const level2 = new Command('b').command(level3);
const level1 = new Command('a').command(level2);
const deep = new Application('deep').command(level1);
const fourth = deep.invoke(['a', 'b', 'c', 'd'], { options: { fourth: true } });
// @ts-expect-error TS2353: The fourth level is still typed.
const fourthWrong = deep.invoke(['a', 'b', 'c', 'd'], { options: { fifth: true } });
const fifth = deep.invoke(['a', 'b', 'c', 'd', 'e'], { options: { anything: 1 } });

// A Command whose name is typed as the wide `string` leaves its level dynamic.
declare const named: string;
const wide = new Application('wide').command(new Command(named).action(() => undefined));
const throughWide = wide.invoke(['anything'], { options: { anything: 1 } });

// A plugin may contribute Commands no type names, so an Application that installs one reads an
// Undeclared first name dynamically, and still types the Commands it declares, a plugin's options
// Included.
const vocabulary = plugin('probe/vocabulary', { options: { tone: { type: 'string' } } });
const installed = new Application('installed', { plugins: [vocabulary] }).command(get);
const pluginCommand = installed.invoke(['help'], { args: { topic: 'x' } });
const pluginOption = installed.invoke(['get'], { options: { tone: 'warm' } });
// @ts-expect-error TS2353: A declared Command's values stay typed beside the plugin's options.
const pluginTypo = installed.invoke(['get'], { options: { tnoe: 'warm' } });
// @ts-expect-error TS2322: A plugin's string option takes a token.
const pluginWrong = installed.invoke(['get'], { options: { tone: false } });

// The neutral annotation states no paths, so every call it makes is dynamic.
const neutral: Application = new Application('plain').command(get);
const anyPath = neutral.invoke(['anything'], { options: { anything: 1 } });

// `PathsOf` reads an Application's Command paths, which `Register.paths` takes.
type ProbePaths = PathsOf<typeof app>;
const children: ProbePaths extends CommandPaths<{}, infer Options, infer Commands>
  ? [keyof Options, keyof Commands]
  : never = ['pretty', 'get'];

// A conditional's two literal paths are a union, which no one Command's values type, so it reads
// Dynamically: a valid call compiles, and so does a misspelled branch, which the run reports.
declare const dry: boolean;
const either = app.invoke(dry ? ['get'] : ['remote'], { options: { file: 'x' } });
const eitherMisspelled = app.invoke(dry ? ['gte'] : ['remote'], { options: { anything: 1 } });
const eitherUndeclared = app.invoke(dry ? ['get'] : ['remote'], { options: { anything: 1 } });

// An explicit `Mapped` leaves the path at its default, so the call is dynamic.
const explicitMapped = app.invoke<string>(['gte'], { options: { anything: 1 } });

// @ts-expect-error TS2353: A Command and an Application with no options name the undeclared key.
const noOptions = deep.invoke(['a'], { options: { forth: true } });

// An option a plugin's attach hook adds, such as the formatter's `--format` on a Command with a
// Result, is in no type, so a literal path rejects it; the starting view or a dynamic path reach it.
const listing = new Command('list')
  .result<string>({ views: { text: { render: (value) => value } } })
  .action(({ out }) => out.results('a'));
const formatted = new Application('formatted', { plugins: [format()] }).command(listing);
// @ts-expect-error TS2353: The formatter's `--format` is added at attach time, outside the types.
const formatOption = formatted.invoke(['list'], { options: { format: 'json' } });
const formatView = formatted.invoke(['list'], {}, { view: 'json' });
const listPath: readonly string[] = ['list'];
const formatDynamic = formatted.invoke(listPath, { options: { fields: 'name', format: 'json' } });

export {
  either,
  eitherMisspelled,
  eitherUndeclared,
  explicitMapped,
  noOptions,
  formatOption,
  formatView,
  formatDynamic,
  typed,
  nested,
  root,
  numeric,
  unknownName,
  unknownChild,
  pastLeaf,
  alias,
  unknownOption,
  siblingOption,
  parentOption,
  unknownArgument,
  wrongBoolean,
  wrongCount,
  wrongArgument,
  wrongImplied,
  noArguments,
  untyped,
  partly,
  fourth,
  fourthWrong,
  fifth,
  throughWide,
  pluginCommand,
  pluginOption,
  pluginTypo,
  pluginWrong,
  anyPath,
  children,
};
