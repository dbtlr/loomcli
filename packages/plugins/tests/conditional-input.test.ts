import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

const app = new Application('clone', { plugins: [help(), manifest()] })
  .argument('url', { required: 'non-interactive' })
  .argument('files', { required: 'non-interactive', variadic: true })
  .option('tag', { multiple: true, required: 'non-interactive', type: 'string' })
  .action(() => {});

test('help shows conditional arguments as required operands with a conditional row fact', async () => {
  const mock = mockProcess({ argv: ['--help'] });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toContain('clone <url> <files...> [options]');
  expect(mock.stdout.text).toContain('url    (required when not interactive)');
  expect(mock.stdout.text).toContain('files  (required when not interactive)');
  expect(mock.stdout.text).toContain('(required when not interactive, repeatable)');
});

test('manifest publishes conditional requiredness on every argument', async () => {
  const mock = mockProcess({ argv: ['--manifest'] });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(JSON.parse(mock.stdout.text)).toMatchObject({
    command: {
      arguments: [
        { name: 'url', required: false, requiredWhen: 'non-interactive' },
        { name: 'files', required: false, requiredWhen: 'non-interactive' },
      ],
    },
  });
});
