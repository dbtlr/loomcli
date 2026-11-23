// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { Application } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { manifest } from '@loomcli/plugins/manifest';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { bytes, date, ip, keyValue, time } from '../src/index.js';
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

/** An application whose options read a day in two layouts and a time of day on a 12-hour clock. */
function remind() {
  return new Application('remind', { plugins: [format(), manifest()] })
    .option('on', { required: true, type: 'string', validate: date({ layouts: ['%d/%m/%Y'] }) })
    .option('at', {
      default: '9:00am',
      type: 'string',
      validate: time({ layouts: ['%I:%M%p'], min: '06:00' }),
    })
    .action(({ options, out }) => out.print(JSON.stringify({ at: options.at, on: options.on })));
}

test('the manifest reads a layout schema, and the action receives the output', async () => {
  const app = remind();
  const [on, at] = app.inspect().root.options.filter((node) => node.name !== 'help');
  expect(on?.schema).toEqual(published(date({ layouts: ['%d/%m/%Y'] })));
  expect(at?.schema).toEqual(published(time({ layouts: ['%I:%M%p'], min: '06:00' })));

  const document = mockProcess({ argv: ['--manifest'] });
  await expect(app.run({ process: document })).resolves.toBe(0);
  const text = document.stdout.text.replaceAll(/\s/gu, '');
  expect(text).toContain(
    '"anyOf":[{"format":"date"},{"pattern":"^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$"}]',
  );
  expect(text).toContain('{"pattern":"^[0-9]{1,2}:[0-9]{1,2}[AaPp][Mm]$"}');

  const run = mockProcess({ argv: ['--on', '25/9/2026', '--at', '9:30pm'] });
  await expect(remind().run({ process: run })).resolves.toBe(0);
  expect(JSON.parse(run.stdout.text)).toEqual({ at: 77_400_000, on: '2026-09-25' });

  const fallback = mockProcess({ argv: ['--on', '2026-09-25'] });
  await expect(remind().run({ process: fallback })).resolves.toBe(0);
  expect(JSON.parse(fallback.stdout.text)).toEqual({ at: 32_400_000, on: '2026-09-25' });

  const rejected = mockProcess({ argv: ['--on', '31/04/2026', '--at', '5:00am'] });
  await expect(remind().run({ process: rejected })).resolves.toBe(2);
  expect(rejected.stderr.text).toContain(
    'Expected a date as YYYY-MM-DD or DD/MM/YYYY, such as 2026-09-25.',
  );
  expect(rejected.stderr.text).toContain('Expected a time of at least 06:00.');
});
