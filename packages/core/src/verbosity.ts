import type { BuiltGraph } from './command.js';
import { registerRule } from './diagnostic-text.js';
import { quoted, UnknownCommandError } from './errors.js';
import { factFault } from './facts.js';
import type { FactSite } from './facts.js';
import { lowerInvocation } from './lower.js';
import type { NamedCall } from './lower.js';
import { checkMarkPlacement, isMarked } from './marks.js';
import type { Mark } from './marks.js';
import type { OptionValues } from './options.js';
import { readWords } from './parse.js';
import type { OptionConfig } from './types.js';

const verboseMark = registerRule('@loomcli/core/verbose-mark', {
  explanation:
    "One counted global option may raise the run's verbosity. Core settles the verbosity right after graph build, before it reads the environment or configuration, so the marked option takes no second source.",
  headline: 'Invalid verbose mark',
});

const quietMark = registerRule('@loomcli/core/quiet-mark', {
  explanation:
    "One counted global option may lower the run's verbosity by one step. Core settles the verbosity right after graph build, before it reads the environment or configuration, so the marked option takes no second source.",
  headline: 'Invalid quiet mark',
});

/** The verbose mark, whose option's occurrences raise the run's verbosity. */
const verbose: Mark = { fact: 'verbose', rule: verboseMark, type: 'count' };

/** The quiet mark, whose option's first occurrence lowers the run's verbosity by one step. */
const quiet: Mark = { fact: 'quiet', rule: quietMark, type: 'count' };

/** Both verbosity marks, in the order a fault about either names them. */
const verbosityMarks: readonly Mark[] = [verbose, quiet];

/**
 * The highest verbosity, trace, and the lowest, which hides info and success. A higher verbose
 * count and a higher quiet count change nothing.
 */
const loudest = 2;
const quietest = 1;

/**
 * Each mark belongs only to a counted global option, an option carries at most one of them, and a
 * marked option binds no variable, judged at the call that declares the option. The configuration
 * binding needs the installed source, so `checkVerbosityBinding` judges it where the Application
 * knows the source.
 */
function checkVerbosity(config: OptionConfig, site: FactSite, global: boolean): void {
  for (const mark of verbosityMarks) {
    checkMarkPlacement(config, site, { global, mark });
  }
  if ('verbose' in config && 'quiet' in config) {
    throw factFault(verboseMark, site, {
      correction: 'Mark one; declare a second counted option for the other.',
      fact: 'quiet',
      sentence: `${site.subject} declares verbose and quiet.`,
    });
  }
  const marked = verbosityMarks.find((mark) => isMarked(config, mark));
  if (marked !== undefined && config.env !== undefined) {
    throw factFault(marked.rule, site, {
      correction: 'Remove env; the run settles its verbosity before it reads the environment.',
      fact: 'env',
      sentence: `${site.subject} declares ${marked.fact} and env, a second source for the run's verbosity.`,
    });
  }
}

/**
 * A marked option carries no value of the installed configuration source's binding, because the
 * run settles its verbosity before configuration. `carried` is the identity of the installed
 * source's binding when the option's extension record carries it, and `undefined` otherwise.
 */
function checkVerbosityBinding(
  config: OptionConfig,
  site: FactSite,
  carried: string | undefined,
): void {
  const marked = verbosityMarks.find((mark) => isMarked(config, mark));
  if (marked === undefined || carried === undefined) {
    return;
  }
  throw factFault(marked.rule, site, {
    correction: 'Remove the binding; the run settles its verbosity before configuration.',
    fact: 'extensions',
    sentence: `${site.subject} declares ${marked.fact} and carries configuration binding ${quoted(carried)}, a second source for the run's verbosity.`,
  });
}

/** The declared names of the graph's verbose-marked and quiet-marked options, either one absent. */
interface MarkedNames {
  readonly verbose: string | undefined;
  readonly quiet: string | undefined;
}

/** The marked options' names, or `undefined` when the graph carries neither mark. */
function markedNames(graph: BuiltGraph): MarkedNames | undefined {
  const named = (mark: Mark) =>
    graph.globals.inputs.find((input) => isMarked(input.config, mark))?.name;
  const names = { quiet: named(quiet), verbose: named(verbose) };
  return names.verbose === undefined && names.quiet === undefined ? undefined : names;
}

/**
 * The verbosity the global values read: the verbose count, read as 2 above 2, less the quiet
 * count, read as 1 above 1. A mark no option carries counts 0.
 */
function verbosityOf(values: OptionValues, names: MarkedNames): number {
  const count = (name: string | undefined) =>
    name === undefined ? 0 : (values.counts.get(name) ?? 0);
  return Math.min(count(names.verbose), loudest) - Math.min(count(names.quiet), quietest);
}

/**
 * The run's verbosity, read from the graph's global values that `read` produces, or 0 when the
 * graph carries no mark or the words name an unknown command, a run that fails in routing.
 */
function settleWith(graph: BuiltGraph, read: () => { values: { globals: OptionValues } }): number {
  const names = markedNames(graph);
  if (names === undefined) {
    return 0;
  }
  try {
    return verbosityOf(read().values.globals, names);
  } catch (error) {
    if (error instanceof UnknownCommandError) {
      return 0;
    }
    throw error;
  }
}

/**
 * The verbosity argv settles, read against the built graph with the parser's own word reader in the
 * partial mode `locate` reads with, so every form reads as the ordinary parse reads it and an
 * occurrence the parse faults counts nothing.
 */
function argvVerbosity(graph: BuiltGraph, argv: readonly string[]): number {
  return settleWith(graph, () => readWords(graph, argv, { partial: true }));
}

/**
 * The verbosity an invocation by name settles from the values it lowers, so `verbose: 2` reads as
 * `-vv` does and a value the call cannot lower counts nothing.
 */
function namedVerbosity(graph: BuiltGraph, call: NamedCall): number {
  return settleWith(graph, () => lowerInvocation(graph, call, () => undefined));
}

export { argvVerbosity, checkVerbosity, checkVerbosityBinding, namedVerbosity, quiet, verbose };
