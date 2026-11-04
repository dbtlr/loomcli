import type { OptionConfig, StandardSchemaV1 } from '@loomcli/core';
import { Application, Command, validateLinkedValue } from '@loomcli/core';
import { interaction } from '@loomcli/plugins/interaction';
import type { ChoiceSource } from '@loomcli/prompts';
import { confirm, multiselect, secret, select, text } from '@loomcli/prompts';
import { answeredLine, cancelledLine, questionFrame } from '@loomcli/prompts/views';
import { z } from 'zod';

/**
 * `true` exactly when the two types are the same type. An annotation alone would also accept an
 * inferred `never` or `any`, so the answer checks below compare with this instead.
 */
type Equal<Left, Right> =
  (<Probe>(probe: Probe) => Probe extends Left ? 1 : 2) extends <Probe>(
    probe: Probe,
  ) => Probe extends Right ? 1 : 2
    ? true
    : false;

const callableSchema = Object.assign((value: string) => value, {
  '~standard': {
    validate: (value: unknown) =>
      typeof value === 'string'
        ? { value: value.toUpperCase() }
        : { issues: [{ message: 'Use text.' }] },
    vendor: 'example',
    version: 1,
  },
} satisfies StandardSchemaV1<string, string>);

new Application('setup', { plugins: [interaction({ env: ['APP_INPUT', 'INPUT'] })] }).globalOption(
  'ask',
  { interaction: true, type: 'boolean' },
);
new Command('setup')
  .option('port', {
    required: 'non-interactive',
    type: 'string',
    validate: z.string().transform(Number),
  })
  .option('install', { type: 'boolean' })
  .option('optional', { type: 'string', validate: z.string().transform(() => undefined) })
  .action(async (context) => {
    const listen: number | undefined = await text(context, {
      message: 'Port',
      option: 'port',
      validate: z.string().transform(Number),
    });
    const mixed: string | number | undefined = await text(context, {
      message: 'Port',
      option: 'port',
    });
    const bare: string = await text(context, { message: 'Name' });
    const callable: string = await text(context, {
      message: 'Uppercase name',
      validate: callableSchema,
    });
    const token: number = await secret(context, {
      message: 'PIN',
      validate: z.string().transform(Number),
    });
    const install: boolean = await confirm(context, { message: 'Install?', option: 'install' });
    const mode: 'a' | 'b' = await select(context, {
      choices: ['a', 'b'],
      default: 'a',
      message: 'Mode',
    });
    const optional: string | undefined = await text(context, {
      message: 'Optional',
      option: 'optional',
    });
    await context.out.draw({ answer: bare, message: 'Name' }, answeredLine);
    await context.out.draw({ message: 'Name' }, cancelledLine);
    await context.out.draw(
      { hint: undefined, issue: undefined, kind: 'secret', message: 'PIN', typed: '' },
      questionFrame,
    );
    // @ts-expect-error TS2322: A linked answer retains the option output's undefined.
    const required: number = await text(context, {
      message: 'Port',
      option: 'port',
      validate: z.string().transform(Number),
    });
    // @ts-expect-error TS2322: The link names an option in the action context.
    await text(context, { message: 'Name', option: 'missing' });
    // @ts-expect-error TS2322: Secret has no default.
    await secret(context, { default: '1234', message: 'PIN' });
    // @ts-expect-error TS2322: A select default is one of its choices.
    await select(context, { choices: ['a', 'b'], default: 'c', message: 'Mode' });
    return { bare, callable, install, listen, mixed, mode, optional, required, token };
  });
const marked = { interaction: true, type: 'boolean' } satisfies OptionConfig;
// @ts-expect-error TS2345: A local option cannot decide run interaction.
new Command('bad').option('input', marked);
// A multiple string option and an argument may require input only outside interactive runs.
new Command('tag').option('tags', { multiple: true, required: 'non-interactive', type: 'string' });
new Command('greet').argument('name', { required: 'non-interactive' });

new Command('clone')
  .argument('url', { required: 'non-interactive', validate: z.string().transform(Number) })
  .argument('files', { required: 'non-interactive', variadic: true })
  .action(async (context) => {
    const url: number | undefined = context.args.url;
    const files: string[] = context.args.files;
    const mixed: string | number | undefined = await text(context, {
      argument: 'url',
      message: 'URL',
    });
    const numeric: number | undefined = await secret(context, {
      argument: 'url',
      message: 'URL',
      validate: z.string().transform(Number),
    });
    const selected: number | undefined | 'a' | 'b' = await select(context, {
      argument: 'url',
      choices: ['a', 'b'],
      message: 'URL',
    });
    // @ts-expect-error TS2322: An argument link names an argument in this action context.
    await text(context, { argument: 'missing', message: 'URL' });
    // @ts-expect-error TS2322: A question cannot link both kinds of input.
    await text(context, { argument: 'url', message: 'URL', option: 'x' });
    // @ts-expect-error TS2322: No argument is Boolean.
    await confirm(context, { argument: 'url', message: 'URL' });
    // @ts-expect-error TS2345: Skipping requires a linked input.
    await text(context, { message: 'URL', skipIfSupplied: true });
    return { files, mixed, numeric, selected, url };
  });

