import { Application, Command, resolveTimeZone } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { dateTime } from '../src/index.js';

const token = '2026-09-25T14:30:00';

function instantCommand() {
  return new Command('instant')
    .argument('at', { required: true, validate: dateTime() })
    .action(async ({ args, host, out }) => {
      await out.print(`${host.timeZone} ${args.at.toISOString()}`);
    });
}

test('app.invoke places a zone-less token in its own zone without changing the handle or another invocation', async () => {
  const process = mockProcess({ timeZone: 'UTC' });
  const app = new Application('clock').command(instantCommand());
  await expect(
    app.invoke(['instant'], { args: { at: token } }, { process, timeZone: 'Asia/Tokyo' }),
  ).resolves.toMatchObject({
    output: 'Asia/Tokyo 2026-09-25T05:30:00.000Z\n',
    status: 'completed',
  });
  expect(process.timeZone).toBe('UTC');
  await expect(
    app.invoke(['instant'], { args: { at: token } }, { process }),
  ).resolves.toMatchObject({
    output: 'UTC 2026-09-25T14:30:00.000Z\n',
    status: 'completed',
  });
});

test('a nested invocation inherits the per-call zone and leaves its outer run unchanged', async () => {
  const app = new Application('clock')
    .command(instantCommand())
    .command(
      new Command('bridge').action(async ({ invoke, out }) => {
        const inner = await invoke(['instant'], { args: { at: token } });
        expect(inner.status).toBe('completed');
        if (inner.status === 'completed') {
          await out.print(inner.output.trimEnd());
        }
      }),
    )
    .action(async ({ host, invoke, out }) => {
      expect(host.timeZone).toBe('UTC');
      const inner = await invoke(['bridge'], {}, { timeZone: 'Asia/Tokyo' });
      expect(inner.status).toBe('completed');
      if (inner.status === 'completed') {
        await out.print(inner.output.trimEnd());
      }
      expect(host.timeZone).toBe('UTC');
    });
  const process = mockProcess({ timeZone: 'UTC' });
  await expect(app.run({ process })).resolves.toBe(0);
  expect(process.stdout.text).toBe('Asia/Tokyo 2026-09-25T05:30:00.000Z\n');
});

test('changed zones revalidate declared defaults and implied values while same-zone and inherited calls reuse them', async () => {
  const base = dateTime()['~standard'];
  let validations = 0;
  const validate: typeof base.validate = (value, options) => {
    validations += 1;
    return base.validate(value, options);
  };
  const stamp = new Command('stamp')
    .option('at', {
      default: token,
      implied: token,
      type: 'string',
      validate: { '~standard': { ...base, validate } },
    })
    .action(async ({ host, options, out }) => {
      await out.print(`${host.timeZone} ${options.at.toISOString()}`);
    });
  const app = new Application('clock')
    .command(stamp)
    .command(
      new Command('bridge').action(async ({ invoke, out }) => {
        expect(validations).toBe(4);
        const same = await invoke(['stamp'], { options: { at: true } }, { timeZone: 'Asia/Tokyo' });
        expect(validations).toBe(4);
        const different = await invoke(['stamp'], {}, { timeZone: 'America/New_York' });
        expect(validations).toBe(6);
        const inherited = await invoke(['stamp'], {});
        expect(validations).toBe(6);
        for (const result of [same, different, inherited]) {
          expect(result.status).toBe('completed');
          if (result.status === 'completed') {
            await out.print(result.output.trimEnd());
          }
        }
      }),
    )
    .action(async ({ invoke, out }) => {
      expect(validations).toBe(2);
      const result = await invoke(['bridge'], {}, { timeZone: 'Asia/Tokyo' });
      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        await out.print(result.output.trimEnd());
      }
    });
  const outcome = await app.invoke([], {}, { process: mockProcess({ timeZone: 'UTC' }) });
  expect(outcome).toMatchObject({
    output: [
      'Asia/Tokyo 2026-09-25T05:30:00.000Z',
      'America/New_York 2026-09-25T18:30:00.000Z',
      'Asia/Tokyo 2026-09-25T05:30:00.000Z',
      '',
    ].join('\n'),
    status: 'completed',
  });
});

test('an explicit alias of the validation zone reuses declared values when the runtime spells them alike', async () => {
  const sameSpelling = resolveTimeZone('US/Eastern') === resolveTimeZone('America/New_York');
  const base = dateTime()['~standard'];
  let validations = 0;
  const validate: typeof base.validate = (value, options) => {
    validations += 1;
    return base.validate(value, options);
  };
  const app = new Application('clock')
    .command(
      new Command('stamp')
        .option('at', {
          default: token,
          type: 'string',
          validate: { '~standard': { ...base, validate } },
        })
        .action(async ({ options, out }) => {
          await out.print(options.at.toISOString());
        }),
    )
    .action(async ({ invoke, out }) => {
      expect(validations).toBe(1);
      const result = await invoke(['stamp'], {}, { timeZone: 'America/New_York' });
      // Node spells US/Eastern as America/New_York, so the call reuses; Bun keeps it, so it validates again.
      expect(validations).toBe(sameSpelling ? 1 : 2);
      if (result.status === 'completed') {
        await out.print(result.output.trimEnd());
      }
    });
  await expect(
    app.invoke([], {}, { process: mockProcess({ timeZone: 'US/Eastern' }) }),
  ).resolves.toMatchObject({
    output: '2026-09-25T18:30:00.000Z\n',
    status: 'completed',
  });
});
