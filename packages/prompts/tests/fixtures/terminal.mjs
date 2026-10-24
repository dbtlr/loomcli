import { spawnSync } from 'node:child_process';

import { Application, processHandle } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { loomTheme } from '@loomcli/plugins/theme';

import { confirm, secret, select, text } from '../../dist/index.js';

const scenario = process.argv[2];
spawnSync('stty', ['rows', process.env.PROMPT_ROWS ?? '24', 'cols', '80'], {
  stdio: ['inherit', 'ignore', 'inherit'],
});
const app = new Application('setup', {
  description: 'Configure the service.',
  plugins: [config({ file: '.loom-test-prompts.json' }), loomTheme()],
})
  .option('port', {
    default: '4000',
    description: 'Service port.',
    env: 'PROMPT_PORT',
    extensions: [configInput({ path: 'port' })],
    type: 'string',
    validate: {
      '~standard': {
        validate: (value) => ({ value: Number(value) }),
        vendor: 'fixture',
        version: 1,
      },
    },
  })
  .option('install', { description: 'Install the service.', type: 'boolean' })
  .action(async (context) => {
    if (scenario === 'select') {
      const answer = await select(context, {
        choices: Array.from({ length: 10 }, (_value, index) => `choice-${index}`),
        default: 'choice-3',
        message: 'Backend',
      });
      process.stdout.write(`ANSWER:${JSON.stringify(answer)}\n`);
      return;
    }
    if (scenario === 'confirm') {
      const first = await confirm(context, { message: 'Install service?' });
      const second = await confirm(context, { default: true, message: 'Continue?' });
      process.stdout.write(`ANSWERS:${JSON.stringify([first, second])}\n`);
      return;
    }
    if (scenario.startsWith('secret')) {
      const value = await secret(context, { message: 'Postgres URL' });
      process.stdout.write(`SECRET:${value === 'password-sentinel'}\n`);
      return;
    }
    if (scenario === 'linked' || scenario === 'skip') {
      const answer = await text(context, {
        default: '5000',
        message: 'Service port',
        option: 'port',
        skipIfSupplied: scenario === 'skip',
        validate: {
          '~standard': {
            validate: (value) => ({ value: Number(value) }),
            vendor: 'fixture',
            version: 1,
          },
        },
      });
      process.stdout.write(`ANSWER:${JSON.stringify(answer)}\n`);
      return;
    }
    if (scenario === 'typeahead') {
      const first = await text(context, { message: 'Service port' });
      const second = await confirm(context, { message: 'Install service?' });
      process.stdout.write(`ANSWERS:${JSON.stringify([first, second])}\n`);
      return;
    }
    if (scenario === 'confirm-no') {
      const answer = await confirm(context, { default: false, message: 'Install service?' });
      process.stdout.write(`ANSWER:${JSON.stringify(answer)}\n`);
      return;
    }
    if (scenario === 'confirm-omitted') {
      const answer = await confirm(context, { message: 'Install service?', option: 'install' });
      process.stdout.write(`ANSWER:${JSON.stringify(answer)}\n`);
      return;
    }
    const validate = {
      '~standard': {
        validate: (value) =>
          /^\d+$/u.test(value)
            ? { value: Number(value) }
            : { issues: [{ message: 'Use digits.' }] },
        vendor: 'fixture',
        version: 1,
      },
    };
    const answer = await text(context, {
      ...(scenario === 'blank' || scenario === 'retry' ? {} : { default: '4317' }),
      ...(scenario === 'retry' ? { validate } : {}),
      message: 'Service port',
    });
    process.stdout.write(`ANSWER:${JSON.stringify(answer)}\n`);
  });
const code = await app.run({
  process: processHandle({ argv: JSON.parse(process.env.PROMPT_ARGV ?? '[]') }),
});
process.stdout.write(`EXIT:${code} cooked:${!process.stdin.isRaw}\n`);
