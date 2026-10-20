import { Application, Command, DeclarationError, plugin, style } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { theme } from '@loomcli/plugins/theme';

import { ruleText } from './rule-text.mjs';

/** The background-marked string global option, as an application declares its own. */
const marked = { background: true, type: 'string' };

/** A plugin that declares its options under its own identity. */
const declaring = (options) => plugin('@fixture/shade', { options });

/** An adaptive entry with a concrete chain on each side. */
const adaptive = () => style.adaptive({ dark: style.hex('#C97B36'), light: style.hex('#9C5A1E') });

/**
 * Each scenario as the steps it takes, each step one declaring call, so the outcome names the call
 * that threw: the step's label, then the fault's rule and its text.
 */
const scenarios = {
  'adaptive-entry': [['plugin', () => theme({ highlight: adaptive(), identifier: style.cyan })]],
  'adaptive-name': [['plugin', () => theme({ adaptive: style.cyan })]],
  alias: [
    [
      'globalOption',
      () => new Application('notes').globalOption('background', { ...marked, aliases: ['bg'] }),
    ],
  ],
  'binding-global': [
    ['new Application', () => new Application('notes', { plugins: [config()] })],
    [
      'globalOption',
      (app) =>
        app.globalOption('background', { ...marked, extensions: [configInput({ path: 'shade' })] }),
    ],
  ],
  'binding-inert': [
    [
      'globalOption',
      () =>
        new Application('notes').globalOption('background', {
          ...marked,
          extensions: [configInput({ path: 'shade' })],
        }),
    ],
  ],
  'binding-plugin': [
    [
      'plugin',
      () =>
        plugin('@fixture/shade', {
          extensions: [configInput],
          options: {
            background: { ...marked, extensions: [configInput({ path: 'shade' })] },
          },
        }),
    ],
    ['new Application', (shade) => new Application('notes', { plugins: [config(), shade] })],
  ],
  boolean: [
    [
      'globalOption',
      () =>
        new Application('notes').globalOption('background', { background: true, type: 'boolean' }),
    ],
  ],
  content: [
    [
      'globalOption',
      () =>
        new Application('notes').globalOption('background', { background: true, type: 'content' }),
    ],
  ],
  count: [
    [
      'globalOption',
      () =>
        new Application('notes').globalOption('background', { background: true, type: 'count' }),
    ],
  ],
  default: [
    [
      'globalOption',
      () => new Application('notes').globalOption('background', { ...marked, default: 'dark' }),
    ],
  ],
  'env-global': [
    [
      'globalOption',
      () => new Application('notes').globalOption('background', { ...marked, env: 'NOTES_SHADE' }),
    ],
  ],
  'env-plugin': [['plugin', () => declaring({ background: { ...marked, env: 'NOTES_SHADE' } })]],
  implied: [
    [
      'globalOption',
      () => new Application('notes').globalOption('background', { ...marked, implied: 'dark' }),
    ],
  ],
  'local-application': [['option', () => new Application('notes').option('background', marked)]],
  'local-command': [['option', () => new Command('shade').option('background', marked)]],
  'look-alike': [
    [
      'plugin',
      () => theme({ highlight: { dark: style.hex('#C97B36'), light: style.hex('#9C5A1E') } }),
    ],
  ],
  multiple: [
    [
      'globalOption',
      () => new Application('notes').globalOption('background', { ...marked, multiple: true }),
    ],
  ],
  'not-true': [
    [
      'globalOption',
      () =>
        new Application('notes').globalOption('background', { background: 'yes', type: 'string' }),
    ],
  ],
  'not-true-plugin': [
    ['plugin', () => declaring({ background: { background: false, type: 'string' } })],
  ],
  'rendering-application': [
    ['new Application', () => new Application('notes', { rendering: { background: 'blue' } })],
  ],
  short: [
    [
      'globalOption',
      () => new Application('notes').globalOption('background', { ...marked, short: 'b' }),
    ],
  ],
  string: [['globalOption', () => new Application('notes').globalOption('background', marked)]],
  'two-global': [
    ['new Application', () => new Application('notes', { plugins: [background()] })],
    ['globalOption', (app) => app.globalOption('shade', marked)],
  ],
  'two-own': [
    ['new Application', () => new Application('notes').globalOption('shade', marked)],
    ['globalOption', (app) => app.globalOption('tint', marked)],
  ],
  'two-plugins': [
    ['plugin', () => declaring({ shade: marked })],
    ['new Application', (shade) => new Application('notes', { plugins: [shade, background()] })],
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

/** The `background` fact `inspect()` publishes on each global option. */
function inspected() {
  const graph = new Application('notes', { plugins: [background()] })
    .globalOption('name', { type: 'string' })
    .globalOption('dry', { type: 'boolean' })
    .action(() => undefined)
    .inspect();
  return graph.globals.map((node) => [node.name, node.background]);
}

/** What `style.adaptive` throws for each argument it rejects, or `ok`. */
function adaptiveFaults() {
  const values = {
    adaptive: { dark: adaptive(), light: style.red },
    applied: { dark: style.red('x'), light: style.red },
    array: [style.red, style.red],
    extra: { dark: style.red, light: style.red, muted: style.red },
    missing: { dark: style.red },
    none: undefined,
    semantic: { dark: style.info, light: style.red },
    undefined: { dark: style.red, light: undefined },
  };
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      try {
        style.adaptive(value);
        return [name, 'ok'];
      } catch (error) {
        return [name, `${error.constructor.name}: ${error.message}`];
      }
    }),
  );
}

const [scenario] = process.argv.slice(2);
let outcome = undefined;
if (scenario === 'inspect') {
  outcome = inspected();
} else if (scenario === 'adaptive') {
  outcome = adaptiveFaults();
} else {
  outcome = attempt(scenarios[scenario]);
}
process.stdout.write(JSON.stringify(outcome));
