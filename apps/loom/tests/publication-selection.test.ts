import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { expect, test } from 'vite-plus/test';
import { parse } from 'yaml';
import { z } from 'zod';

const source = 'a'.repeat(40);
const base = 'b'.repeat(40);
const head = 'c'.repeat(40);
const title = 'chore(release): Release v0.1.1 - Improve commands';
const pull = {
  base: { ref: 'main', repo: { full_name: 'sample/fixture' } },
  head: { repo: { full_name: 'sample/fixture' }, sha: head },
  merge_commit_sha: source,
  merged: true,
  title,
};

const workflow = z
  .object({
    jobs: z.object({
      selection: z.object({
        steps: z.array(
          z.object({
            name: z.string(),
            with: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
      }),
    }),
  })
  .parse(
    parse(
      readFileSync(new URL('../../../.github/workflows/publication.yml', import.meta.url), 'utf8'),
    ),
  );
const entrypoint = z
  .string()
  .parse(
    workflow.jobs.selection.steps.find((step) => step.name === 'Select publication')?.with?.script,
  );

async function select(
  pr = pull,
  env: Record<string, string> = {},
  merge = { message: title, parents: [{ sha: base }, { sha: head }], tree: { sha: 'tree' } },
) {
  const outputs: Record<string, unknown> = {};
  const module = { exports: {} };
  runInNewContext(
    readFileSync(new URL('../../../scripts/publication-selection.cjs', import.meta.url), 'utf8'),
    { module },
  );
  const result: unknown = runInNewContext(`(async () => { ${entrypoint} })()`, {
    context: {
      eventName: env.EVENT_NAME || 'pull_request',
      payload: { action: 'closed', pull_request: pr },
      repo: { owner: 'sample', repo: 'fixture' },
      sha: source,
    },
    core: { setOutput: (name: string, value: unknown) => (outputs[name] = value) },
    github: {
      rest: {
        git: {
          getCommit: ({ commit_sha }: { commit_sha: string }) => ({
            data: commit_sha === head ? { parents: [{ sha: base }], tree: { sha: 'tree' } } : merge,
          }),
        },
      },
    },
    process: { env: { GITHUB_WORKSPACE: '/fixture', ...env } },
    require(path: string) {
      expect(path).toBe('/fixture/tools/scripts/publication-selection.cjs');
      return module.exports;
    },
  });
  await result;
  return outputs;
}

test('a merged release selects the exact run source, original cut base and trusted publication', async () => {
  await expect(select()).resolves.toEqual({
    auth: 'trusted',
    base,
    mode: 'automatic',
    publish: 'true',
    source,
    title,
    tooling: source,
  });
});

test('ordinary and unmerged changes cannot select publication', async () => {
  await expect(select({ ...pull, title: 'fix: behavior' })).resolves.toEqual({});
  await expect(select({ ...pull, merged: false })).resolves.toEqual({});
  await expect(select({ ...pull, base: { ...pull.base, ref: 'other' } })).resolves.toEqual({});
});

test('a release refuses changed source, cut base, merge tree or title before reservation', async () => {
  await expect(select({ ...pull, merge_commit_sha: 'd'.repeat(40) })).rejects.toThrow('run SHA');
  await expect(
    select(
      pull,
      {},
      { message: title, parents: [{ sha: 'd'.repeat(40) }, { sha: head }], tree: { sha: 'tree' } },
    ),
  ).rejects.toThrow('cut base');
  await expect(
    select(
      pull,
      {},
      { message: title, parents: [{ sha: base }, { sha: head }], tree: { sha: 'changed' } },
    ),
  ).rejects.toThrow('reviewed cut');
  await expect(
    select(
      pull,
      {},
      { message: 'wrong title', parents: [{ sha: base }, { sha: head }], tree: { sha: 'tree' } },
    ),
  ).rejects.toThrow('release title');
});

test('manual recovery preserves the original source while tooling can select a repair commit', async () => {
  const env = {
    AUTH: 'trusted',
    EVENT_NAME: 'workflow_dispatch',
    MODE: 'publish',
    SOURCE: source,
    TOOLING: 'd'.repeat(40),
  };
  await expect(select(pull, env)).resolves.toEqual({
    auth: 'trusted',
    base: '',
    mode: 'verify',
    publish: 'true',
    source,
    title: '',
    tooling: 'd'.repeat(40),
  });
  await expect(select(pull, { ...env, SOURCE: head })).rejects.toThrow('retained release source');
  await expect(select(pull, { ...env, TOOLING: 'main' })).rejects.toThrow('full commit SHA');
  await expect(select(pull, { ...env, AUTH: 'fallback' })).rejects.toThrow('authentication');
  await expect(
    select(pull, { ...env, AUTH: 'bootstrap', BASE: base, MODE: 'prepare', TITLE: title }),
  ).resolves.toMatchObject({ auth: 'bootstrap', base, mode: 'prepare', publish: 'false', title });
});

test('a squash merge can preserve the reviewed cut but a different repository cannot publish', async () => {
  await expect(
    select(pull, {}, { message: title, parents: [{ sha: base }], tree: { sha: 'tree' } }),
  ).resolves.toMatchObject({ base, source });
  await expect(
    select({ ...pull, head: { ...pull.head, repo: { full_name: 'other/fixture' } } }),
  ).resolves.toEqual({});
});
