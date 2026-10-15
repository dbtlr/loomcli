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
// @ts-expect-error TS2322: Conditional requiredness is scalar only.
new Command('bad').option('tags', { multiple: true, required: 'non-interactive', type: 'string' });
// @ts-expect-error TS2322: Arguments keep Boolean requiredness.
new Command('bad').argument('name', { required: 'non-interactive' });
