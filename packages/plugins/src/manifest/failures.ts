import { LoomError } from '@loomcli/core';
import { z } from 'zod';

/** The lowest code a failure class may declare, since 0 is success. */
const firstDeclarable = 1;

/**
 * The first code no failure class may declare.
 * It mirrors core's own check under Declared exit codes, which core does not export.
 */
const firstReserved = 126;

/**
 * Whether a value is a class that extends `LoomError`, read by its `prototype` as core reads it.
 * A read that throws, such as a proxy's, answers `false`, since the value cannot be read as a class.
 */
function isFailureClass(value: unknown): value is object {
  try {
    return (
      typeof value === 'function' && 'prototype' in value && value.prototype instanceof LoomError
    );
  } catch {
    return false;
  }
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

/**
 * Core's sentence for a class whose declared code no failure may exit with.
 * It mirrors, word for word, the sentence core throws when such a class is constructed.
 * Core does not export that sentence, so a test compares the two for one class.
 */
function undeclarableMessage(className: string, declared: unknown): string {
  const clause =
    typeof declared === 'number' && Number.isFinite(declared)
      ? `declares exit code ${String(declared)}.`
      : 'declares an exit code that is not a finite number.';
  return `Failure class "${className}" ${clause} Declare a whole number from 1 through 125; 0 means success, and 126 and above belong to the shell and to signals.`;
}

/**
 * One static of a failure class, walking to the nearest ancestor that declares it. A static getter
 * that throws answers `undefined`: a throw inside a zod transform makes zod retry the parse
 * asynchronously, which core rejects with the wrong fault and whose rejected retry nothing handles.
 */
function readStatic(failureClass: object, key: 'exitCode' | 'name'): unknown {
  try {
    return Reflect.get(failureClass, key);
  } catch {
    return undefined;
  }
}

/**
 * The name core gives a failure class in its sentence, its constructor's `name`.
 * A static `name` that throws or is not a string reads as the empty name an anonymous class has.
 */
function classNameOf(failureClass: object): string {
  const name = readStatic(failureClass, 'name');
  return typeof name === 'string' ? name : '';
}

/**
 * A failure class, output as the exit code it declares. The class's static is read when the value
 * is made, so no failure is constructed and the class itself never reaches the graph. Every read of
 * the class is guarded, so the author's throw never escapes into zod. Its input type is `unknown`,
 * because no typed path names a class without an assertion, so a value that is not a failure class
 * is rejected at run time alone.
 */
const failure = z.unknown().transform((value, context) => {
  if (!isFailureClass(value)) {
    context.addIssue({
      code: 'custom',
      message: 'Supply a failure class, a class that extends LoomError.',
    });
    return z.NEVER;
  }
  const declared = readStatic(value, 'exitCode');
  if (!isDeclarableCode(declared)) {
    context.addIssue({
      code: 'custom',
      message: undeclarableMessage(classNameOf(value), declared),
    });
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
