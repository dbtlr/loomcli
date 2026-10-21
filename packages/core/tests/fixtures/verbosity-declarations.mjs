import { Application, DeclarationError, plugin } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { verbose } from '@loomcli/plugins/verbose';

import { ruleText } from './rule-text.mjs';

/** One marked counted global option of each kind, as an application declares its own. */
const marks = { quiet: { quiet: true, type: 'count' }, verbose: { type: 'count', verbose: true } };

/** A plugin that declares its options under its own identity. */
const declaring = (options) => plugin('@fixture/loud', { options });

/**
 * The scenarios one mark meets, each as the steps it takes, each step one declaring call, so the
 * outcome names the call that threw: the step's label, then the fault's rule and its text. Each
 * option is named after the mark it carries, so one table serves both marks.
 */
function scenariosOf(mark) {
  const marked = marks[mark];
  return {
    'binding-global': [
      ['new Application', () => new Application('notes', { plugins: [config()] })],
      [
        'globalOption',
        (app) =>
          app.globalOption(mark, { ...marked, extensions: [configInput({ path: 'level' })] }),
      ],
    ],
    'binding-inert': [
      [
        'globalOption',
        () =>
          new Application('notes').globalOption(mark, {
            ...marked,
            extensions: [configInput({ path: 'level' })],
          }),
      ],
    ],
    'binding-plugin': [
      [
        'plugin',
        () =>
          plugin('@fixture/loud', {
            extensions: [configInput],
            options: { [mark]: { ...marked, extensions: [configInput({ path: 'level' })] } },
          }),
      ],
      ['new Application', (loud) => new Application('notes', { plugins: [config(), loud] })],
    ],
    count: [['globalOption', () => new Application('notes').globalOption(mark, marked)]],
    short: [
      [
        'globalOption',
        () =>
          new Application('notes').globalOption(mark, {
            ...marked,
            aliases: ['level'],
            short: 'l',
          }),
      ],
    ],
    'short-only': [
      [
        'globalOption',
        () =>
          new Application('notes').globalOption(mark, { ...marked, short: 'l', shortOnly: true }),
      ],
    ],
    'two-global': [
      ['new Application', () => new Application('notes', { plugins: [verbose()] })],
      ['globalOption', (app) => app.globalOption('loud', marked)],
    ],
    'two-own': [
      ['new Application', () => new Application('notes').globalOption('loud', marked)],
      ['globalOption', (app) => app.globalOption('louder', marked)],
    ],
    'two-plugins': [
      ['plugin', () => declaring({ loud: marked })],
      ['new Application', (loud) => new Application('notes', { plugins: [loud, verbose()] })],
    ],
  };
}

/** Scenarios that read both marks at once. */
const both = {
  'verbose-alone': [
    ['globalOption', () => new Application('notes').globalOption('loud', marks.verbose)],
  ],
};

/** The outcome of one scenario: `ok`, or the step that threw with its rule and text. */
function attempt(steps) {
  let value = undefined;
  for (const [label, step] of steps) {
    try {
      value = step(value);
    } catch (error) {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      return { rule: error.rule?.identity, text: ruleText(error), threw: label };
    }
  }
  return 'ok';
}

/** The `verbose` and `quiet` facts `inspect()` publishes on each global option. */
function inspected() {
  const graph = new Application('notes', { plugins: [verbose()] })
    .globalOption('level', { type: 'count' })
    .globalOption('dry', { type: 'boolean' })
    .action(() => undefined)
    .inspect();
  return graph.globals.map((node) => [node.name, node.verbose, node.quiet]);
}

const [mark, scenario] = process.argv.slice(2);
const outcome =
  mark === 'inspect'
    ? inspected()
    : attempt(mark === 'both' ? both[scenario] : scenariosOf(mark)[scenario]);
process.stdout.write(JSON.stringify(outcome));
