import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { expect, test } from 'vite-plus/test';
import { parse } from 'yaml';
import { z } from 'zod';

const step = z.object({
  name: z.string(),
  uses: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
const job = z.object({ steps: z.array(step) });
const config = z
  .object({
    jobs: z.object({ retain: job }),
    on: z.object({ workflow_dispatch: z.unknown() }).strict(),
    permissions: z.object({ actions: z.literal('read'), contents: z.literal('read') }).strict(),
  })
  .parse(
    parse(
      readFileSync(new URL('../../../.github/workflows/publication.yml', import.meta.url), 'utf8'),
    ),
  );
const script = z
  .string()
  .parse(
    config.jobs.retain.steps.find((value) => value.name === 'Validate artifact selection')?.with
      ?.script,
  );
const source = 'a'.repeat(40);
const base = 'b'.repeat(40);
const artifact = { expired: false, name: `release-${source}`, workflow_run: { id: 12 } };

async function select(
  env: Record<string, string>,
  retained = artifact,
  records: (typeof artifact)[] = [],
) {
  const outputs: Record<string, unknown> = {};
  const result: unknown = runInNewContext(`(async () => { ${script} })()`, {
    context: { repo: { owner: 'sample', repo: 'fixture' }, runId: 34 },
    core: {
      setOutput(name: string, value: unknown) {
        outputs[name] = value;
      },
    },
    github: {
      paginate: () => Promise.resolve(records),
      rest: {
        actions: {
          getArtifact: () => Promise.resolve({ data: retained }),
          listArtifactsForRepo: () => undefined,
        },
      },
    },
    process: {
      env: {
        BASE: base,
        GITHUB_RUN_ATTEMPT: '1',
        MODE: 'prepare',
        SOURCE: source,
        TITLE: 'chore(release): Release v0.1.0 - Fixture',
        ...env,
      },
    },
  });
  await result;
  return outputs;
}

test('the workflow admits initial preparation but refuses existing, expired, and rerun sets', async () => {
  await expect(select({})).resolves.toEqual({ run: 34 });
  await expect(select({ GITHUB_RUN_ATTEMPT: '2' })).rejects.toThrow('Do not rebuild on retry');
  await expect(select({}, artifact, [artifact])).rejects.toThrow('already has an artifact record');
  await expect(select({}, artifact, [{ ...artifact, expired: true }])).rejects.toThrow(
    'already has an artifact record',
  );
});

test('workflow reuse binds the source name, original run, artifact ID, and independently retained digest', async () => {
  const env = {
    MODE: 'verify',
    RETAINED_ARTIFACT: '56',
    RETAINED_DIGEST: 'c'.repeat(64),
    RETAINED_RUN: '12',
  };
  await expect(select(env)).resolves.toEqual({ artifact: '56', digest: 'c'.repeat(64), run: '12' });
  await expect(select({ ...env, RETAINED_DIGEST: '' })).rejects.toThrow(
    'manifest digest are required',
  );
  await expect(select(env, { ...artifact, expired: true })).rejects.toThrow('expired');
  await expect(select(env, { ...artifact, name: 'different-source' })).rejects.toThrow(
    'identity differs',
  );
  await expect(select({ ...env, RETAINED_RUN: '99' })).rejects.toThrow('identity differs');
});
