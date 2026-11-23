/*
 * Acceptance plan for the attestation subpath's bundle size (docs/plugins/self-update.md#attestation,
 * ADR-0212): Bun and Rolldown each bundle an application that installs `selfUpdate()` without
 * importing `@loomcli/plugins/self-update/attestation`, and no file of that bundle holds code of
 * `@sigstore/verify`, `@sigstore/bundle`, `@sigstore/tuf`, or `tuf-js`. The same bundler's bundle of
 * an application that imports the subpath holds each, so the markers are ones a bundle keeps.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

const script = fileURLToPath(new URL('fixtures/attestation-bundle/bundle.mjs', import.meta.url));

/** How long one bundle may take before the test fails. */
const timeout = 60_000;

/**
 * A string each package's code holds: `@sigstore/verify`'s threshold option, `@sigstore/bundle`'s
 * media type, `@sigstore/tuf`'s fault code, and `tuf-js`'s error for a metadata length.
 */
const markers = [
  'tlogThreshold',
  'application/vnd.dev.sigstore.bundle.v0.3+json',
  'TUF_REFRESH_METADATA_ERROR',
  'DownloadLengthMismatchError',
];

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** Every file the bundler wrote for the named application, joined. */
function bundled(bundler: string, runtime: string, name: string): string {
  const outdir = mkdtempSync(join(tmpdir(), `loom-attestation-${bundler}-`));
  roots.push(outdir);
  const result = spawnSync(runtime, [script, bundler, name, outdir], { encoding: 'utf8', timeout });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return readdirSync(outdir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(outdir, file), 'utf8'))
    .join('\n');
}

const bundlers = [
  { bundler: 'bun', runtime: 'bun' },
  { bundler: 'rolldown', runtime: 'node' },
];

test.each(bundlers)(
  'an application $bundler bundles without the attestation subpath holds no sigstore code',
  ({ bundler, runtime }) => {
    const code = bundled(bundler, runtime, 'plain');
    for (const marker of markers) {
      expect(code).not.toContain(marker);
    }
  },
  timeout,
);

test.each(bundlers)(
  'an application $bundler bundles with the attestation subpath holds the sigstore code',
  ({ bundler, runtime }) => {
    const code = bundled(bundler, runtime, 'attested');
    for (const marker of markers) {
      expect(code).toContain(marker);
    }
  },
  timeout,
);
