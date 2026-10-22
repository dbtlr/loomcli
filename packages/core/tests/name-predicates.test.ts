import {
  Application,
  Command,
  DeclarationError,
  isDeclaredName,
  isPortableName,
} from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

/** The fault a declaration throws, or `undefined` when it is accepted. */
function declarationFault(declare: () => unknown): DeclarationError | undefined {
  try {
    declare();
  } catch (error) {
    return error instanceof DeclarationError ? error : undefined;
  }
  return undefined;
}

test('isPortableName accepts the POSIX portable filename set and rejects a leading hyphen or dot', () => {
  expect(['build', 'Build_2', 'a.b-c', '_x'].map(isPortableName)).toEqual([true, true, true, true]);
  expect(['', '-x', '.x', 'a b', 'a/b', 'é'].map(isPortableName)).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
});

test('isDeclaredName accepts a bare token and rejects an empty name, a leading hyphen, whitespace, and =', () => {
  expect(['verbose', 'dry-run', 'a.b', 'é', '1'].map(isDeclaredName)).toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
  expect(['', '-v', 'a b', 'a=b', 'a\tb'].map(isDeclaredName)).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
});

test('core rejects exactly the names isPortableName rejects, for a Command, an Application, and an alias', () => {
  for (const name of ['ok', 'a b', '-x']) {
    const rejected = !isPortableName(name);
    expect(declarationFault(() => new Command(name)) !== undefined).toBe(rejected);
    expect(declarationFault(() => new Application(name)) !== undefined).toBe(rejected);
    expect(declarationFault(() => new Command('base').alias(name)) !== undefined).toBe(rejected);
  }
});

test('core rejects exactly the names isDeclaredName rejects, for an option, an argument, and an option alias', () => {
  const base = new Command('base');
  const config = { description: 'One line.', type: 'string' };
  for (const name of ['ok', 'a b', '-x', 'a=b']) {
    const rejected = !isDeclaredName(name);
    // Reflect.apply passes a name the call's types would refuse, as JavaScript would.
    const declarations = [
      () => Reflect.apply(base.option, base, [name, config]),
      () => Reflect.apply(base.argument, base, [name, config]),
      () => Reflect.apply(base.option, base, ['x', { ...config, aliases: [name] }]),
    ];
    expect(declarations.map((declare) => declarationFault(declare) !== undefined)).toEqual([
      rejected,
      rejected,
      rejected,
    ]);
  }
});
