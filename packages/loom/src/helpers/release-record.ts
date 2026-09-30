import {
  createRelease,
  createTag,
  isUploadedAsset,
  readAssets,
  readRelease,
  readTagCommit,
  removeAsset,
  uploadAsset,
} from './github.js';
import { readBytes, until } from './http.js';
import type { RetryPolicy } from './http.js';
import { readProvenance, readPublished, tarballName, verifyIntegrity } from './registry.js';
import type { ReleasePlan } from './release-plan.js';
import { git } from './repository.js';

// The bytes, the build commit, and the asset name of one published library.
async function readUpload(
  request: RecordRequest,
  library: ReleasePlan['libraries'][number],
  lines: string[],
) {
  const { plan, retry } = request;
  const registry = { policy: retry, registry: request.registry };
  const name = library.name;
  const subject = `${name}@${plan.version}`;
  const published = await until(retry, `${subject} on the registry`, async () =>
    readPublished(registry, name, plan.version),
  );
  lines.push(`Read ${subject} from the registry.`);
  const provenance = await until(retry, `the provenance of ${subject}`, async () =>
    readProvenance(registry, name, plan.version),
  );
  const source = `git+https://github.com/${request.repository}@refs/heads/main`;
  if (provenance.uri !== source) {
    throw new Error(
      `${subject}: its provenance names ${provenance.uri}, which is not a build of ${source}.`,
    );
  }
  const bytes = await until(retry, `the ${subject} tarball`, async () =>
    readBytes(retry, published.tarball),
  );
  verifyIntegrity(subject, bytes, published.integrity);
  lines.push(`Verified the ${subject} tarball against ${published.integrity}.`);
  return { bytes, commit: provenance.commit, name: tarballName(name, plan.version), subject };
}

// Provenance attests a commit of this repository, and the checkout proves it is one this branch carries.
function requireCommitInCheckout(root: string, commit: string, subject: string) {
  const head = git(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']).trim();
  if (head === commit) {
    return;
  }
  try {
    git(root, ['merge-base', '--is-ancestor', commit, head]);
  } catch {
    throw new Error(
      `${subject} was published from ${commit}, which is neither the head ${head} of the checkout nor an ancestor of it.`,
    );
  }
}

export interface RecordRequest {
  githubApi: string;
  plan: ReleasePlan;
  registry: string;
  repository: string;
  retry: RetryPolicy;
  root: string;
  token: string;
}

// Reconciles the tag, the Release, and its assets with the versions the registry already carries.
// Every step reads before it writes, and the bytes are verified before the first write.
export async function recordRelease(request: RecordRequest): Promise<string> {
  const { plan, retry } = request;
  const version = plan.version;
  const tag = `v${version}`;
  const target = {
    api: request.githubApi,
    policy: retry,
    repository: request.repository,
    token: request.token,
  };
  const lines: string[] = [];
  const first = await readUpload(request, plan.libraries[0], lines);
  const uploads = [first];
  for (const library of plan.libraries.slice(1)) {
    const upload = await readUpload(request, library, lines);
    if (upload.commit !== first.commit) {
      throw new Error(
        `${upload.subject} was published from ${upload.commit}, but ${first.subject} was published from ${first.commit}.`,
      );
    }
    uploads.push(upload);
  }
  const commit = first.commit;
  requireCommitInCheckout(request.root, commit, tag);
  const tagged = await readTagCommit(target, tag);
  if (tagged === undefined) {
    await createTag(target, tag, commit);
    await until(retry, `the tag ${tag}`, async () => readTagCommit(target, tag));
    lines.push(`Created the annotated tag ${tag} at ${commit}.`);
  } else if (tagged === commit) {
    lines.push(`Reused the tag ${tag} at ${commit}.`);
  } else {
    throw new Error(
      `Tag ${tag} names ${tagged}, but ${version} was published from ${commit}; recording never moves a tag.`,
    );
  }
  const found = await readRelease(target, tag);
  if (found === undefined) {
    await createRelease(target, tag, plan.notes);
  }
  const release =
    found ?? (await until(retry, `the ${tag} Release`, async () => readRelease(target, tag)));
  lines.push(found === undefined ? `Created the ${tag} Release.` : `Reused the ${tag} Release.`);
  for (const upload of uploads) {
    const assets = await readAssets(target, release.id);
    const present = assets.find((asset) => asset.name === upload.name);
    if (present !== undefined && isUploadedAsset(present)) {
      lines.push(`Kept the ${upload.name} asset.`);
    } else {
      if (present !== undefined) {
        await removeAsset(target, present.id);
        lines.push(`Deleted the unfinished ${upload.name} asset.`);
      }
      await uploadAsset(target, release.uploadUrl, upload.name, upload.bytes);
      await until(retry, `the ${upload.name} asset`, async () => {
        const uploaded = await readAssets(target, release.id);
        return uploaded.find((asset) => asset.name === upload.name && isUploadedAsset(asset));
      });
      lines.push(`Uploaded the ${upload.name} asset.`);
    }
  }
  lines.push(`Recorded ${tag}.`);
  return `${lines.join('\n')}\n`;
}
