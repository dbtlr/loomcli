import { LoomError } from '@loomcli/core';
import { z } from 'zod';

/** The lowest code a failure class may declare, since 0 is success. */
const firstDeclarable = 1;

/** The first code no failure class may declare, as core's own check reads it. */
const firstReserved = 126;

/** Whether a value is a class that extends `LoomError`, read by its `prototype` as core reads it. */
function isFailureClass(value: unknown): value is { readonly name: string } {
  return (
    typeof value === 'function' && 'prototype' in value && value.prototype instanceof LoomError
  );
}

/** Whether a declared static is a code a failure may exit with: a whole number from 1 through 125. */
function isDeclarableCode(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= firstDeclarable &&
    value < firstReserved
  );
}

/** Core's sentence for a class whose declared code no failure may exit with, as it reads it. */
function undeclarableMessage(className: string, declared: unknown): string {
  const clause =
    typeof declared === 'number' && Number.isFinite(declared)
      ? `declares exit code ${String(declared)}.`
      : 'declares an exit code that is not a finite number.';
  return `Failure class "${className}" ${clause} Declare a whole number from 1 through 125; 0 means success, and 126 and above belong to the shell and to signals.`;
}

/**
 * A failure class, output as the exit code it declares. The class's static is read when the value
 * is made, walking to the nearest ancestor that declares one, so no failure is constructed and the
 * class itself never reaches the graph. Its input type is `unknown`, because no typed path names a
 * class without an assertion, so a value that is not a failure class is rejected at run time alone.
 */
const failure = z.unknown().transform((value, context) => {
  if (!isFailureClass(value)) {
    context.addIssue({
      code: 'custom',
      message: 'Supply a failure class, a class that extends LoomError.',
    });
    return z.NEVER;
  }
  const declared: unknown = Reflect.get(value, 'exitCode');
  if (!isDeclarableCode(declared)) {
    context.addIssue({ code: 'custom', message: undeclarableMessage(value.name, declared) });
    return z.NEVER;
  }
  return declared;
});

/**
 * A failure's name, written by the author because a class name does not survive a minifying build:
 * lowercase words of letters and digits, joined by single hyphens.
 */
const failureName = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, {
  message: 'Supply a kebab-case name: lowercase letters and digits in words joined by hyphens.',
});

export { failure, failureName };