interface Repository {
  readonly name: string;
  readonly stars: number;
}
const repositories: ChoiceSource<Repository> = () => [
  { label: 'loomcli', value: { name: 'loomcli', stars: 1 } },
];

new Command('choices')
  .option('port', { type: 'string', validate: z.string().transform(Number) })
  .action(async (context) => {
    const mixed = await select(context, {
      choices: [
        'sqlite',
        { label: 'Postgres', value: 'postgres' },
        { separator: 'Hosted' },
        { disabled: true, value: 'neon' },
      ],
      message: 'Engine',
    });
    const values = await select(context, {
      choices: [
        { label: 'One', value: 1 },
        { label: 'Two', value: { id: 2 } },
      ],
      message: 'Value',
    });
    const explicit: 'a' | 'b' = await select<typeof context.options, 'a' | 'b'>(context, {
      choices: ['a', 'b'],
      message: 'Mode',
    });
    const linked = await select(context, {
      choices: ['80', '443'],
      message: 'Port',
      option: 'port',
    });
    await select(context, {
      // @ts-expect-error TS2322: A linked question takes string values.
      choices: [{ label: 'One', value: 1 }],
      message: 'Port',
      option: 'port',
    });
    // @ts-expect-error TS2322: A numeric value needs a label.
    await select(context, { choices: [{ value: 1 }], message: 'Number' });
    // @ts-expect-error TS2345: Choices and source are mutually exclusive.
    await select(context, { choices: ['a'], message: 'Mode', source: () => ['b'] });
    // @ts-expect-error TS2353: Select has no min setting.
    await select(context, { choices: ['a'], message: 'Mode', min: 1 });
    // @ts-expect-error TS2345: A source searches always, so it takes no search setting.
    await select(context, { message: 'Mode', search: true, source: () => ['a'] });
    await select(context, {
      message: 'Port',
      option: 'port',
      // @ts-expect-error TS2322: A linked source returns string values.
      source: () => [{ label: 'One', value: 1 }],
    });
    const repository = await select(context, { message: 'Repository', source: repositories });
    const exact: [
      Equal<typeof mixed, 'sqlite' | 'postgres' | 'neon'>,
      Equal<typeof values, 1 | { readonly id: 2 }>,
      Equal<typeof repository, Repository>,
      Equal<typeof linked, number | undefined>,
    ] = [true, true, true, true];
    return { exact, explicit, linked, mixed, repository, values };
  });

new Command('linked-elements')
  .option('ports', { multiple: true, type: 'string', validate: z.string().transform(Number) })
  .argument('values', { validate: z.string().transform(Number), variadic: true })
  .action(async (context) => {
    const option: StandardSchemaV1.Result<number> = await validateLinkedValue(
      context,
      { message: 'Port', option: 'ports' },
      '80',
    );
    const argument: StandardSchemaV1.Result<number> = await validateLinkedValue(
      context,
      { argument: 'values', message: 'Value' },
      '1',
    );
    const list: number[] = await multiselect(context, {
      choices: ['80'],
      message: 'Ports',
      option: 'ports',
    });
    const values = await multiselect(context, {
      argument: 'values',
      message: 'Values',
      source: () => ['1'],
    });
    // @ts-expect-error TS2322: Link names a declared key.
    await validateLinkedValue(context, { message: 'Port', option: 'missing' }, '80');
    await validateLinkedValue(
      context,
      // @ts-expect-error TS2322: One link names exactly one input.
      { argument: 'values', message: 'Port', option: 'ports' },
      '80',
    );
    const exact: [
      Equal<typeof option, StandardSchemaV1.Result<number>>,
      Equal<typeof list, number[]>,
      Equal<typeof values, number[]>,
    ] = [true, true, true];
    return { argument, exact, list, option, values };
  });

new Command('split')
  .option('tags', {
    required: true,
    type: 'string',
    validate: z.string().transform((value) => value.split(',')),
  })
  .action(async (context) => {
    // A single-value input whose validated value is an array reads as a collected input's element.
    const tags = await validateLinkedValue(context, { message: 'Tags', option: 'tags' }, 'a,b');
    const exact: Equal<typeof tags, StandardSchemaV1.Result<string>> = true;
    return { exact, tags };
  });
