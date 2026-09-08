import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { expect, test } from 'vite-plus/test';
import { parse } from 'yaml';
import { z } from 'zod';

const step = z.object({ name: z.string(), with: z.record(z.string(), z.unknown()).optional() });
const permissions = z.object({ actions: z.literal('read'), contents: z.literal('read') }).strict();
const config = z
  .object({
    jobs: z.object({
      retain: z.object({
        permissions: permissions.extend({ contents: z.literal('write') }),
        steps: z.array(step),
      }),
    }),
    on: z.object({ workflow_dispatch: z.unknown() }).strict(),
    permissions,
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
const ledgerScript = readFileSync(
  new URL('../../../scripts/publication-ledger.cjs', import.meta.url),
  'utf8',
);
const source = 'a'.repeat(40);
const base = 'b'.repeat(40);
const title = 'chore(release): Release v0.1.0 - Fixture';
const artifact = { expired: false, name: `release-${source}`, workflow_run: { id: 12 } };
const reserved = { base, run: '12', source, state: 'reserved', title, version: '0.1.0' };
const retained = { ...reserved, artifact: '56', digest: 'c'.repeat(64), state: 'retained' };

// Execute the workflow entrypoint and its real script; only GitHub's network boundary is simulated.
function service(records: unknown[] = [], options: { missing?: boolean; race?: boolean } = {}) {
  let contents = JSON.stringify({ records, schema: 1 });
  const writes: unknown[] = [];
  return {
    async select(
      env: Record<string, string> = {},
      selected = artifact,
      artifacts: (typeof artifact)[] = [],
    ) {
      const outputs: Record<string, unknown> = {};
      let nextContents = '';
      const globals = {
        Buffer,
        context: { repo: { owner: 'sample', repo: 'fixture' }, runId: 34 },
        core: {
          setOutput(name: string, value: unknown) {
            outputs[name] = value;
          },
        },
        github: {
          paginate: () => Promise.resolve(artifacts),
          rest: {
            actions: {
              getArtifact: () => Promise.resolve({ data: selected }),
              listArtifactsForRepo: () => undefined,
            },
            git: {
              createCommit(input: unknown) {
                writes.push(input);
                return { data: { sha: 'next-commit' } };
              },
              createTree(input: { tree: { content: string }[] }) {
                nextContents = z.object({ content: z.string() }).parse(input.tree[0]).content;
                return { data: { sha: 'next-tree' } };
              },
              getCommit: () => ({ data: { tree: { sha: 'observed-tree' } } }),
              getRef() {
                if (options.missing) {
                  throw new Error('Ledger branch not found');
                }
                return { data: { object: { sha: 'observed-head' } } };
              },
              updateRef(input: unknown) {
                writes.push(input);
                if (options.race) {
                  throw new Error('Update is not a fast forward');
                }
                contents = nextContents;
              },
            },
            repos: {
              getContent: () => ({
                data: {
                  content: Buffer.from(contents).toString('base64'),
                  encoding: 'base64',
                  type: 'file',
                },
              }),
            },
          },
        },
        process: {
          env: {
            BASE: base,
            GITHUB_RUN_ATTEMPT: '1',
            GITHUB_WORKSPACE: '/fixture',
            MODE: 'prepare',
            SOURCE: source,
            TITLE: title,
            ...env,
          },
        },
      };
      const module = { exports: {} };
      runInNewContext(ledgerScript, { Buffer, module });
      const result: unknown = runInNewContext(`(async () => { ${script} })()`, {
        ...globals,
        require(path: string) {
          expect(path).toBe('/fixture/tools/scripts/publication-ledger.cjs');
          return module.exports;
        },
      });
      await result;
      return outputs;
    },
    writes,
  };
}
const reuse = {
  MODE: 'verify',
  RETAINED_ARTIFACT: '56',
  RETAINED_DIGEST: 'c'.repeat(64),
  RETAINED_RUN: '12',
};

test('a reservation prevents rebuilding after the original artifact record is deleted', async () => {
  await expect(service([reserved]).select()).rejects.toThrow('already reserved');
  await expect(service([retained]).select()).rejects.toThrow('already reserved');
  await expect(service([reserved]).select({ SOURCE: 'd'.repeat(40) })).rejects.toThrow(
    'already reserved',
  );
});

test('preparation durably reserves identity before allowing a build and refuses a second dispatch', async () => {
  const api = service();
  await expect(api.select()).resolves.toEqual({ run: 34 });
  expect(api.writes).toEqual([
    {
      message: 'Reserve release 0.1.0',
      owner: 'sample',
      parents: ['observed-head'],
      repo: 'fixture',
      tree: 'next-tree',
    },
    {
      force: false,
      owner: 'sample',
      ref: 'heads/publication-ledger',
      repo: 'fixture',
      sha: 'next-commit',
    },
  ]);
  await expect(api.select()).rejects.toThrow('already reserved');
  await expect(service().select({ GITHUB_RUN_ATTEMPT: '2' })).rejects.toThrow(
    'Do not rebuild on retry',
  );
  await expect(service().select({}, artifact, [artifact])).rejects.toThrow(
    'already has an artifact record',
  );
  await expect(service().select({}, artifact, [{ ...artifact, expired: true }])).rejects.toThrow(
    'already has an artifact record',
  );
});

test('missing, malformed, and competing ledger writes cannot admit preparation', async () => {
  await expect(service([], { missing: true }).select()).rejects.toThrow('Ledger branch not found');
  await expect(service([{}]).select()).rejects.toThrow('Invalid publication ledger');
  await expect(service([], { race: true }).select()).rejects.toThrow('not a fast forward');
});

test('only the original preparation records the uploaded identity and later verification cannot replace it', async () => {
  const api = service([{ ...reserved, run: '34' }]);
  const env = { ...reuse, MODE: 'retain', RETAINED_RUN: '34' };
  const upload = { ...artifact, workflow_run: { id: 34 } };
  await expect(api.select(env, upload)).resolves.toEqual({
    artifact: '56',
    digest: 'c'.repeat(64),
    run: '34',
  });
  await expect(api.select(env, upload)).resolves.toEqual({
    artifact: '56',
    digest: 'c'.repeat(64),
    run: '34',
  });
  expect(api.writes).toHaveLength(2);
  await expect(api.select({ ...env, RETAINED_DIGEST: 'd'.repeat(64) }, upload)).rejects.toThrow(
    'differs from the ledger',
  );
  await expect(service([reserved]).select({ ...reuse, MODE: 'retain' })).rejects.toThrow(
    'Only the preparing run',
  );
});

test('workflow reuse binds the source, original run, artifact ID, and independently recorded digest', async () => {
  await expect(service([retained]).select(reuse)).resolves.toEqual({
    artifact: '56',
    digest: 'c'.repeat(64),
    run: '12',
  });
  await expect(service([reserved]).select(reuse)).rejects.toThrow('incomplete');
  await expect(service().select(reuse)).rejects.toThrow('reservation differs');
  await expect(service([retained]).select({ ...reuse, RETAINED_DIGEST: '' })).rejects.toThrow(
    'manifest digest are required',
  );
  await expect(
    service([retained]).select({ ...reuse, RETAINED_DIGEST: 'd'.repeat(64) }),
  ).rejects.toThrow('differs from the ledger');
  await expect(service([retained]).select({ ...reuse, RETAINED_ARTIFACT: '57' })).rejects.toThrow(
    'differs from the ledger',
  );
  await expect(service([retained]).select(reuse, { ...artifact, expired: true })).rejects.toThrow(
    'expired',
  );
  await expect(
    service([retained]).select(reuse, { ...artifact, name: 'different-source' }),
  ).rejects.toThrow('identity differs');
  await expect(service([retained]).select({ ...reuse, RETAINED_RUN: '99' })).rejects.toThrow(
    'reservation differs',
  );
});

test('only explicit publication dispatch can write after every retained consumer lane succeeds', () => {
  const workflow = z
    .object({
      concurrency: z.object({ 'cancel-in-progress': z.literal(false), group: z.string() }),
      jobs: z.object({
        consumers: z.object({ needs: z.literal('retain') }),
        publish: z.object({
          environment: z.literal('npm-publication'),
          if: z.literal("inputs.mode == 'publish'"),
          needs: z.array(z.string()),
          permissions: permissions.extend({
            contents: z.literal('write'),
            'id-token': z.literal('write'),
          }),
          steps: z.array(
            z.object({
              env: z.record(z.string(), z.string()).optional(),
              name: z.string(),
              run: z.string().optional(),
            }),
          ),
        }),
        retain: z.object({ needs: z.literal('selection') }),
        selection: z.object({ steps: z.array(z.object({ name: z.string(), run: z.string() })) }),
      }),
      on: z.object({ workflow_dispatch: z.unknown() }).strict(),
    })
    .parse(
      parse(
        readFileSync(
          new URL('../../../.github/workflows/publication.yml', import.meta.url),
          'utf8',
        ),
      ),
    );
  expect(workflow.jobs.publish.needs).toEqual(['retain', 'consumers']);
  expect(workflow.concurrency.group).toBe('publication-artifacts');
  const publish = workflow.jobs.publish.steps.find(
    (entry) => entry.name === 'Publish or resume the retained release',
  );
  expect(publish?.run).toContain('publication publish');
  expect(publish?.run).toContain('--run "$ARTIFACT_RUN" --artifact "$ARTIFACT_ID"');
  expect(publish?.env?.NODE_AUTH_TOKEN).toBe(`\${{ secrets.NPM_OPERATIONS_TOKEN }}`);
  expect(
    workflow.jobs.publish.steps.filter((entry) => entry.env?.NODE_AUTH_TOKEN !== undefined),
  ).toHaveLength(1);
  const validation = workflow.jobs.selection.steps[0];
  expect(validation?.run).toContain('"$GITHUB_SHA" != "$SOURCE"');
});
