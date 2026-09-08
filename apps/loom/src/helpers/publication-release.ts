import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { fromMarkdown } from 'mdast-util-from-markdown';
import { z } from 'zod';

import { verifyArtifacts } from './publication.js';
import { readLibraries, readRegularFile } from './repository.js';

interface PublicationServices {
  npm(args: string[]): Promise<{ status: number; stdout: string }>;
  github(method: string, path: string, body?: unknown): Promise<unknown>;
  download(id: number): Promise<Buffer>;
  upload(id: number, name: string, bytes: Buffer): Promise<void>;
}
interface PublicationOptions {
  artifacts: string;
  digest: string;
  head: string;
  repository: string;
  run: string;
  artifact: string;
}
const id = z.string().regex(/^[1-9][0-9]*$/u);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.string().regex(/^0\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u);
const reservationIdentity = z.object({
  base: sha,
  run: id,
  source: sha,
  title: z.string(),
  version,
});
const reservation = z.discriminatedUnion('state', [
  reservationIdentity.extend({ state: z.literal('reserved') }),
  reservationIdentity.extend({ artifact: id, digest: hash, state: z.literal('retained') }),
]);
const releaseSchema = z.object({
  body: z.string(),
  draft: z.boolean(),
  id: z.number().int().positive(),
  name: z.string(),
  prerelease: z.boolean(),
  tag_name: z.string(),
  target_commitish: z.string(),
});
const assetSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  size: z.number(),
  state: z.string(),
});

function later(left: string, right: string) {
  const leftParts = version.parse(left).split('.').map(BigInt);
  const rightParts = version.parse(right).split('.').map(BigInt);
  return (
    (leftParts[1] ?? 0n) > (rightParts[1] ?? 0n) ||
    (leftParts[1] === rightParts[1] && (leftParts[2] ?? 0n) > (rightParts[2] ?? 0n))
  );
}
function releaseNotes(root: string, source: string, target: string) {
  const text = readRegularFile(root, 'CHANGELOG.md', source);
  const headings = fromMarkdown(text).children.filter(
    (node) => node.type === 'heading' && node.depth === 2,
  );
  const matches = headings.filter(
    (node) =>
      node.type === 'heading' &&
      node.children.length === 1 &&
      node.children[0]?.type === 'text' &&
      node.children[0].value.startsWith(`v${target} - `),
  );
  const heading = matches[0];
  if (matches.length !== 1 || heading === undefined) {
    throw new Error('Expected one release changelog section.');
  }
  const next = headings[headings.indexOf(heading) + 1];
  const notes = text.slice(heading.position?.end.offset, next?.position?.start.offset).trim();
  if (!notes) {
    throw new Error('Release notes are empty.');
  }
  return notes;
}
async function npmOutput(
  services: PublicationServices,
  args: string[],
  absent = false,
): Promise<string | undefined> {
  const result = await services.npm([...args, '--json']);
  if (result.status !== 0) {
    const data: unknown = JSON.parse(result.stdout);
    const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(data);
    if (absent && error.success && error.data.error.code === 'E404') {
      return undefined;
    }
    throw new Error(`npm ${args[0]} failed. Stop and inspect the authenticated registry state.`);
  }
  return result.stdout;
}
async function npmJson(
  services: PublicationServices,
  args: string[],
  absent = false,
): Promise<unknown> {
  const output = await npmOutput(services, args, absent);
  return output === undefined ? undefined : JSON.parse(output);
}
async function registryPackage(services: PublicationServices, name: string, target: string) {
  const data = await npmJson(services, ['view', `${name}@${target}`], true);
  if (data === undefined) {
    return undefined;
  }
  const pkg = z
    .object({
      dist: z.object({ integrity: z.string() }),
      name: z.literal(name),
      version: z.literal(target),
    })
    .parse(data);
  return pkg.dist.integrity;
}
async function latestTag(services: PublicationServices, name: string) {
  // Npm view resolves the default latest version, which does not exist during bootstrap staging.
  const output = await npmOutput(services, ['dist-tag', 'ls', name], true);
  if (output === undefined) {
    return undefined;
  }
  const tags = new Map<string, string>();
  for (const line of output.trim().split('\n')) {
    const match = /^(?<tag>[^\s]+): (?<version>[^\s]+)$/u.exec(line.trim());
    if (!match?.groups?.tag || !match.groups.version || tags.has(match.groups.tag)) {
      throw new Error('Invalid npm dist-tag listing. Stop for reconciliation.');
    }
    tags.set(match.groups.tag, match.groups.version);
  }
  return tags.get('latest');
}
async function mutateNpm(services: PublicationServices, args: string[]) {
  const result = await services.npm([...args, '--json']);
  if (result.status !== 0) {
    throw new Error(
      `npm ${args[0]} failed. Resume the same retained set to reconcile external state.`,
    );
  }
}

