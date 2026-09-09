import {
  createRelease,
  createTag,
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

export interface RecordRequest {
  githubApi: string;
  plan: ReleasePlan;
  registry: string;
  repository: string;
  retry: RetryPolicy;
  token: string;
}

// Reconciles the tag, the Release, and its assets with the versions the registry already carries.
// Every step reads before it writes, and the bytes are verified before the first write.
export async function recordRelease(request: RecordRequest): Promise<string> {
  const { plan, retry } = request;
  const version = plan.version;
  const tag = `v${version}`;
  const target = { api: request.githubApi, repository: request.repository, token: request.token };
  const source = `git+https://github.com/${request.repository}@`;
  const lines: string[] = [];
  const uploads = [];
  for (const library of plan.libraries) {
    const name = library.name;
    const subject = `${name}@${version}`;
    const published = await until(retry, `${subject} on the registry`, async () =>
      readPublished(request.registry, name, version),
    );
    lines.push(`Read ${subject} from the registry.`);
    const provenance = await until(retry, `the provenance of ${subject}`, async () =>
      readProvenance(request.registry, name, version),
    );
    if (!provenance.uri.startsWith(source)) {
      throw new Error(
        `${subject}: its provenance names ${provenance.uri}, which is not a build of ${request.repository}.`,
      );
    }
    const bytes = await readBytes(published.tarball);
    verifyIntegrity(subject, bytes, published.integrity);
    lines.push(`Verified the ${subject} tarball against ${published.integrity}.`);
    uploads.push({ bytes, commit: provenance.commit, name: tarballName(name, version), subject });
  }
  const [first, ...rest] = uploads;
  if (first === undefined) {
    throw new Error('The plan names no participating libraries.');
  }
  const disagreeing = rest.find((upload) => upload.commit !== first.commit);
  if (disagreeing !== undefined) {
    throw new Error(
      `${disagreeing.subject} was published from ${disagreeing.commit}, but ${first.subject} was published from ${first.commit}.`,
    );
  }
  const commit = first.commit;
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
    if (present !== undefined && present.size > 0) {
      lines.push(`Kept the ${upload.name} asset.`);
    } else {
      if (present !== undefined) {
        await removeAsset(target, present.id);
        lines.push(`Deleted the empty ${upload.name} asset.`);
      }
      await uploadAsset(target, release.uploadUrl, upload.name, upload.bytes);
      await until(retry, `the ${upload.name} asset`, async () => {
        const uploaded = await readAssets(target, release.id);
        return uploaded.find((asset) => asset.name === upload.name && asset.size > 0);
      });
      lines.push(`Uploaded the ${upload.name} asset.`);
    }
  }
  lines.push(`Recorded ${tag}.`);
  return `${lines.join('\n')}\n`;
}
