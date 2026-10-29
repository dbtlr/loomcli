import { strictConfigurationSchema } from '../src/rules/strict-configuration-schema.js';
import { tester } from './support.js';

const strict = { messageId: 'strict' };

/** The imports every case that calls the configuration plugin opens with. */
const imports = `import { configuration } from '@loomcli/plugins/config';
  import { z } from 'zod';`;

tester.run('strict-configuration-schema', strictConfigurationSchema, {
  invalid: [
    {
      // The reference page's example: a section declared above the call.
      code: `${imports}
        const updates = z.strictObject({ channel: z.string().optional() });
        export const { plugin, values } = configuration({
          file: '.collector.toml',
          schema: z.object({ updates: updates.optional() }),
        });`,
      errors: [{ ...strict, line: 3 }],
    },
    {
      code: `${imports}
        configuration({ file: '.tool.toml', schema: z.strictObject({ name: z.string() }) });
        configuration({ file: '.tool.toml', schema: z.object({ name: z.string() }).strict() });`,
      errors: [strict, strict],
    },
    {
      // At every depth of the expression, through a chain of method calls.
      code: `${imports}
        configuration({
          file: '.tool.toml',
          schema: z
            .object({ deep: z.object({ deeper: z.array(z.strictObject({})).optional() }).partial() })
            .optional()
            .default({}),
        });`,
      errors: [strict],
    },
    {
      // .strict() on a constant that traces to zod, and constants that hold constants.
      code: `${imports}
        const base = z.object({ name: z.string() });
        const narrow = base.strict();
        const section = { narrow: narrow.optional() };
        configuration({ file: '.tool.toml', schema: z.object(section) });`,
      errors: [{ ...strict, line: 4 }],
    },
    {
      // Every import form of zod: named strictObject, renamed, default, namespace, and mini.
      code: `import { configuration } from '@loomcli/plugins/config';
        import { strictObject, object as obj } from 'zod';
        import zd from 'zod/v4';
        import * as mini from 'zod/mini';
        import { z as zm } from 'zod/v4/mini';
        configuration({
          file: '.tool.toml',
          schema: obj({
            a: strictObject({}),
            b: zd.object({}).strict(),
            c: mini.strictObject({}),
            d: zm.strictObject({}),
          }),
        });`,
      errors: [strict, strict, strict, strict],
    },
    {
      // A renamed and a namespace import of the configuration plugin.
      code: `import { configuration as settings } from '@loomcli/plugins/config';
        import * as config from '@loomcli/plugins/config';
        import { z } from 'zod';
        settings({ file: '.a.toml', schema: z.strictObject({}) });
        config.configuration({ file: '.b.toml', schema: z.strictObject({}) });`,
      errors: [strict, strict],
    },
    {
      // Type assertions around the settings, the schema, and a strict object change nothing.
      code: `${imports}
        configuration({
          file: '.tool.toml',
          schema: (z.object({ a: z.strictObject({}) as never }) satisfies unknown) as never,
        } as const);`,
      errors: [strict],
    },
    {
      // A method that keeps an object strict carries the strict object into its result.
      code: `${imports}
        const State = z.strictObject({ channel: z.string() });
        configuration({ file: '.tool.toml', schema: z.object({ state: State.extend({}).partial() }) });`,
      errors: [{ ...strict, line: 3 }],
    },
    {
      // Zod 3 and the older mini specifier report an unknown key on the object too.
      code: `import { configuration } from '@loomcli/plugins/config';
        import { z } from 'zod/v3';
        import * as mini from 'zod/v4-mini';
        configuration({ file: '.tool.toml', schema: z.object({ a: z.strictObject({}), b: mini.strictObject({}) }) });`,
      errors: [strict, strict],
    },
    {
      // A recursive section: what z.lazy's function and a getter in an object shape return.
      code: `${imports}
        const Node = z.strictObject({ name: z.string() });
        configuration({
          file: '.tool.toml',
          schema: z.object({
            a: z.lazy(() => Node),
            b: z.lazy(() => {
              return z.strictObject({});
            }),
            get c() {
              return z.strictObject({});
            },
          }),
        });`,
      errors: [
        { ...strict, line: 3 },
        { ...strict, line: 9 },
        { ...strict, line: 12 },
      ],
    },
  ],
  valid: [
    {
      // A strict object that reaches the schema only loosened, as a field, or inside a function.
      code: `${imports}
        const State = z.strictObject({ channel: z.string(), name: z.string() });
        const meta = z.strictObject({});
        configuration({
          file: '.tool.toml',
          schema: z.object({
            a: State.loose(),
            b: State.partial().strip(),
            c: State.passthrough(),
            d: State.catchall(z.string()),
            e: State.shape.channel,
            keys: z.array(State.keyof()),
            f: z.object({ ...State.shape }),
            g: z.string().refine((value) => State.safeParse({ channel: value }).success),
            h: z.string().default(import.meta.dirname),
          }),
        });`,
    },
    {
      code: `${imports}
        const updates = z.object({ channel: z.string().optional() });
        configuration({ file: '.tool.toml', schema: z.object({ updates: updates.optional() }) });
        configuration({ file: '.tool.toml', schema: z.looseObject({}).passthrough() });`,
    },
    {
      // Valibot and ArkType name the unknown key, so the plugin drops that key alone.
      code: `import { configuration } from '@loomcli/plugins/config';
        import * as v from 'valibot';
        import { type } from 'arktype';
        configuration({ file: '.a.toml', schema: v.strictObject({ name: v.string() }) });
        configuration({ file: '.b.toml', schema: type({ '+': 'reject', name: 'string' }) });`,
    },
    {
      // A .strict() whose receiver does not trace to zod: yup's means skip coercion.
      code: `import { configuration } from '@loomcli/plugins/config';
        import { object, string } from 'yup';
        configuration({ file: '.tool.toml', schema: object({ name: string() }).strict() });`,
    },
    {
      // A strict object outside a configuration call's schema.
      code: `${imports}
        export const strictInput = z.strictObject({ name: z.string() });
        configuration({ file: '.tool.toml', schema: z.object({}), notice: z.strictObject({}) });
        other({ schema: z.strictObject({}) });
        function other(settings: unknown) { return settings; }`,
    },
    {
      // A schema the rule cannot trace: imported, a let, a parameter, or built by a call.
      code: `${imports}
        import { imported } from './schema.js';
        let later = z.strictObject({});
        configuration({ file: '.a.toml', schema: imported });
        configuration({ file: '.b.toml', schema: later });
        configuration({ file: '.c.toml', schema: build() });
        export function make(given: z.ZodObject) {
          return configuration({ file: '.d.toml', schema: given.strict() });
        }
        function build() { return z.strictObject({}); }`,
    },
    {
      // A settings object that is not a literal, or whose spread may replace the schema.
      code: `${imports}
        const settings = { file: '.a.toml', schema: z.strictObject({}) };
        configuration(settings);
        configuration({ schema: z.strictObject({}), ...{ file: '.b.toml' } });`,
    },
    {
      // A configuration that does not come from the configuration plugin.
      code: `import { configuration } from './local.js';
        import { z } from 'zod';
        configuration({ file: '.tool.toml', schema: z.strictObject({}) });`,
    },
    {
      // A zod that the source declares itself, and a key that shares a strict constant's name.
      code: `import { configuration } from '@loomcli/plugins/config';
        import { z as real } from 'zod';
        const strictSection = real.strictObject({});
        const z = { strictObject: (shape: object) => shape };
        configuration({ file: '.tool.toml', schema: real.object({ strictSection: real.string() }) });
        configuration({ file: '.tool.toml', schema: z.strictObject({}) });`,
    },
    {
      // A type that names a strict constant is not part of the schema's value.
      code: `${imports}
        const strictSection = z.strictObject({});
        configuration({ file: '.tool.toml', schema: z.object({}) as z.ZodType<typeof strictSection> });`,
    },
    {
      // A constant that names itself, through the function z.lazy takes, ends the walk.
      code: `${imports}
        const loop: z.ZodType = z.lazy(() => z.object({ next: loop.optional() }));
        configuration({ file: '.tool.toml', schema: loop });`,
    },
  ],
});
