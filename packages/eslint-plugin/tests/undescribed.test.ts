import { undescribed } from '../src/rules/undescribed.js';
import { coreImport, tester } from './support.js';

const missing = (subject: string) => ({ data: { subject }, messageId: 'undescribed' });

tester.run('undescribed', undescribed, {
  invalid: [
    {
      code: `${coreImport}\nnew Command('build');`,
      errors: [{ ...missing('Command "build"'), column: 5, line: 2 }],
    },
    {
      code: `${coreImport} new Command('build', {});`,
      errors: [missing('Command "build"')],
    },
    {
      code: `${coreImport} new Command('build', { hidden: true, deprecated: 'Use test.' });`,
      errors: [missing('Command "build"')],
    },
    {
      code: `${coreImport} new Application('tool');`,
      errors: [missing('Application "tool"')],
    },
    {
      code: `${coreImport} new Application('tool', { version: '1.0.0' });`,
      errors: [missing('Application "tool"')],
    },
    {
      // A description written as `undefined` is the absent one core reads.
      code: `${coreImport} new Application('tool', { description: undefined });`,
      errors: [missing('Application "tool"')],
    },
    {
      code: `${coreImport}
        const app = new Application('tool', { description: 'Tool.' });
        export const next = app
          .option('verbose', { type: 'boolean' })
          .argument('file', { type: 'string' })
          .globalOption('color', { type: 'boolean' })
          .stdin({ required: true });`,
      errors: [
        missing('Option "verbose"'),
        missing('Argument "file"'),
        missing('Global option "color"'),
        missing('Stdin'),
      ],
    },
    {
      // A hidden or deprecated member answers the same rule, as it does in core.
      code: `${coreImport}
        new Command('x', { description: 'X.' }).option('old', { deprecated: 'Use new.', hidden: true, type: 'boolean' });`,
      errors: [missing('Option "old"')],
    },
    {
      code: `import { Command as Cmd } from '@loomcli/core';
        const base = new Cmd('base', { description: 'Base.' });
        base.option('quiet', { type: 'boolean' });
        export default base;`,
      errors: [missing('Option "quiet"')],
    },
    {
      code: `import * as loom from '@loomcli/core';
        new loom.Command('base');`,
      errors: [missing('Command "base"')],
    },
    {
      // A template with no substitution is a literal name.
      code: 'import { Command } from "@loomcli/core"; new Command(`build`);',
      errors: [missing('Command "build"')],
    },
    {
      // A name that is not a literal still reports, under the kind alone.
      code: `${coreImport}
        const name = 'build';
        new Command(name);`,
      errors: [missing('Command')],
    },
    {
      code: `${coreImport}
        const base = new Command('base', { description: 'Base.' });
        base.option('count', { type: 'integer', aliases: ['n'] });`,
      errors: [missing('Option "count"')],
    },
    {
      // TypeScript syntax: an annotation, an assertion on the configuration, and a satisfies.
      code: `${coreImport}
        const base: Command = new Command('base', { description: 'Base.' } as const);
        base.option('a', { type: 'boolean' } as const).option('b', { type: 'boolean' } satisfies object);
        (base as Command).option('c', { type: 'boolean' });`,
      errors: [missing('Option "a"'), missing('Option "b"'), missing('Option "c"')],
    },
    {
      // A plugin's own options are linted where the plugin is declared.
      code: `import { plugin } from '@loomcli/core';
        export default plugin('acme/log', {
          options: {
            logFile: { type: 'string', description: 'Where to log.' },
            logLevel: { type: 'string' },
            'log-format': { type: 'string' },
          },
        });`,
      errors: [missing('Plugin option "logLevel"'), missing('Plugin option "log-format"')],
    },
    {
      code: `import * as core from '@loomcli/core';
        core.plugin('acme/log', { options: { logLevel: { type: 'string' } } } as const);`,
      errors: [missing('Plugin option "logLevel"')],
    },
  ],
  valid: [
    {
      code: `${coreImport}
        const app = new Application('tool', { description: 'Tool.' })
          .option('verbose', { description: 'Talk.', type: 'boolean' })
          .argument('file', { description: 'A file.', type: 'string' })
          .globalOption('color', { description: 'Color.', type: 'boolean' })
          .stdin({ description: 'Input.', required: true })
          .command(new Command('run', { description: 'Run.' }));
        export default app;`,
    },
    {
      // A shorthand, a variable, and a conditional all supply a description the rule cannot read.
      code: `${coreImport}
        const description = 'Run.';
        new Command('run', { description });
        new Command('run', { description: describe() });
        new Command('run', { description: flag ? 'A' : undefined });
        new Application('tool', { 'description': 'Tool.' });
        new Application('tool', { description: \`Tool.\` });`,
    },
    {
      // A renamed import and a namespace import that are described.
      code: `import { Command as Cmd } from '@loomcli/core';
        import * as loom from '@loomcli/core';
        new Cmd('a', { description: 'A.' });
        new loom.Command('b', { description: 'B.' });`,
    },
    {
      // Anything the rule cannot trace gets no report: spreads, other values, computed keys.
      code: `${coreImport}
        const shared = { description: 'Shared.' };
        const base = new Command('base', { description: 'Base.' });
        new Command('a', { ...shared });
        new Command('b', shared);
        new Command('c', makeOptions());
        new Command('d', { [key]: 'Run.' });
        new Command(...names);
        new Application('e', ...rest);
        base.option('f', { ...shared, type: 'boolean' });
        base.option('g', shared);
        base.option('h', { type: 'boolean', ...shared });
        base.option(...names);
        base.option('i', ...rest);
        base.stdin(shared);
        base.argument('j', { [key]: 'A file.' });`,
    },
    {
      // Receivers the rule cannot follow to a declaration.
      code: `${coreImport}
        export function extra(base: Command, other: ReturnType<typeof make>) {
          base.option('verbose', { type: 'boolean' });
          other.option('verbose', { type: 'boolean' });
        }
        let reassigned = new Command('x', { description: 'X.' });
        reassigned.option('a', { type: 'boolean' });
        const { destructured } = make();
        destructured.option('a', { type: 'boolean' });
        function make() { return { destructured: new Command('y', { description: 'Y.' }) }; }`,
    },
    {
      // Methods that are not authoring calls, and a computed method.
      code: `${coreImport}
        const base = new Command('base', { description: 'Base.' });
        base.exclusive('a', 'b');
        base.alias('b');
        base.inspect();
        base['option']('a', {});`,
    },
    {
      // A Command that does not come from @loomcli/core.
      code: `import { Command } from 'commander';
        const program = new Command('program');
        program.option('-v', 'verbose');`,
    },
    {
      code: `class Command { constructor(name) {} option() { return this; } }
        const base = new Command('base');
        base.option('verbose', {});`,
    },
    {
      code: `import { Command } from '@loomcli/core';
        function make(Command: new (name: string) => unknown) { return new Command('x'); }`,
    },
    {
      // A plugin whose options the source does not spell out, or whose options are described.
      code: `import { plugin } from '@loomcli/core';
        const options = { logLevel: { type: 'string' } };
        plugin('acme/a', { options });
        plugin('acme/b', { options: { ...options } });
        plugin('acme/c', { options: options });
        plugin('acme/d', { options: { logLevel: sharedOption } });
        plugin('acme/e', { options: { logLevel: { type: 'string', description: 'Level.' } } });
        plugin('acme/f', { ...shared });
        plugin('acme/g', definition);
        plugin('acme/h', { theme: {} });`,
    },
    {
      // A plugin() that is not core's.
      code: `import { plugin } from 'other';
        plugin('acme/log', { options: { logLevel: { type: 'string' } } });`,
    },
  ],
});
