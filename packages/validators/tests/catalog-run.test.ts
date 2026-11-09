// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { Application } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { manifest } from '@loomcli/plugins/manifest';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { bytes, ip, keyValue } from '../src/index.js';
import { published } from './support.js';

/** An application whose options read a size, an address, and repeated pairs. */
function upload() {
  return new Application('upload', { plugins: [format(), manifest()] })
    .option('limit', { default: '10MB', type: 'string', validate: bytes({ max: '10GiB' }) })
    .option('bind', { type: 'string', validate: ip({ version: 6 }) })
    .option('label', { multiple: true, type: 'string', validate: keyValue() })
    .action(({ options, out }) =>
      out.print(
        JSON.stringify({ bind: options.bind, labels: options.label, limit: options.limit }),
      ),
    );
}

test('the inspected graph and the manifest read each published schema', async () => {
  const app = upload();
  const [limit, bind, label] = app.inspect().root.options.filter((node) => node.name !== 'help');
  expect(limit?.schema).toEqual(published(bytes({ max: '10GiB' })));
  expect(bind?.schema).toEqual(published(ip({ version: 6 })));
  expect(label?.schema).toEqual(published(keyValue()));

  const document = mockProcess({ argv: ['--manifest'] });
  await expect(app.run({ process: document })).resolves.toBe(0);
  const text = document.stdout.text.replaceAll(/\s/gu, '');
  expect(text).toContain('"format":"ipv6"');
  expect(text).toContain(String.raw`"pattern":"^[\\s\\S]+="`);
});

test('the action receives the byte count, the canonical address, and the pairs in order', async () => {
  const run = mockProcess({
    argv: [
      '--limit',
      '512Mi',
      '--bind',
      '2001:DB8:0:0:0:0:0:1',
      '--label',
      'a=1',
      '--label',
      'a=2',
    ],
  });
  await expect(upload().run({ process: run })).resolves.toBe(0);
  expect(JSON.parse(run.stdout.text)).toEqual({
    bind: '2001:db8::1',
    labels: [
      { key: 'a', value: '1' },
      { key: 'a', value: '2' },
    ],
    limit: 536_870_912,
  });

  const fallback = mockProcess({ argv: [] });
  await expect(upload().run({ process: fallback })).resolves.toBe(0);
  expect(JSON.parse(fallback.stdout.text)).toMatchObject({ labels: [], limit: 10_000_000 });
});

test('a rejected token reads its catalog sentence under the option', async () => {
  const run = mockProcess({ argv: ['--limit', '11GiB', '--label', 'nope'] });
  await expect(upload().run({ process: run })).resolves.toBe(2);
  expect(run.stderr.text).toContain('Expected a size of at most 10GiB.');
  expect(run.stderr.text).toContain('Expected a key and a value as key=value.');
});
