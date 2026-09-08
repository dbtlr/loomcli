import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { PublicationServices } from './publication-release.js';

async function checked(response: Response) {
  if (!response.ok) {
    throw new Error(
      `GitHub request failed (${response.status}). Resume the retained set after reconciliation.`,
    );
  }
  return response;
}

export function publicationServices(
  repository: string,
  auth: 'bootstrap' | 'trusted',
): PublicationServices {
  const token = z.string().min(1).parse(process.env.GH_TOKEN);
  z.string().min(1).parse(process.env.NODE_AUTH_TOKEN);
  const api = 'https://api.github.com';
  const prefix = `/repos/${repository}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  return {
    async download(id) {
      const response = await checked(
        await fetch(`${api}${prefix}/releases/assets/${id}`, {
          headers: { ...headers, Accept: 'application/octet-stream' },
          signal: AbortSignal.timeout(60_000),
        }),
      );
      return Buffer.from(await response.arrayBuffer());
    },
    async github(method, path, body) {
      if (!path.startsWith(`${prefix}/`)) {
        throw new Error('Unexpected GitHub repository path.');
      }
      const response = await fetch(`${api}${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers,
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      });
      if (
        response.status === 404 &&
        method === 'GET' &&
        path.startsWith(`${prefix}/git/ref/tags/`)
      ) {
        return undefined;
      }
      await checked(response);
      return response.status === 204 ? undefined : response.json();
    },
    async npm(args) {
      const directory = mkdtempSync(join(tmpdir(), 'loom-npm-'));
      try {
        const manifestPath = fileURLToPath(import.meta.resolve('npm/package.json'));
        const executable = join(dirname(manifestPath), 'bin/npm-cli.js');
        const env = { ...process.env };
        if (args[0] === 'publish' && auth === 'trusted') {
          // OIDC publication must not fall back to credentials from npm configuration.
          for (const key of Object.keys(env)) {
            if (key.toLowerCase().startsWith('npm_config_')) {
              delete env[key];
            }
          }
          env.NODE_AUTH_TOKEN = '';
          env.NPM_TOKEN = '';
          env.NPM_CONFIG_USERCONFIG = join(directory, 'user.npmrc');
          env.NPM_CONFIG_GLOBALCONFIG = join(directory, 'global.npmrc');
          writeFileSync(env.NPM_CONFIG_USERCONFIG, '');
          writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '');
        }
        const result = spawnSync(
          process.execPath,
          [executable, ...args, '--registry=https://registry.npmjs.org/'],
          {
            cwd: directory,
            encoding: 'utf8',
            env,
            maxBuffer: 16 * 1024 * 1024,
            timeout: 120_000,
          },
        );
        if (result.error || result.status === null) {
          throw new Error('npm process failed or timed out. Resume the same retained set.');
        }
        return { status: result.status, stdout: result.stdout };
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
    async upload(id, name, bytes) {
      await checked(
        await fetch(
          `https://uploads.github.com${prefix}/releases/${id}/assets?name=${encodeURIComponent(name)}`,
          {
            body: new Uint8Array(bytes),
            headers: { ...headers, 'Content-Type': 'application/octet-stream' },
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(60_000),
          },
        ),
      );
    },
  };
}
