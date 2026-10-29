import { Application, DeclarationError, plugin } from '@loomcli/core';
import { color } from '@loomcli/plugins/color';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { z } from 'zod';

import { ruleText } from './rule-text.mjs';

/** The configuration plugin for a fixture that binds options to a file: a loose schema, and the given settings. */
const configPlugin = (settings = {}) =>
  configuration({ ...settings, schema: z.record(z.string(), z.unknown()) }).plugin;

/** One marked Boolean global option, as an application declares its own. */
const marked = { color: true, polarity: 'both', type: 'boolean' };

/** A plugin that declares one option, under its own identity. */
const declaring = (options) => plugin('@fixture/paint', { options });

/**
 * Each scenario as the steps it takes, each step one declaring call, so the outcome names the
 * call that threw: the step's label, then the fault's rule and its text.
 */
const scenarios = {
  'binding-global': [
    ['new Application', () => new Application('notes', { plugins: [configPlugin()] })],
    [
      'globalOption',
      (app) =>
        app.globalOption('color', { ...marked, extensions: [configInput({ path: 'color' })] }),
    ],
  ],
  'binding-inert': [
    [
      'globalOption',
      () =>
        new Application('notes').globalOption('color', {
          ...marked,
          extensions: [configInput({ path: 'color' })],
        }),
    ],
  ],
  'binding-plugin': [
    [
      'plugin',
      () =>
        plugin('@fixture/paint', {
          extensions: [configInput],
          options: { color: { ...marked, extensions: [configInput({ path: 'color' })] } },
        }),
    ],
    ['new Application', (paint) => new Application('notes', { plugins: [configPlugin(), paint] })],
  ],
  boolean: [['globalOption', () => new Application('notes').globalOption('color', marked)]],
  'two-global': [
    ['new Application', () => new Application('notes', { plugins: [color()] })],
    ['globalOption', (app) => app.globalOption('paint', marked)],
  ],
  'two-own': [
    ['new Application', () => new Application('notes').globalOption('paint', marked)],
    ['globalOption', (app) => app.globalOption('tint', marked)],
  ],
  'two-plugins': [
    ['plugin', () => declaring({ paint: marked })],
    ['new Application', (paint) => new Application('notes', { plugins: [paint, color()] })],
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

/** The `color` fact `inspect()` publishes on each global option of an application that marks one. */
function inspected() {
  const graph = new Application('notes', { plugins: [color()] })
    .globalOption('quiet', { type: 'boolean' })
    .globalOption('tint', { type: 'string' })
    .action(() => undefined)
    .inspect();
  return graph.globals.map((node) => [node.name, node.color]);
}

const [scenario] = process.argv.slice(2);
process.stdout.write(
  JSON.stringify(scenario === 'inspect' ? inspected() : attempt(scenarios[scenario])),
);
