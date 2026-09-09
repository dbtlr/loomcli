import { z } from 'zod';

import { isUploadedAsset, readRelease, readTagCommit } from './github.js';
import type { HttpPolicy } from './http.js';
import { locateRelease } from './markdown.js';
import { materialBaseline } from './material.js';
import { readProvenance, readPublished, tarballName } from './registry.js';
import type { RegistryTarget } from './registry.js';
import {
  currentVersion,
  git,
  readLibraries,
  readRegularFile,
  requireFullHistory,
} from './repository.js';

type ReleaseAssets = NonNullable<Awaited<ReturnType<typeof readRelease>>>['assets'];

const librarySchema = z.object({
  directory: z.string().min(1),
  name: z.string().min(1),
  published: z.boolean(),
});

const releaseFactsSchema = z.object({ present: z.boolean() });

const tagFactsSchema = z.object({ commit: z.string().nullable(), present: z.boolean() });

// The manifests carry this version until the initial cut, and it is never published, tagged, or released.
const unreleasedVersion = '0.0.0';

// A heading, a rule, and raw HTML carry no notes, so a section built only from them says nothing.
const decorations = new Set(['heading', 'html', 'thematicBreak']);

// The notes are the body under the version's heading, up to the next release heading.
function changelogSection(changelog: string, version: string) {
  const { body, index, nodes, releases } = locateRelease(changelog, version);
  const start = releases[index]?.position?.end.offset;
  if (start === undefined) {
    throw new Error(`CHANGELOG.md has no v${version} section.`);
  }
  const end = releases[index + 1]?.position?.start.offset ?? body.length;
  const carries = nodes.some((node) => {
    const offset = node.position?.start.offset;
    return offset !== undefined && offset >= start && offset < end && !decorations.has(node.type);
  });
  if (!carries) {
    throw new Error(`CHANGELOG.md: the v${version} section has no notes.`);
  }
  return body.slice(start, end).trim();
}

// A Release is complete once it carries every expected asset as a finished upload.
// The exception: a Release that carries none of the expected assets but carries others was recorded by another process, and it is left alone.
function releaseComplete(assets: ReleaseAssets, expected: string[]) {
  const carriesExpected = expected.some((name) => assets.some((asset) => asset.name === name));
  if (!carriesExpected && assets.length > 0) {
    return true;
  }
  return expected.every((name) =>
    assets.some((asset) => asset.name === name && isUploadedAsset(asset)),
  );
}

function abandon(version: string, reason: string) {
  return new Error(
    `Version ${version} is absent from the registry and ${reason} Publication attests the head, so ${version} must be abandoned as unpublished and superseded by the next cut.`,
  );
}

// Every participating library, named without a registry read, because the unreleased version is never published.
function unreleasedLibraries(
  participants: ReturnType<typeof readLibraries>,
): ReleasePlan['libraries'] {
  const [first, ...others] = participants;
  const libraries: ReleasePlan['libraries'] = [
    { directory: first.directory, name: first.manifest.name, published: false },
  ];
  for (const other of others) {
    libraries.push({ directory: other.directory, name: other.manifest.name, published: false });
  }
  return libraries;
}

// The registry facts of one participating library at the released version.
async function describeLibrary(
  registry: RegistryTarget,
  participant: ReturnType<typeof readLibraries>[number],
  version: string,
) {
  const name = participant.manifest.name;
  const published = await readPublished(registry, name, version);
  return { directory: participant.directory, name, published: published !== undefined };
}

// Every published library attests the same build commit, and that commit is where the tag belongs.
async function publishedCommit(
  registry: RegistryTarget,
  libraries: ReleasePlan['libraries'],
  version: string,
) {
  let commit: string | undefined = undefined;
  for (const library of libraries) {
    const provenance = await readProvenance(registry, library.name, version);
    if (provenance === undefined) {
      return undefined;
    }
    if (commit !== undefined && provenance.commit !== commit) {
      throw new Error(
        `${library.name}@${version} was published from ${provenance.commit}, but an earlier library names ${commit}.`,
      );
    }
    commit = provenance.commit;
  }
  return commit;
}

// A tag anywhere other than the commit the version was published from fails the run, and recording never moves one.
function requireTagAtPublication(
  tag: string,
  tagCommit: string | undefined,
  provenanceCommit: string | null,
  version: string,
) {
  if (tagCommit === undefined) {
    return;
  }
  if (provenanceCommit === null) {
    throw new Error(
      `Tag ${tag} names ${tagCommit}, but the registry reports no provenance for ${version}, so the commit it was published from is unknown.`,
    );
  }
  if (tagCommit !== provenanceCommit) {
    throw new Error(
      `Tag ${tag} names ${tagCommit}, but ${version} was published from ${provenanceCommit}; recording never moves a tag.`,
    );
  }
}

