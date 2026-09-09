import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { temporaryRoot } from './fixture.js';

const writeSchema = z.object({
  body: z.unknown().optional(),
  contentType: z.string().optional(),
  method: z.string(),
  name: z.string().nullable().optional(),
  path: z.string(),
  size: z.number().optional(),
});

const reportSchema = z.object({ writes: z.array(writeSchema) });

const children: ChildProcess[] = [];

function announcedPort(child: ChildProcess) {
  return new Promise<number>((resolve, reject) => {
    const { stderr, stdout } = child;
    if (!stdout || !stderr) {
      reject(new Error('The fake services process has no pipes.'));
      return;
    }
    let text = '';
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      text += chunk;
      const end = text.indexOf('\n');
      if (end !== -1) {
        const announcement: unknown = JSON.parse(text.slice(0, end));
        resolve(z.object({ port: z.number() }).parse(announcement).port);
      }
    });
    stderr.setEncoding('utf8');
    stderr.on('data', (chunk: string) => reject(new Error(`Fake services failed: ${chunk}`)));
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Fake services exited with ${String(code)}.`)));
  });
}

export interface PackageState {
  // Overrides the digest the registry reports, which is otherwise the digest of the served tarball.
  integrity?: string;
  // The number of 404 answers the packument gives before it reports the version.
  misses?: number;
  provenanceCommit?: string;
  // Overrides the repository the provenance names in its resolved dependency uri.
  provenanceRepository?: string;
  // Overrides the reference the provenance names in its resolved dependency uri.
  provenanceRef?: string;
  // Overrides the subject the provenance statement attests.
  provenanceSubject?: string;
  published: boolean;
  tarball?: string;
  // The number of 503 answers the tarball endpoint gives before it serves the bytes.
  tarballMisses?: number;
}

export interface ServicesState {
  // A package absent from this map is absent from the registry.
  packages: Record<string, PackageState>;
  release?:
    | {
        assets: { id: number; name: string; size: number; state?: string }[];
        id: number;
        // Overrides the host of the Release's upload_url, which the uploader checks before it sends the token.
        uploadHost?: string;
      }
    | undefined;
  repository: string;
  tag?: { annotated: boolean; commit: string } | undefined;
  version: string;
}

export function stopServices() {
  for (const child of children.splice(0)) {
    child.kill();
  }
}

// Starts one process that answers both the registry and the GitHub API.
// It runs outside the test process because the tests spawn the CLI synchronously and cannot serve requests from their own event loop.
export async function startServices(state: ServicesState) {
  const configPath = join(temporaryRoot('loom-services-'), 'services.json');
  writeFileSync(configPath, JSON.stringify(state));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('fake-services.mjs', import.meta.url)), configPath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.push(child);
  const base = `http://127.0.0.1:${String(await announcedPort(child))}`;
  return {
    githubApi: `${base}/github`,
    registry: `${base}/registry`,
    // Every write the services received, in the order they arrived.
    writes: async () => {
      const response = await fetch(`${base}/state`);
      const report: unknown = await response.json();
      return reportSchema.parse(report).writes;
    },
  };
}
