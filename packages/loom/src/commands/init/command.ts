import { Command } from '@loomcli/core';
import { createValidator } from '@loomcli/validators';

import { defaultTooling, linters, testRunners } from '../../helpers/tooling.js';

/*
 * The action imports its work when it runs, so a run of any other command, help included, loads
 * none of it.
 */

/** The pieces init writes, in the order it writes them. */
const pieces = [
  'package',
  'application',
  'entry',
  'tsconfig',
  'test',
  'lint',
  'changes',
  'skill',
  'install',
] as const;

/**
 * A validator for one value of a string option out of a fixed set. A multiple option validates each
 * value as the string the operator typed, so the validator reads a string and publishes a plain
 * string, and the match against the values decides it.
 */
function choiceOption<const Value extends string>(values: readonly Value[], message: string) {
  return createValidator({
    inputSchema: { type: 'string' },
    parse: (raw) => {
      const match = values.find((each) => each === raw);
      return match === undefined ? { issues: [{ message }] } : { value: match };
    },
  });
}

/** One `--only` value. */
const pieceOption = choiceOption(
  pieces,
  'Use application, entry, tsconfig, test, lint, package, changes, skill, or install.',
);

/** One `--linter` value. */
const linterOption = choiceOption(linters, 'Use oxlint or eslint.');

/** One `--test-runner` value. */
const runnerOption = choiceOption(testRunners, 'Use bun or vitest.');

export const init = new Command('init', {
  description:
    'Scaffold a new application in an empty directory, or add the pieces a package lacks.',
})
  .option('only', {
    description:
      'Write only this piece: application, entry, tsconfig, test, lint, package, changes, skill, or install.',
    multiple: true,
    type: 'string',
    validate: pieceOption,
  })
  .option('linter', {
    default: defaultTooling.linter,
    description:
      'Wire this linter: oxlint or eslint. A lint configuration the package holds decides it, and at a terminal init asks when nothing does.',
    type: 'string',
    validate: linterOption,
  })
  .option('test-runner', {
    default: defaultTooling.runner,
    description:
      'Wire this test runner: bun or vitest. A package that declares vitest or @types/bun uses that runner, and at a terminal init asks when nothing decides.',
    type: 'string',
    validate: runnerOption,
  })
  .option('force', {
    description: 'Re-render a managed file that was edited. Scaffold files are never overwritten.',
    type: 'boolean',
  })
  .action(async (context) => {
    const { initPackage } = await import('./init.js');
    await initPackage(context);
  });

/** One piece init writes. */
export type Piece = (typeof pieces)[number];
