import { Application, DeclarationError, diagnosticRule, plugin } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { assertAssembles } from '../src/index.js';

const description = 'Assemble the probe.';

const sharedName = diagnosticRule('@fixture/testing/shared-name', {
  explanation: 'Each Command answers to a name of its own.',
  headline: 'Shared name',
});

/** A plugin whose onGraphBuilt hook rejects the graph with a fault of its own sentence. */
function rejecting(identity: string, sentence: string) {
  return plugin(identity, {
    onGraphBuilt: () => {
      throw new DeclarationError(sharedName, { sentence });
    },
  });
}

/** Catches what `assertAssembles` throws, failing the test when it returns. */
function thrownBy(application: Parameters<typeof assertAssembles>[0]): Error {
  try {
    assertAssembles(application);
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('assertAssembles returned.');
}

test('an application that assembles returns', () => {
  const application = new Application('probe', { description }).action(({ out }) =>
    out.print('ran'),
  );
  expect(assertAssembles(application)).toBeUndefined();
});

test('a build rule fault throws one Error whose message holds its diagnostic and whose cause holds it', () => {
  // A root with neither children nor an action ends the build.
  const application = new Application('probe', { description });
  const faults = application.check();
  expect(faults).toHaveLength(1);

  const error = thrownBy(application);
  expect(error.message).toContain(faults[0]?.message);
  expect(error.cause).toEqual(faults);
});

test('two collected faults throw both diagnostics in order, separated by a blank line', () => {
  const application = new Application('probe', {
    description,
    plugins: [
      rejecting('@fixture/first', 'The first hook rejects the graph.'),
      rejecting('@fixture/second', 'The second hook rejects the graph.'),
    ],
  }).action(({ out }) => out.print('ran'));
  const faults = application.check();
  expect(faults).toHaveLength(2);

  const error = thrownBy(application);
  expect(error.message).toContain(faults.map((fault) => fault.message).join('\n\n'));
  expect(error.message.indexOf('The first hook')).toBeLessThan(
    error.message.indexOf('The second hook'),
  );
  expect(error.cause).toEqual(faults);
});

test('the first line of the message counts the faults in one sentence', () => {
  const one = new Application('probe', {
    description,
    plugins: [rejecting('@fixture/first', 'The first hook rejects the graph.')],
  }).action(({ out }) => out.print('ran'));
  expect(thrownBy(one).message.split('\n')[0]).toBe('The application does not assemble: 1 fault.');

  const two = new Application('probe', {
    description,
    plugins: [
      rejecting('@fixture/first', 'The first hook rejects the graph.'),
      rejecting('@fixture/second', 'The second hook rejects the graph.'),
    ],
  }).action(({ out }) => out.print('ran'));
  expect(thrownBy(two).message.split('\n')[0]).toBe('The application does not assemble: 2 faults.');
});