export async function publishPublication(
  root: string,
  options: PublicationOptions,
  services: PublicationServices,
) {
  const repository = z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)
    .parse(options.repository);
  id.parse(options.run);
  id.parse(options.artifact);
  const manifest = verifyArtifacts(root, options);
  for (const library of readLibraries(root, manifest.source)) {
    const location = z
      .object({
        type: z.literal('git'),
        url: z.literal(`git+https://github.com/${repository}.git`),
      })
      .safeParse(library.manifest.repository);
    if (!location.success) {
      throw new Error(
        `${library.manifest.name}: repository URL must match the publishing repository.`,
      );
    }
    z.strictObject({ access: z.literal('public').optional() })
      .optional()
      .parse(library.manifest.publishConfig);
  }
  const prefix = `/repos/${repository}`;
  const tagName = `v${manifest.version}`;
  const notes = releaseNotes(root, manifest.source, manifest.version);
  const content = z
    .object({ content: z.string(), encoding: z.literal('base64'), type: z.literal('file') })
    .parse(await services.github('GET', `${prefix}/contents/ledger.json?ref=publication-ledger`));
  const ledger = z
    .object({ records: z.array(reservation), schema: z.literal(1) })
    .parse(JSON.parse(Buffer.from(content.content, 'base64').toString('utf8')));
  const selected = ledger.records.filter(
    (record) => record.source === manifest.source || record.version === manifest.version,
  );
  const record = selected[0];
  if (
    selected.length !== 1 ||
    record === undefined ||
    record.state !== 'retained' ||
    record.source !== manifest.source ||
    record.version !== manifest.version ||
    record.base !== manifest.base ||
    record.title !== manifest.title ||
    record.artifact !== options.artifact ||
    record.run !== options.run ||
    record.digest !== options.digest
  ) {
    throw new Error(
      'Retained identity differs from the publication ledger. Stop for reconciliation.',
    );
  }
  const artifact = z
    .object({
      expired: z.literal(false),
      name: z.literal(`release-${manifest.source}`),
      workflow_run: z.object({ id: z.number().int().positive() }),
    })
    .parse(await services.github('GET', `${prefix}/actions/artifacts/${options.artifact}`));
  if (String(artifact.workflow_run.id) !== options.run) {
    throw new Error('Retained artifact run differs.');
  }

  const files = ['manifest.json', ...manifest.packages.map((pkg) => pkg.file)].map((name) => ({
    bytes: readFileSync(join(resolve(root, options.artifacts), name)),
    name,
  }));
  files.push({
    bytes: Buffer.from(
      `${JSON.stringify({ artifact: options.artifact, base: manifest.base, digest: options.digest, repository, run: options.run, schema: 1, source: manifest.source, version: manifest.version }, null, 2)}\n`,
    ),
    name: 'publication.json',
  });
  const releases: z.infer<typeof releaseSchema>[] = [];
  for (let page = 1; ; page += 1) {
    const entries = z
      .array(releaseSchema)
      .parse(await services.github('GET', `${prefix}/releases?per_page=100&page=${page}`));
    releases.push(...entries);
    if (entries.length < 100) {
      break;
    }
  }
  const matches = releases.filter((entry) => entry.tag_name === tagName);
  if (matches.length > 1) {
    throw new Error('Multiple GitHub Releases name this version.');
  }
  let release = matches[0];
  function checkRelease(entry: z.infer<typeof releaseSchema>) {
    if (
      entry.tag_name !== tagName ||
      entry.name !== manifest.title ||
      entry.body !== notes ||
      entry.prerelease ||
      entry.target_commitish !== manifest.source
    ) {
      throw new Error('GitHub Release identity or notes differ. Stop for reconciliation.');
    }
  }
  if (release) {
    checkRelease(release);
  }
  const newer = releases.some(
    (entry) =>
      !entry.draft &&
      !entry.prerelease &&
      version.safeParse(entry.tag_name.slice(1)).success &&
      later(entry.tag_name.slice(1), manifest.version),
  );

  async function matchingTag() {
    const ref = await services.github('GET', `${prefix}/git/ref/tags/${tagName}`);
    if (ref === undefined) {
      return false;
    }
    const object = z
      .object({ object: z.object({ sha: z.string(), type: z.literal('tag') }) })
      .parse(ref).object;
    const tag = z
      .object({
        object: z.object({ sha: z.literal(manifest.source), type: z.literal('commit') }),
        tag: z.literal(tagName),
      })
      .safeParse(await services.github('GET', `${prefix}/git/tags/${object.sha}`));
    if (!tag.success) {
      throw new Error('Annotated source tag differs. Stop for reconciliation.');
    }
    return true;
  }
  async function matchingAssets(releaseId: number, fill: boolean) {
    const assets: z.infer<typeof assetSchema>[] = [];
    for (let page = 1; ; page += 1) {
      const entries = z
        .array(assetSchema)
        .parse(
          await services.github(
            'GET',
            `${prefix}/releases/${releaseId}/assets?per_page=100&page=${page}`,
          ),
        );
      assets.push(...entries);
      if (entries.length < 100) {
        break;
      }
    }
    if (assets.some((asset) => !files.some((file) => file.name === asset.name))) {
      throw new Error('Unexpected GitHub Release attachment.');
    }
    const missing = [];
    const placeholders: number[] = [];
    for (const file of files) {
      const entries = assets.filter((asset) => asset.name === file.name);
      const asset = entries[0];
      if (entries.length > 1) {
        throw new Error('Duplicate GitHub Release attachment.');
      }
      if (!asset) {
        missing.push(file);
      } else if (asset.state === 'starter' && asset.size === 0) {
        placeholders.push(asset.id);
        missing.push(file);
      } else if (
        asset.state !== 'uploaded' ||
        asset.size !== file.bytes.length ||
        !file.bytes.equals(await services.download(asset.id))
      ) {
        throw new Error(`GitHub Release attachment ${file.name} differs. Stop for reconciliation.`);
      }
    }
    if (fill) {
      for (const placeholder of placeholders) {
        await services.github('DELETE', `${prefix}/releases/assets/${placeholder}`);
      }
      for (const file of missing) {
        await services.upload(releaseId, file.name, file.bytes);
      }
    }
    return missing.length === 0;
  }
  let tagged = await matchingTag();
  const attached = release ? await matchingAssets(release.id, false) : false;
  z.string()
    .min(1)
    .parse(await npmJson(services, ['whoami']));
  const states = [];
  for (const pkg of manifest.packages) {
    const observed = await registryPackage(services, pkg.name, pkg.version);
    if (observed !== undefined && observed !== pkg.integrity) {
      throw new Error(`${pkg.name}: registry integrity differs. Stop for reconciliation.`);
    }
    states.push({
      latest: await latestTag(services, pkg.name),
      pkg,
      present: observed !== undefined,
    });
  }
  const superseded =
    newer ||
    states.some((state) => state.latest !== undefined && later(state.latest, manifest.version));
  if (superseded) {
    if (release && !release.draft && tagged && attached && states.every((state) => state.present)) {
      return {
        digest: options.digest,
        source: manifest.source,
        status: 'complete',
        version: manifest.version,
      };
    }
    throw new Error('A newer release exists. An older incomplete release cannot change latest.');
  }
  for (const { pkg, present } of states) {
    if (!present) {
      verifyArtifacts(root, options);
      await mutateNpm(services, [
        'publish',
        join(resolve(root, options.artifacts), pkg.file),
        '--access',
        'public',
        '--provenance',
        '--tag',
        'loom-staging',
        '--ignore-scripts',
      ]);
    }
  }
  for (const pkg of manifest.packages) {
    if ((await registryPackage(services, pkg.name, pkg.version)) !== pkg.integrity) {
      throw new Error(`${pkg.name}: registry integrity differs after publication.`);
    }
  }
  for (const { pkg } of states) {
    const latest = await latestTag(services, pkg.name);
    if (latest !== undefined && later(latest, pkg.version)) {
      throw new Error('A newer latest tag appeared. Stop for reconciliation.');
    }
    if (latest !== pkg.version) {
      await mutateNpm(services, ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, 'latest']);
    }
  }
  for (const pkg of manifest.packages) {
    if ((await latestTag(services, pkg.name)) !== pkg.version) {
      throw new Error(`${pkg.name}: latest promotion is incomplete.`);
    }
  }
  if (!release) {
    release = releaseSchema.parse(
      await services.github('POST', `${prefix}/releases`, {
        body: notes,
        draft: true,
        name: manifest.title,
        prerelease: false,
        tag_name: tagName,
        target_commitish: manifest.source,
      }),
    );
  }
  if (!tagged) {
    const tag = z.object({ sha: z.string() }).parse(
      await services.github('POST', `${prefix}/git/tags`, {
        message: manifest.title,
        object: manifest.source,
        tag: tagName,
        type: 'commit',
      }),
    );
    await services.github('POST', `${prefix}/git/refs`, {
      ref: `refs/tags/${tagName}`,
      sha: tag.sha,
    });
    tagged = await matchingTag();
  }
  await matchingAssets(release.id, true);
  if (!(await matchingAssets(release.id, false))) {
    throw new Error('GitHub Release attachments are incomplete.');
  }
  if (release.draft) {
    release = releaseSchema.parse(
      await services.github('PATCH', `${prefix}/releases/${release.id}`, {
        draft: false,
        make_latest: 'false',
      }),
    );
  }
  release = releaseSchema.parse(await services.github('GET', `${prefix}/releases/${release.id}`));
  checkRelease(release);
  for (const pkg of manifest.packages) {
    if (
      (await registryPackage(services, pkg.name, pkg.version)) !== pkg.integrity ||
      (await latestTag(services, pkg.name)) !== pkg.version
    ) {
      throw new Error('Registry publication is incomplete.');
    }
  }
  if (!(await matchingTag()) || !(await matchingAssets(release.id, false))) {
    throw new Error('Release evidence is incomplete.');
  }
  if (release.draft || !tagged) {
    throw new Error('GitHub Release publication is incomplete.');
  }
  return {
    digest: options.digest,
    source: manifest.source,
    status: 'complete',
    version: manifest.version,
  };
}

export type { PublicationOptions, PublicationServices };
