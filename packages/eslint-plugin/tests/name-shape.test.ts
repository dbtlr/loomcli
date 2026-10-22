import { Command, DeclarationError } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { nameShape } from '../src/rules/name-shape.js';
import { coreImport, tester } from './support.js';

const portable = (subject: string, name: string) => ({
  data: { name: JSON.stringify(name), subject },
  messageId: 'portable',
});
const declared = (subject: string, name: string) => ({
  data: { name: JSON.stringify(name), subject },
  messageId: 'declared',
});

const described = "{ description: 'One line.', type: 'string' }";

tester.run('name-shape', nameShape, {
  invalid: [
    {
      code: `${coreImport}\nnew Command('bad name', { description: 'D.' });`,
      errors: [{ ...portable('Command', 'bad name'), column: 13, line: 2 }],
    },
    {
      code: `${coreImport} new Command('-x'); new Command(''); new Command('.hidden'); new Command('a/b');`,
      errors: [
        portable('Command', '-x'),
        portable('Command', ''),
        portable('Command', '.hidden'),
        portable('Command', 'a/b'),
      ],
    },
    {
      code: `${coreImport} new Application('my tool', { description: 'D.' });`,
      errors: [portable('Application', 'my tool')],
    },
    {
      code: 'import { Command } from "@loomcli/core"; new Command(`two words`);',
      errors: [portable('Command', 'two words')],
    },
    {
      code: `${coreImport}
        new Command('base', { description: 'D.' }).alias('good', 'not good', '-bad');`,
      errors: [portable('Alias', 'not good'), portable('Alias', '-bad')],
    },
    {
      code: `${coreImport}
        new Command('base', { description: 'D.' })
          .option('has space', ${described})
          .option('-leading', ${described})
          .option('a=b', ${described})
          .option('', ${described})
          .argument('also bad', ${described});`,
      errors: [
        declared('Option', 'has space'),
        declared('Option', '-leading'),
        declared('Option', 'a=b'),
        declared('Option', ''),
        declared('Argument', 'also bad'),
      ],
    },
    {
      code: `${coreImport}
        new Application('tool', { description: 'D.' }).globalOption('bad name', ${described});`,
      errors: [declared('Option', 'bad name')],
    },
    {
      code: `${coreImport}
        new Application('tool', { description: 'D.' })
          .globalOption('color', { description: 'D.', type: 'boolean', aliases: ['c', 'bad alias'] });`,
      errors: [declared('Option alias', 'bad alias')],
    },
    {
      code: `${coreImport}
        const base = new Command('base', { description: 'D.' });
        export default base.option('count', { description: 'D.', type: 'integer', aliases: ['n', 'bad alias', '--x'] });`,
      errors: [declared('Option alias', 'bad alias'), declared('Option alias', '--x')],
    },
    {
      code: `import { Command as Cmd } from '@loomcli/core';
        new Cmd('bad name');`,
      errors: [portable('Command', 'bad name')],
    },
    {
      code: `import * as loom from '@loomcli/core';
        const base = new loom.Command('bad name');
        export default base.option('a b', {});`,
      errors: [portable('Command', 'bad name'), declared('Option', 'a b')],
    },
    {
      // TypeScript syntax: assertions around the receiver, the name, and the configuration.
      code: `${coreImport}
        const base: Command = new Command('base' as string, { description: 'D.' });
        (base as Command).alias('bad alias' as const);
        base!.option('bad name' satisfies string, { aliases: ['bad alias'] as const });`,
      errors: [
        portable('Alias', 'bad alias'),
        declared('Option', 'bad name'),
        declared('Option alias', 'bad alias'),
      ],
    },
  ],
  valid: [
    {
      code: `${coreImport}
        const base = new Command('build', { description: 'D.' }).alias('b', 'make.it', 'a_b-c');
        base.option('dry-run', ${described}).option('count', { type: 'integer', aliases: ['n', 'num'] });
        base.argument('file', ${described});
        new Application('my-tool', { description: 'D.' }).globalOption('color', ${described});`,
    },
    {
      // Names the rule cannot read: variables, templates with substitutions, spreads, computed keys.
      code: `${coreImport}
        const name = 'bad name';
        const base = new Command(name);
        new Command(\`\${name}\`);
        new Command(...names);
        new Command(makeName());
        base.alias(name, ...aliases, \`a\${name}\`);
        base.option(name, {});
        base.option(...args);
        base.option('count', { ...shared });
        base.option('count', { aliases });
        base.option('count', { aliases: [...aliases, name] });
        base.option('count', { aliases: [name] });
        base.option('count', { [key]: ['bad alias'] });
        base.option('count', shared);
        base.option('count');`,
    },
    {
      // An alias on an argument or on a call that takes none is not read as an option alias.
      code: `${coreImport}
        const base = new Command('build', { description: 'D.' });
        base.argument('file', { aliases: ['bad alias'] });
        base.command(new Command('child'));
        base.exclusive('a b', 'c d');`,
    },
    {
      // Receivers the rule cannot follow to a declaration, and constructors that are not core's.
      code: `import { Command } from '@loomcli/core';
        import { Command as Other } from 'commander';
        export function extra(base: Command, other: unknown) {
          base.option('has space', {});
          base.alias('bad alias');
          new Other('bad name');
        }
        class Application { constructor(name) {} }
        new Application('bad name');`,
    },
  ],
});

/** Core's own correction for the declaration the callback throws. */
function correctionOf(declare: () => unknown): unknown {
  try {
    declare();
  } catch (error) {
    if (error instanceof DeclarationError) {
      return error.correction;
    }
  }
  return undefined;
}

/**
 * Calls a method with arguments its types would refuse, as JavaScript would. The target is
 * `unknown`, so the checker never infers Reflect.apply's generic overload from `option()`'s
 * signature, whose constraints expand until the checker runs out of memory.
 */
function applyUnchecked(target: unknown, receiver: unknown, args: unknown[]): unknown {
  if (typeof target !== 'function') {
    throw new TypeError('Expected a function');
  }
  return Reflect.apply(target, receiver, args);
}

/** The message the rule reports under one id. */
function messageOf(id: string): string {
  return nameShape.meta?.messages?.[id] ?? '';
}

test('the portable-name message ends with the correction core gives', () => {
  const correction = correctionOf(() => new Command('bad name'));
  expect(correction).toEqual(expect.any(String));
  expect(messageOf('portable').endsWith(String(correction))).toBe(true);
});

test('the declared-name message ends with the correction core gives', () => {
  const base = new Command('base');
  const correction = correctionOf(() =>
    applyUnchecked(base.option, base, ['bad name', { description: 'D.', type: 'string' }]),
  );
  expect(correction).toEqual(expect.any(String));
  expect(messageOf('declared').endsWith(String(correction))).toBe(true);
});
