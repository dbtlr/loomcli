import { fromMarkdown } from 'mdast-util-from-markdown';
import { z } from 'zod';

import { readRelease, readTagCommit } from './github.js';
import { headingText } from './markdown.js';
import { materialBaseline } from './material.js';
import { readPublished } from './registry.js';
import { currentVersion, git, readLibraries, readRegularFile } from './repository.js';

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

const librarySchema = z.object({
  directory: z.string().min(1),
  name: z.string().min(1),
  published: z.boolean(),
});

const releaseFactsSchema = z.object({ id: z.number().nullable(), present: z.boolean() });

const tagFactsSchema = z.object({ commit: z.string().nullable(), present: z.boolean() });

// The notes are the body under the version's heading, up to the next release heading.
function changelogSection(changelog: string, version: string) {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/u.exec(changelog)?.[0] ?? '';
  const body = changelog.slice(frontmatter.length);
  const headings = fromMarkdown(body).children.flatMap((node) =>
    node.type === 'heading' && node.depth === 2 ? [node] : [],
  );
  const index = headings.findIndex(
    (heading) => headingText(heading).trim().split(/\s/u)[0] === `v${version}`,
  );
  const start = headings[index]?.position?.end.offset;
  if (start === undefined) {
    throw new Error(`CHANGELOG.md has no v${version} section.`);
  }
  const end = headings[index + 1]?.position?.start.offset ?? body.length;
  const notes = body.slice(start, end).trim();
  if (notes === '') {
    throw new Error(`CHANGELOG.md: the v${version} section has no notes.`);
  }
  return notes;
}

function abandon(version: string, reason: string) {
  return new Error(
    `Version ${version} is absent from the registry and ${reason} Publication attests the head, so ${version} must be abandoned as unpublished and superseded by the next cut.`,
  );
}

export const planSchema = z.object({
  cutCommit: z.string().min(1),
  head: z.string().min(1),
  libraries: z.array(librarySchema).min(1),
  notes: z.string().min(1),
  publish: z.boolean(),
  record: z.boolean(),
  release: releaseFactsSchema,
  tag: tagFactsSchema,
  version: z.string().min(1),
});

export type ReleasePlan = z.output<typeof planSchema>;

export interface PlanRequest {
  githubApi: string;
  head: string;
  registry: string;
  repository: string;
  root: string;
  token: string | undefined;
}

export async function planRelease(request: PlanRequest): Promise<ReleasePlan> {
  const head = git(request.root, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${request.head}^{commit}`,
  ]).trim();
  const participants = readLibraries(request.root, head);
  const version = currentVersion(participants).text;
  const cutCommit = materialBaseline(request.root, participants, version, head);
  const changelog = readRegularFile(request.root, 'CHANGELOG.md', head);
  const notes = changelogSection(changelog, version);
  const libraries = [];
  for (const participant of participants) {
    const name = participant.manifest.name;
    const published = await readPublished(request.registry, name, version);
    libraries.push({ directory: participant.directory, name, published: published !== undefined });
  }
  const tag = `v${version}`;
  const target = { api: request.githubApi, repository: request.repository, token: request.token };
  const tagCommit = await readTagCommit(target, tag);
  const release = await readRelease(target, tag);
  const publish = libraries.some((library) => !library.published);
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
  }
  return {
    cutCommit,
    head,
    libraries,
    notes,
    publish,
    record: tagCommit === undefined || release === undefined,
    release: { id: release?.id ?? null, present: release !== undefined },
    tag: { commit: tagCommit ?? null, present: tagCommit !== undefined },
    version,
  };
}

export function renderPlan(plan: ReleasePlan) {
  const tag = `v${plan.version}`;
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
