import { Application, DeclarationError, plugin, style } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { theme } from '@loomcli/plugins/theme';
import { z } from 'zod';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { stdout: writeStdout } = fixture;
  try {
    /** The configuration plugin for a fixture that binds options to a file: a loose schema, and the given settings. */

    /** The background-marked string global option, as an application declares its own. */
    const marked = { background: true, type: 'string' };

    /** A plugin that declares its options under its own identity. */

    /** An adaptive entry with a concrete chain on each side. */

    /**
     * Each scenario as the steps it takes, each step one declaring call, so the outcome names the call
     * that threw: the step's label, then the fault's rule and its text.
     */
    const scenarios = {
      'adaptive-entry': [
        ['plugin', () => theme({ highlight: adaptive(), identifier: style.cyan })],
      ],
      'adaptive-name': [['plugin', () => theme({ adaptive: style.cyan })]],
      alias: [
        [
          'globalOption',
          () => new Application('notes').globalOption('background', { ...marked, aliases: ['bg'] }),
        ],
      ],
      'binding-global': [
        ['new Application', () => new Application('notes', { plugins: [configPlugin()] })],
        [
          'globalOption',
          (app) =>
            app.globalOption('background', {
              ...marked,
              extensions: [configInput({ path: 'shade' })],
            }),
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
        [
          'new Application',
          (shade) => new Application('notes', { plugins: [configPlugin(), shade] }),
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
        [
          'new Application',
          (shade) => new Application('notes', { plugins: [shade, background()] }),
        ],
      ],
    };

    /** The outcome of one scenario: `ok`, or the step that threw with its rule and text. */

    /** The `background` fact `inspect()` publishes on each global option. */

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

    const [scenario] = fixtureWords;
    let outcome = undefined;
    if (scenario === 'inspect') {
      outcome = inspected();
    } else if (scenario === 'adaptive') {
      outcome = adaptiveFaults();
    } else {
      outcome = attempt(scenarios[scenario]);
    }
    writeStdout(JSON.stringify(outcome));
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const configPlugin = (settings = {}) =>
  configuration({ ...settings, schema: z.record(z.string(), z.unknown()) }).plugin;
const declaring = (options) => plugin('@fixture/shade', { options });
const adaptive = () => style.adaptive({ dark: style.hex('#C97B36'), light: style.hex('#9C5A1E') });
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
function inspected() {
  const graph = new Application('notes', { plugins: [background()] })
    .globalOption('name', { type: 'string' })
    .globalOption('dry', { type: 'boolean' })
    .action(() => undefined)
    .inspect();
  return graph.globals.map((node) => [node.name, node.background]);
}

export { runFixture as run };
