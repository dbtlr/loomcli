import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import {
  Application,
  InternalError,
  validateLinkedValue,
  validationContext,
} from '../src/index.js';

test('linked validation uses the registered declaration and authenticated question context', async () => {
  const seen: unknown[] = [];
  const app = new Application('linked')
    .option('port', {
      multiple: true,
      type: 'string',
      validate: {
        '~standard': {
          validate(value, options) {
            seen.push(validationContext(options));
            return { value: Number(value) };
          },
          vendor: 'test',
          version: 1,
        },
      },
    })
    .action(async (context) => {
      await expect(
        validateLinkedValue(context, { message: 'Ports', option: 'port' }, '443'),
      ).resolves.toEqual({ value: 443 });
    });
  await expect(app.run({ process: mockProcess() })).resolves.toBe(0);
  expect(seen).toContainEqual(
    expect.objectContaining({
      input: { global: false, kind: 'option', name: 'port' },
      phase: 'question',
    }),
  );
});

test('linked validation rejects foreign graphs and foreign command nodes with the shared correction', async () => {
  const app = new Application('linked')
    .option('value', { type: 'string' })
    .action(async (context) => {
      for (const values of [
        { command: context.command, graph: { ...context.graph } },
        { command: { ...context.command }, graph: context.graph },
      ]) {
        await expect(
          validateLinkedValue(
            { ...context, ...values },
            { message: 'Value', option: 'value' },
            'x',
          ),
        ).rejects.toMatchObject({ correction: 'Pass the graph inspect() returned, unchanged.' });
        await expect(
          validateLinkedValue(
            { ...context, ...values },
            { message: 'Value', option: 'value' },
            'x',
          ),
        ).rejects.toBeInstanceOf(InternalError);
      }
    });
  await expect(app.run({ process: mockProcess() })).resolves.toBe(0);
});
