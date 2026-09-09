import { z } from 'zod';

import { readJson, removeResource, writeBytes, writeJson } from './http.js';

const objectSchema = z.looseObject({ sha: z.string().min(1), type: z.string() });

const referenceSchema = z.looseObject({ object: objectSchema });

const targetSchema = z.looseObject({ sha: z.string().min(1) });

const tagObjectSchema = z.looseObject({ object: targetSchema, sha: z.string().min(1) });

const assetSchema = z.looseObject({ id: z.number(), name: z.string(), size: z.number() });

const assetsSchema = z.array(assetSchema);

const releaseSchema = z
  .looseObject({ assets: assetsSchema, id: z.number(), upload_url: z.string().min(1) })
  .transform((release) => ({
    assets: release.assets,
    id: release.id,
    uploadUrl: release.upload_url,
  }));

function repositoryUrl(target: { api: string; repository: string }, path: string) {
  return `${target.api.replace(/\/+$/u, '')}/repos/${target.repository}/${path}`;
}

export interface GitHubTarget {
  api: string;
  repository: string;
  token: string | undefined;
}

// Every write needs a token, which the record command requires before it reads anything.
export interface GitHubWriter extends GitHubTarget {
  token: string;
}

// The tag reference names an annotated tag object or the commit itself, and callers want the commit.
export async function readTagCommit(target: GitHubTarget, tag: string) {
  const { data } = await readJson(repositoryUrl(target, `git/ref/tags/${tag}`), target.token);
  if (data === undefined) {
    return undefined;
  }
  const { object } = referenceSchema.parse(data);
  if (object.type !== 'tag') {
    return object.sha;
  }
  const url = repositoryUrl(target, `git/tags/${object.sha}`);
  const dereferenced = await readJson(url, target.token);
  return tagObjectSchema.parse(dereferenced.data).object.sha;
}

export async function readRelease(target: GitHubTarget, tag: string) {
  const { data } = await readJson(repositoryUrl(target, `releases/tags/${tag}`), target.token);
  return data === undefined ? undefined : releaseSchema.parse(data);
}

export async function readAssets(target: GitHubTarget, id: number) {
  const url = repositoryUrl(target, `releases/${String(id)}/assets`);
  const { data } = await readJson(url, target.token);
  return assetsSchema.parse(data);
}

export async function createTag(target: GitHubWriter, tag: string, commit: string) {
  const created = await writeJson(repositoryUrl(target, 'git/tags'), target.token, {
    message: tag,
    object: commit,
    tag,
    type: 'commit',
  });
  const object = targetSchema.parse(created);
  await writeJson(repositoryUrl(target, 'git/refs'), target.token, {
    ref: `refs/tags/${tag}`,
    sha: object.sha,
  });
}

export async function createRelease(target: GitHubWriter, tag: string, body: string) {
  await writeJson(repositoryUrl(target, 'releases'), target.token, {
    body,
    draft: false,
    name: tag,
    prerelease: false,
    tag_name: tag,
  });
}

export async function removeAsset(target: GitHubWriter, id: number) {
  await removeResource(repositoryUrl(target, `releases/assets/${String(id)}`), target.token);
}

// The Release publishes its upload endpoint as a URI template whose parameters this call supplies.
export async function uploadAsset(
  target: GitHubWriter,
  uploadUrl: string,
  name: string,
  bytes: Buffer,
) {
  const endpoint = `${uploadUrl.replace('{?name,label}', '')}?name=${encodeURIComponent(name)}`;
  await writeBytes(endpoint, target.token, bytes, 'application/gzip');
}
