import type { OptionConfig, StandardSchemaV1 } from '@loomcli/core';
import { Application, Command } from '@loomcli/core';
import { interaction } from '@loomcli/plugins/interaction';
import { confirm, secret, select, text } from '@loomcli/prompts';
import { answeredLine, cancelledLine, questionFrame } from '@loomcli/prompts/views';
import { z } from 'zod';

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
