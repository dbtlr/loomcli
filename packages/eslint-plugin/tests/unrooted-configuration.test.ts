import { unrootedConfiguration } from '../src/rules/unrooted-configuration.js';
import { tester } from './support.js';

const unrooted = { messageId: 'unrooted' };

/** The imports every case that calls the configuration plugin opens with. */
const imports = `import { configuration } from '@loomcli/plugins/config';
  import * as v from 'valibot';`;

tester.run('unrooted-configuration', unrootedConfiguration, {
  invalid: [
    {
      // The reference page's example: no scopes, so the call reads the project scope.
      code: `${imports}
        export const { plugin: configPlugin, values: config } = configuration({
          file: '.collector.json',
          schema: v.object({ channel: v.optional(v.string()) }),
        });`,
      errors: [{ ...unrooted, line: 3 }],
    },
    {
      // A scopes array literal that lists 'project', alone, with user, or as a template.
      code: `${imports}
        configuration({ schema: v.object({}), scopes: ['project'] });
        configuration({ schema: v.object({}), scopes: ['user', 'project'] });
        configuration({ schema: v.object({}), scopes: [\`project\`] as const });`,
      errors: [unrooted, unrooted, unrooted],
    },
    {
      // A renamed and a namespace import of the configuration plugin, and settings under assertions.
      code: `import { configuration as settings } from '@loomcli/plugins/config';
        import * as config from '@loomcli/plugins/config';
        import * as v from 'valibot';
        settings({ schema: v.object({}) });
        config.configuration({ schema: v.object({}) } as const);
        settings({ schema: v.object({}) } satisfies object);`,
      errors: [unrooted, unrooted, unrooted],
    },
  ],
  valid: [
    // A marker, a list of markers, a stated absence, and a root of any value, undefined included.
    `${imports}
      configuration({ schema: v.object({}), root: 'package.json' });
      configuration({ schema: v.object({}), root: ['package.json', '.git'] });
      configuration({ schema: v.object({}), root: false });
      configuration({ schema: v.object({}), root: undefined });
      const marker = '.git';
      configuration({ schema: v.object({}), root: marker });`,
    // Scopes that do not read the project.
    `${imports}
      configuration({ schema: v.object({}), scopes: ['user'] });
      configuration({ schema: v.object({}), scopes: ['user', 'user'] });`,
    // Settings the rule cannot read: a variable, a spread, a computed key, and scopes it cannot see.
    `${imports}
      const settings = { schema: v.object({}) };
      configuration(settings);
      configuration({ ...settings });
      const key = 'root';
      configuration({ schema: v.object({}), [key]: '.git' });
      const scopes = ['project'] as const;
      configuration({ schema: v.object({}), scopes });
      configuration({ schema: v.object({}), scopes: [...scopes] });`,
    // A configuration that does not come from the plugin.
    `import { configuration } from './configuration.js';
      configuration({ file: '.tool.json' });`,
    `function configuration(settings: object) { return settings; }
      configuration({ file: '.tool.json' });`,
  ],
});