// The paths whose bytes can reach a published library build.
// Publication attests the head commit, so a change to any of them after the cut commit would attest bytes the cut did not produce.
// Documentation and root Markdown are absent from this set and never refuse a publication.
const sharedBuildInputs = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/clean.mjs',
  'tsconfig.json',
];

export const planSchema = z
  .object({
    cutCommit: z.string().min(1),
    head: z.string().min(1),
    // A release participates with at least one library, and the record command reads the first one.
    libraries: z.tuple([librarySchema], librarySchema),
    notes: z.string(),
    provenanceCommit: z.string().min(1).nullable(),
    publish: z.boolean(),
    record: z.boolean(),
    release: releaseFactsSchema,
    tag: tagFactsSchema,
    version: z.string().min(1),
  })
  // The notes are the body of the Release, so only the unreleased version plans without them.
  .refine((plan) => plan.notes !== '' || plan.version === unreleasedVersion, {
    error: 'A plan for a released version carries notes.',
    path: ['notes'],
  });

export type ReleasePlan = z.output<typeof planSchema>;

export interface PlanRequest {
  githubApi: string;
  head: string;
  policy: HttpPolicy;
  registry: string;
  repository: string;
  root: string;
  token: string | undefined;
}

export async function planRelease(request: PlanRequest): Promise<ReleasePlan> {
  requireFullHistory(request.root);
  const head = git(request.root, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${request.head}^{commit}`,
  ]).trim();
  const participants = readLibraries(request.root, head);
  const version = currentVersion(participants).text;
  const cutCommit = materialBaseline(request.root, participants, version, head);
  // The unreleased version has no registry record, no changelog section, and nothing to reconcile.
  if (version === unreleasedVersion) {
    return {
      cutCommit,
      head,
      libraries: unreleasedLibraries(participants),
      notes: '',
      provenanceCommit: null,
      publish: false,
      record: false,
      release: { present: false },
      tag: { commit: null, present: false },
      version,
    };
  }
  const changelog = readRegularFile(request.root, 'CHANGELOG.md', head);
  const notes = changelogSection(changelog, version);
  const [participant, ...others] = participants;
  const registry = { policy: request.policy, registry: request.registry };
  const libraries: ReleasePlan['libraries'] = [
    await describeLibrary(registry, participant, version),
  ];
  for (const other of others) {
    libraries.push(await describeLibrary(registry, other, version));
  }
  const tag = `v${version}`;
  const target = {
    api: request.githubApi,
    policy: request.policy,
    repository: request.repository,
    token: request.token,
  };
  const tagCommit = await readTagCommit(target, tag);
  const release = await readRelease(target, tag);
  const publish = libraries.some((library) => !library.published);
  let provenanceCommit: string | null = null;
  if (publish) {
    const changed = git(request.root, [
      'diff',
      '--name-only',
      '-z',
      cutCommit,
      head,
      '--',
      ...libraries.map((library) => library.directory),
      ...sharedBuildInputs,
    ])
      .split('\0')
      .filter(Boolean);
    if (changed.length > 0) {
      const paths = changed.join(', ');
      throw abandon(
        version,
        `${paths} changed between the cut commit ${cutCommit} and the head ${head}.`,
      );
    }
    if (tagCommit !== undefined && tagCommit !== head) {
      throw abandon(version, `tag ${tag} already names ${tagCommit} instead of the head ${head}.`);
    }
  } else {
    provenanceCommit = (await publishedCommit(registry, libraries, version)) ?? null;
    requireTagAtPublication(tag, tagCommit, provenanceCommit, version);
  }
  const expected = libraries.map((library) => tarballName(library.name, version));
  return {
    cutCommit,
    head,
    libraries,
    notes,
    provenanceCommit,
    publish,
    record:
      tagCommit === undefined ||
      release === undefined ||
      !releaseComplete(release.assets, expected),
    release: { present: release !== undefined },
    tag: { commit: tagCommit ?? null, present: tagCommit !== undefined },
    version,
  };
}

export function renderPlan(plan: ReleasePlan) {
  const tag = `v${plan.version}`;
  if (plan.version === unreleasedVersion) {
    return `${plan.version} is the unreleased version at head ${plan.head}, so there is nothing to reconcile.\nPublish: no. Record: no.\n`;
  }
  const lines = [
    `Plan ${tag} at head ${plan.head}, cut commit ${plan.cutCommit}.`,
    ...plan.libraries.map(
      (library) =>
        `${library.name}: ${library.published ? 'published' : 'absent from the registry'}.`,
    ),
    `Tag ${tag}: ${plan.tag.commit === null ? 'absent' : `present at ${plan.tag.commit}`}.`,
    `Release ${tag}: ${plan.release.present ? 'present' : 'absent'}.`,
    `Publish: ${plan.publish ? 'yes' : 'no'}. Record: ${plan.record ? 'yes' : 'no'}.`,
  ];
  return `${lines.join('\n')}\n`;
}
