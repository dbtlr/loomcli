import { discardedDeclaration } from '../src/rules/discarded-declaration.js';
import { coreImport, tester } from './support.js';

const discarded = (method: string) => ({ data: { method }, messageId: 'discarded' });

tester.run('discarded-declaration', discardedDeclaration, {
  invalid: [
    {
      code: `${coreImport}
        const base = new Command('base', { description: 'Base.' });
        base.option('verbose', { description: 'Talk.', type: 'boolean' });`,
      errors: [discarded('option')],
    },
    {
      code: `${coreImport}
        new Command('base', { description: 'Base.' }).option('v', { description: 'V.', type: 'boolean' });`,
      errors: [discarded('option')],
    },
    {
      code: `${coreImport}
        const app = new Application('tool', { description: 'Tool.' });
        app.globalOption('color', { description: 'Color.', type: 'boolean' });
        app.command(new Command('run', { description: 'Run.' }));
        app.action(() => undefined);`,
      errors: [discarded('globalOption'), discarded('command'), discarded('action')],
    },
    {
      // A chain of calls is one statement, and its last call is the one that is discarded.
      code: `${coreImport}
        const base = new Command('base', { description: 'Base.' });
        base.alias('b').stdin({ description: 'In.' });`,
      errors: [discarded('stdin')],
    },
    {
      code: `${coreImport}
        const base = new Command('base', { description: 'Base.' });
        base.visibleAlias('b');`,
      errors: [discarded('visibleAlias')],
    },
    {
      code: `import { Command as Cmd } from '@loomcli/core';
        const base = new Cmd('base', { description: 'Base.' });
        const again = base;
        again.exclusive('a', 'b');`,
      errors: [discarded('exclusive')],
    },
    {
      code: `import * as loom from '@loomcli/core';
        const base = new loom.Command('base', { description: 'Base.' });
        base.oneRequired('a', 'b');`,
      errors: [discarded('oneRequired')],
    },
    {
      // TypeScript syntax: an annotation on the constant and an assertion on the receiver.
      code: `${coreImport}
        const base: Command = new Command('base', { description: 'Base.' });
        (base as Command).requiredTogether('a', 'b');
        base!.extend();`,
      errors: [discarded('requiredTogether'), discarded('extend')],
    },
    {
      code: `${coreImport}
        const base = new Command('base', { description: 'Base.' });
        function build() {
          base.result<string>({ views: {} });
          base.rows<string>({ views: {} });
          base.views({}, {});
        }`,
      errors: [discarded('result'), discarded('rows'), discarded('views')],
    },
    {
      // Applying a set returns a new Command, and a set's group call returns a new set.
      code: `import { Command, optionSet } from '@loomcli/core';
        const output = optionSet({ json: { type: 'boolean' }, yaml: { type: 'boolean' } });
        output.exclusive('json', 'yaml');
        output.oneRequired('json', 'yaml').requiredTogether('json', 'yaml');
        const base = new Command('base', { description: 'Base.' });
        base.options(output);`,
      errors: [discarded('exclusive'), discarded('requiredTogether'), discarded('options')],
    },
    {
      code: `import { optionSet as set } from '@loomcli/core';
        set({ json: { type: 'boolean' }, yaml: { type: 'boolean' } }).exclusive('json', 'yaml');`,
      errors: [discarded('exclusive')],
    },
    {
      // A requirement is an authoring call on a Command and on an option set.
      code: `import { Command, optionSet } from '@loomcli/core';
        const login = new Command('login', { description: 'Sign in.' });
        login.requires('password', 'user');
        optionSet({ password: { type: 'string' }, user: { type: 'string' } }).requires('password', 'user');`,
      errors: [discarded('requires'), discarded('requires')],
    },
    {
      code: `import * as loom from '@loomcli/core';
        const output = loom.optionSet({ json: { type: 'boolean' }, yaml: { type: 'boolean' } });
        const grouped = output;
        grouped.exclusive('json', 'yaml');
        new loom.Application('tool').options(grouped);`,
      errors: [discarded('exclusive'), discarded('options')],
    },
  ],
  valid: [
    {
      code: `${coreImport}
        const base = new Command('base', { description: 'Base.' });
        const next = base.option('verbose', { description: 'Talk.', type: 'boolean' });
        export const chained = base.alias('b').alias('c');
        export default base.stdin({ description: 'In.' });`,
    },
    {
      // A value the source cannot trace gets no report.
      code: `${coreImport}
        export function extra(base: Command, other: ReturnType<typeof make>) {
          base.option('verbose', { type: 'boolean' });
          other.option('verbose', { type: 'boolean' });
        }
        let reassigned = new Command('x', { description: 'X.' });
        reassigned.option('a', { type: 'boolean' });
        const { destructured } = make();
        destructured.option('a', { type: 'boolean' });
        function make() { return { destructured: new Command('y') }; }`,
    },
    {
      // A set that is kept, and an optionSet that does not come from @loomcli/core.
      code: `import { Command, optionSet } from '@loomcli/core';
        import { optionSet as other } from 'elsewhere';
        const output = optionSet({ json: { type: 'boolean' }, yaml: { type: 'boolean' } });
        export const grouped = output.exclusive('json', 'yaml');
        export const list = new Command('list').options(grouped);
        other({}).exclusive('a', 'b');`,
    },
    {
      // A deliberate discard is not an oversight.
      code: `${coreImport}
        const base = new Command('base', { description: 'Base.' });
        void base.option('verbose', { type: 'boolean' });`,
    },
    {
      // Methods that do not return a declaration, and a computed method name.
      code: `${coreImport}
        const app = new Application('tool', { description: 'Tool.' });
        app.run();
        app.inspect();
        app['option']('a', {});`,
    },
    {
      // A Command that does not come from @loomcli/core.
      code: `import { Command } from 'commander';
        const program = new Command('program');
        program.option('-v', 'verbose');`,
    },
    {
      code: `class Command { option() { return this; } }
        const base = new Command('base');
        base.option('verbose');`,
    },
    {
      // A constant that names itself ends the walk.
      code: `${coreImport}
        const loop = loop.option('a', {});`,
    },
    {
      // A shadowing parameter hides the imported constructor.
      code: `import { Command } from '@loomcli/core';
        function make(Command: new () => { option(): void }) {
          const base = new Command();
          base.option();
        }`,
    },
  ],
});
