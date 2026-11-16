/*
 * The operator sentences of `loom release`, under ADR-0164: the failures its work and the helpers
 * that serve it raise, which cut a release, prepare its lockfile, read GitHub and the registry, and
 * plan and record a release, and the lines a release plan and a release record print. `loom pr
 * check` checks a release's files and its baseline through the same helpers, so its route loads
 * this module too. A launch never loads it, because only the release's work and those helpers
 * import it. Each is a function of the values it repeats, or a constant, and the code that raises
 * the failure or writes the line calls it. Every value a sentence repeats is escaped, except
 * `output`: the text another program or a service wrote, which a sentence repeats whole, its lines
 * included. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** Escapes one value a sentence repeats. */
const escaped = escapeControlCharacters;

// Repository reads.

/**
 * The failure of a version no first-parent commit sets.
 *
 * @example
 * ```ts
 * noVersionCommit('0.4.0'); // 'No first-parent commit sets version 0.4.0.'
 * ```
 */
function noVersionCommit(version: string): string {
  return `No first-parent commit sets version ${escaped(version)}.`;
}

// Synchronized releases.

/**
 * The failure of `--initial` on libraries past 0.0.0.
 *
 * @example
 * ```ts
 * initialNeedsZero; // '--initial requires library version 0.0.0.'
 * ```
 */
const initialNeedsZero = '--initial requires library version 0.0.0.';

/**
 * The failure of a synchronized cut with no fragment.
 *
 * @example
 * ```ts
 * noFragments; // 'No fragments to release.'
 * ```
 */
const noFragments = 'No fragments to release.';

/**
 * The failure of a synchronized release target that is not a stable 0.x version.
 *
 * @example
 * ```ts
 * stableTargetOnly; // 'Release target must be a stable 0.x version.'
 * ```
 */
const stableTargetOnly = 'Release target must be a stable 0.x version.';

/**
 * The failure of a synchronized release target below the minimum.
 *
 * @example
 * ```ts
 * targetBelowRelease('0.5.0', '0.4.2');
 * // 'Release target must be at least 0.5.0; current version is 0.4.2.'
 * ```
 */
function targetBelowRelease(minimum: string, current: string): string {
  return `Release target must be at least ${escaped(minimum)}; current version is ${escaped(current)}.`;
}

/**
 * The failure of a release that carries no entries and no narrative.
 *
 * @example
 * ```ts
 * releaseWithoutEntries('0.1.0');
 * // 'Release v0.1.0 carries no entries, so it requires a narrative for its notes.'
 * ```
 */
function releaseWithoutEntries(version: string): string {
  return `Release v${escaped(version)} carries no entries, so it requires a narrative for its notes.`;
}

/**
 * The failure of a release cut whose version already has a tag.
 *
 * @example
 * ```ts
 * tagExists('0.5.0'); // 'Tag v0.5.0 already exists.'
 * ```
 */
function tagExists(version: string): string {
  return `Tag v${escaped(version)} already exists.`;
}

// Lockfiles.

/**
 * The failure of lockfile preparation without the optional pnpm peer.
 *
 * @example
 * ```ts
 * pnpmMissing; // 'Preparing pnpm-lock.yaml requires pnpm, an optional peer dependency ...'
 * ```
 */
const pnpmMissing =
  'Preparing pnpm-lock.yaml requires pnpm, an optional peer dependency of @loomcli/loom. Install pnpm 12.16.1 beside @loomcli/loom and run the command again.';

/**
 * The failure of a lockfile that is not YAML.
 *
 * @example
 * ```ts
 * lockfileInvalidYaml; // 'pnpm-lock.yaml is invalid YAML.'
 * ```
 */
const lockfileInvalidYaml = 'pnpm-lock.yaml is invalid YAML.';

/**
 * The failure of lockfile preparation that ran past its limit, in seconds.
 *
 * @example
 * ```ts
 * lockfileTimedOut(60);
 * // 'Lockfile preparation did not finish within 60 seconds, so pnpm was stopped.'
 * ```
 */
function lockfileTimedOut(seconds: number): string {
  return `Lockfile preparation did not finish within ${String(seconds)} seconds, so pnpm was stopped.`;
}

/**
 * The failure of lockfile preparation pnpm refused, with what pnpm wrote.
 *
 * @example
 * ```ts
 * lockfilePreparationFailed('ERR_PNPM_OUTDATED_LOCKFILE ...\n');
 * // 'Lockfile preparation failed:\nERR_PNPM_OUTDATED_LOCKFILE ...\n'
 * ```
 */
function lockfilePreparationFailed(output: string): string {
  return `Lockfile preparation failed:\n${output}`;
}

// Services.

/**
 * The failure of a service that answered with a body that is not JSON.
 *
 * @example
 * ```ts
 * invalidJsonAnswer('https://api.github.com/x'); // 'https://api.github.com/x answered with invalid JSON.'
 * ```
 */
function invalidJsonAnswer(url: string): string {
  return `${escaped(url)} answered with invalid JSON.`;
}

/**
 * The failure of a request a service refused, with the status and what it answered.
 *
 * @example
 * ```ts
 * refusedRequest('GET', 'https://api.github.com/x', 404, '{"message":"Not Found"}');
 * // 'GET https://api.github.com/x answered 404: {"message":"Not Found"}'
 * ```
 */
function refusedRequest(method: string, url: string, status: number, output: string): string {
  return `${escaped(method)} ${escaped(url)} answered ${String(status)}: ${output}`;
}

/**
 * The failure of a request that did not answer within its deadline.
 *
 * @example
 * ```ts
 * requestTimedOut('GET', 'https://api.github.com/x', 30_000);
 * // 'GET https://api.github.com/x did not answer within 30000 ms.'
 * ```
 */
function requestTimedOut(method: string, url: string, deadlineMs: number): string {
  return `${escaped(method)} ${escaped(url)} did not answer within ${String(deadlineMs)} ms.`;
}

/**
 * The failure of a read retried until its attempts ran out.
 *
 * @example
 * ```ts
 * neverAppeared(onRegistry('@acme/notes@1.0.0'), 5);
 * // '@acme/notes@1.0.0 on the registry did not appear after 5 attempts.'
 * ```
 */
function neverAppeared(subject: string, attempts: number): string {
  return `${escaped(subject)} did not appear after ${String(attempts)} attempts.`;
}

/**
 * The failure of a tag whose tag object the API does not return.
 *
 * @example
 * ```ts
 * tagObjectMissing('v1.0.0', 'abc123');
 * // 'Tag v1.0.0 names tag object abc123, which the API does not return.'
 * ```
 */
function tagObjectMissing(tag: string, sha: string): string {
  return `Tag ${escaped(tag)} names tag object ${escaped(sha)}, which the API does not return.`;
}

/**
 * The failure of a Release whose upload endpoint lies at another origin.
 *
 * @example
 * ```ts
 * uploadOriginRefused('https://evil.example', 'https://api.github.com', 'https://uploads.github.com');
 * // 'The Release publishes its upload endpoint at https://evil.example, which is neither ...'
 * ```
 */
function uploadOriginRefused(origin: string, api: string, upload: string): string {
  return `The Release publishes its upload endpoint at ${escaped(origin)}, which is neither ${escaped(api)} nor ${escaped(upload)}.`;
}

/**
 * The failure of provenance that attests other packages than the one read.
 *
 * @example
 * ```ts
 * provenanceElsewhere('@acme/notes', '1.0.0', [], 'pkg:npm/%40acme/notes@1.0.0');
 * // '@acme/notes@1.0.0: its provenance attests nothing, not pkg:npm/%40acme/notes@1.0.0.'
 * ```
 */
function provenanceElsewhere(
  name: string,
  version: string,
  attested: readonly string[],
  purl: string,
): string {
  return `${escaped(name)}@${escaped(version)}: its provenance attests ${escaped(attested.join(', ') || 'nothing')}, not ${escaped(purl)}.`;
}

/**
 * The failure of provenance that resolves no source repository.
 *
 * @example
 * ```ts
 * provenanceWithoutSource('@acme/notes', '1.0.0');
 * // '@acme/notes@1.0.0: its provenance resolves no source repository.'
 * ```
 */
function provenanceWithoutSource(name: string, version: string): string {
  return `${escaped(name)}@${escaped(version)}: its provenance resolves no source repository.`;
}

/**
 * The failure of an integrity the registry reports in a form loom does not verify.
 *
 * @example
 * ```ts
 * unsupportedIntegrity('@acme/notes@1.0.0', 'sha1-abc');
 * // '@acme/notes@1.0.0: the registry reports unsupported integrity sha1-abc.'
 * ```
 */
function unsupportedIntegrity(subject: string, integrity: string): string {
  return `${escaped(subject)}: the registry reports unsupported integrity ${escaped(integrity)}.`;
}

/**
 * The failure of a tarball whose hash is not the registry's integrity.
 *
 * @example
 * ```ts
 * integrityMismatch('@acme/notes@1.0.0', 'xyz', 'sha512-abc');
 * // '@acme/notes@1.0.0: the downloaded tarball hashes to sha512-xyz, not sha512-abc.'
 * ```
 */
function integrityMismatch(subject: string, actual: string, integrity: string): string {
  return `${escaped(subject)}: the downloaded tarball hashes to sha512-${escaped(actual)}, not ${escaped(integrity)}.`;
}

// Release plans.

/**
 * The failure of a plan whose changelog lacks the version's section.
 *
 * @example
 * ```ts
 * noChangelogSection('0.5.0'); // 'CHANGELOG.md has no v0.5.0 section.'
 * ```
 */
function noChangelogSection(version: string): string {
  return `CHANGELOG.md has no v${escaped(version)} section.`;
}

/**
 * The failure of a plan whose version section carries no notes.
 *
 * @example
 * ```ts
 * sectionWithoutNotes('0.5.0'); // 'CHANGELOG.md: the v0.5.0 section has no notes.'
 * ```
 */
function sectionWithoutNotes(version: string): string {
  return `CHANGELOG.md: the v${escaped(version)} section has no notes.`;
}

/**
 * The failure of an unpublished version publication can no longer attest, and why.
 *
 * @example
 * ```ts
 * abandonedVersion('0.5.0', tagNamesOther('v0.5.0', 'abc', 'def'));
 * // 'Version 0.5.0 is absent from the registry and tag v0.5.0 already names abc instead of ...'
 * ```
 */
function abandonedVersion(version: string, reason: string): string {
  return `Version ${escaped(version)} is absent from the registry and ${escaped(reason)} Publication attests the head, so ${escaped(version)} must be abandoned as unpublished and superseded by the next cut.`;
}

/**
 * Why a version is abandoned: build inputs changed after its cut commit.
 *
 * @example
 * ```ts
 * changedSinceCut(['packages/core'], 'abc', 'def');
 * // 'packages/core changed between the cut commit abc and the head def.'
 * ```
 */
function changedSinceCut(paths: readonly string[], cutCommit: string, head: string): string {
  return `${escaped(paths.join(', '))} changed between the cut commit ${escaped(cutCommit)} and the head ${escaped(head)}.`;
}

/**
 * Why a version is abandoned: its tag names another commit than the head.
 *
 * @example
 * ```ts
 * tagNamesOther('v0.5.0', 'abc', 'def'); // 'tag v0.5.0 already names abc instead of the head def.'
 * ```
 */
function tagNamesOther(tag: string, tagCommit: string, head: string): string {
  return `tag ${escaped(tag)} already names ${escaped(tagCommit)} instead of the head ${escaped(head)}.`;
}

/**
 * The failure of libraries whose provenance names different commits.
 *
 * @example
 * ```ts
 * provenanceConflict('@acme/b', '0.5.0', 'def', 'abc');
 * // '@acme/b@0.5.0 was published from def, but an earlier library names abc.'
 * ```
 */
function provenanceConflict(
  name: string,
  version: string,
  commit: string,
  earlier: string,
): string {
  return `${escaped(name)}@${escaped(version)} was published from ${escaped(commit)}, but an earlier library names ${escaped(earlier)}.`;
}

/**
 * The failure of a tag for a version the registry reports no provenance for.
 *
 * @example
 * ```ts
 * tagWithoutProvenance('v0.5.0', 'abc', '0.5.0');
 * // 'Tag v0.5.0 names abc, but the registry reports no provenance for 0.5.0, ...'
 * ```
 */
function tagWithoutProvenance(tag: string, tagCommit: string, version: string): string {
  return `Tag ${escaped(tag)} names ${escaped(tagCommit)}, but the registry reports no provenance for ${escaped(version)}, so the commit it was published from is unknown.`;
}

/**
 * The failure of a tag at another commit than the one its version was published from.
 *
 * @example
 * ```ts
 * tagAwayFromPublication('v0.5.0', 'abc', '0.5.0', 'def');
 * // 'Tag v0.5.0 names abc, but 0.5.0 was published from def; recording never moves a tag.'
 * ```
 */
function tagAwayFromPublication(
  tag: string,
  tagCommit: string,
  version: string,
  commit: string,
): string {
  return `Tag ${escaped(tag)} names ${escaped(tagCommit)}, but ${escaped(version)} was published from ${escaped(commit)}; recording never moves a tag.`;
}

/**
 * The issue of a plan for a released version that carries no notes.
 *
 * @example
 * ```ts
 * planWithoutNotes; // 'A plan for a released version carries notes.'
 * ```
 */
const planWithoutNotes = 'A plan for a released version carries notes.';

/**
 * The plan of the unreleased version, which has nothing to reconcile.
 *
 * @example
 * ```ts
 * unreleasedPlan('0.0.0', 'abc');
 * // '0.0.0 is the unreleased version at head abc, so there is nothing to reconcile.\nPublish: no. Record: no.'
 * ```
 */
function unreleasedPlan(version: string, head: string): string {
  return `${escaped(version)} is the unreleased version at head ${escaped(head)}, so there is nothing to reconcile.\nPublish: no. Record: no.`;
}

/**
 * A plan's first line: the tag, the head, and the cut commit.
 *
 * @example
 * ```ts
 * planHeading('v0.5.0', 'def', 'abc'); // 'Plan v0.5.0 at head def, cut commit abc.'
 * ```
 */
function planHeading(tag: string, head: string, cutCommit: string): string {
  return `Plan ${escaped(tag)} at head ${escaped(head)}, cut commit ${escaped(cutCommit)}.`;
}

/**
 * A plan's line for one library: whether the registry carries it.
 *
 * @example
 * ```ts
 * libraryState('@acme/notes', true); // '@acme/notes: published.'
 * ```
 */
function libraryState(name: string, published: boolean): string {
  return `${escaped(name)}: ${published ? 'published' : 'absent from the registry'}.`;
}

/**
 * A plan's line for the tag: absent, or the commit it names.
 *
 * @example
 * ```ts
 * tagState('v0.5.0', null); // 'Tag v0.5.0: absent.'
 * ```
 */
function tagState(tag: string, commit: string | null): string {
  return `Tag ${escaped(tag)}: ${commit === null ? 'absent' : `present at ${escaped(commit)}`}.`;
}

/**
 * A plan's line for the GitHub Release: present or absent.
 *
 * @example
 * ```ts
 * releaseState('v0.5.0', false); // 'Release v0.5.0: absent.'
 * ```
 */
function releaseState(tag: string, present: boolean): string {
  return `Release ${escaped(tag)}: ${present ? 'present' : 'absent'}.`;
}

/**
 * A plan's last line: whether to publish and whether to record.
 *
 * @example
 * ```ts
 * planDecision(true, true); // 'Publish: yes. Record: yes.'
 * ```
 */
function planDecision(publish: boolean, record: boolean): string {
  return `Publish: ${publish ? 'yes' : 'no'}. Record: ${record ? 'yes' : 'no'}.`;
}

// Release records.

/**
 * What a record waits for: a version on the registry.
 *
 * @example
 * ```ts
 * onRegistry('@acme/notes@1.0.0'); // '@acme/notes@1.0.0 on the registry'
 * ```
 */
function onRegistry(subject: string): string {
  return `${escaped(subject)} on the registry`;
}

/**
 * What a record waits for: a version's provenance.
 *
 * @example
 * ```ts
 * provenanceOf('@acme/notes@1.0.0'); // 'the provenance of @acme/notes@1.0.0'
 * ```
 */
function provenanceOf(subject: string): string {
  return `the provenance of ${escaped(subject)}`;
}

/**
 * What a record waits for: a version's tarball.
 *
 * @example
 * ```ts
 * tarballOf('@acme/notes@1.0.0'); // 'the @acme/notes@1.0.0 tarball'
 * ```
 */
function tarballOf(subject: string): string {
  return `the ${escaped(subject)} tarball`;
}

/**
 * What a record waits for: the tag it created.
 *
 * @example
 * ```ts
 * theTag('v1.0.0'); // 'the tag v1.0.0'
 * ```
 */
function theTag(tag: string): string {
  return `the tag ${escaped(tag)}`;
}

/**
 * What a record waits for: the Release it created.
 *
 * @example
 * ```ts
 * theRelease('v1.0.0'); // 'the v1.0.0 Release'
 * ```
 */
function theRelease(tag: string): string {
  return `the ${escaped(tag)} Release`;
}

/**
 * What a record waits for: the asset it uploaded.
 *
 * @example
 * ```ts
 * theAsset('acme-notes-1.0.0.tgz'); // 'the acme-notes-1.0.0.tgz asset'
 * ```
 */
function theAsset(name: string): string {
  return `the ${escaped(name)} asset`;
}

/**
 * A record's line for a version it read from the registry.
 *
 * @example
 * ```ts
 * readFromRegistry('@acme/notes@1.0.0'); // 'Read @acme/notes@1.0.0 from the registry.'
 * ```
 */
function readFromRegistry(subject: string): string {
  return `Read ${escaped(subject)} from the registry.`;
}

/**
 * The failure of provenance that names another build than this repository's main branch.
 *
 * @example
 * ```ts
 * provenanceNotOurs('@acme/notes@1.0.0', 'git+https://github.com/x/y@refs/heads/dev', 'git+https://github.com/acme/notes@refs/heads/main');
 * // '@acme/notes@1.0.0: its provenance names git+https://github.com/x/y@refs/heads/dev, which is not a build of ...'
 * ```
 */
function provenanceNotOurs(subject: string, uri: string, source: string): string {
  return `${escaped(subject)}: its provenance names ${escaped(uri)}, which is not a build of ${escaped(source)}.`;
}

/**
 * A record's line for a tarball it verified.
 *
 * @example
 * ```ts
 * verifiedTarball('@acme/notes@1.0.0', 'sha512-abc');
 * // 'Verified the @acme/notes@1.0.0 tarball against sha512-abc.'
 * ```
 */
function verifiedTarball(subject: string, integrity: string): string {
  return `Verified the ${escaped(subject)} tarball against ${escaped(integrity)}.`;
}

/**
 * The failure of a publication commit the checkout does not carry.
 *
 * @example
 * ```ts
 * commitOutsideCheckout('v1.0.0', 'abc', 'def');
 * // 'v1.0.0 was published from abc, which is neither the head def of the checkout nor an ancestor of it.'
 * ```
 */
function commitOutsideCheckout(subject: string, commit: string, head: string): string {
  return `${escaped(subject)} was published from ${escaped(commit)}, which is neither the head ${escaped(head)} of the checkout nor an ancestor of it.`;
}

/**
 * The failure of two libraries published from different commits.
 *
 * @example
 * ```ts
 * uploadsDisagree('@acme/b@1.0.0', 'def', '@acme/a@1.0.0', 'abc');
 * // '@acme/b@1.0.0 was published from def, but @acme/a@1.0.0 was published from abc.'
 * ```
 */
function uploadsDisagree(
  subject: string,
  commit: string,
  firstSubject: string,
  firstCommit: string,
): string {
  return `${escaped(subject)} was published from ${escaped(commit)}, but ${escaped(firstSubject)} was published from ${escaped(firstCommit)}.`;
}

/**
 * A record's line for the tag it created.
 *
 * @example
 * ```ts
 * createdTag('v1.0.0', 'abc'); // 'Created the annotated tag v1.0.0 at abc.'
 * ```
 */
function createdTag(tag: string, commit: string): string {
  return `Created the annotated tag ${escaped(tag)} at ${escaped(commit)}.`;
}

/**
 * A record's line for the tag it found in place.
 *
 * @example
 * ```ts
 * reusedTag('v1.0.0', 'abc'); // 'Reused the tag v1.0.0 at abc.'
 * ```
 */
function reusedTag(tag: string, commit: string): string {
  return `Reused the tag ${escaped(tag)} at ${escaped(commit)}.`;
}

/**
 * A record's line for the Release it created.
 *
 * @example
 * ```ts
 * createdRelease('v1.0.0'); // 'Created the v1.0.0 Release.'
 * ```
 */
function createdRelease(tag: string): string {
  return `Created the ${escaped(tag)} Release.`;
}

/**
 * A record's line for the Release it found in place.
 *
 * @example
 * ```ts
 * reusedRelease('v1.0.0'); // 'Reused the v1.0.0 Release.'
 * ```
 */
function reusedRelease(tag: string): string {
  return `Reused the ${escaped(tag)} Release.`;
}

/**
 * A record's line for an asset it kept.
 *
 * @example
 * ```ts
 * keptAsset('acme-notes-1.0.0.tgz'); // 'Kept the acme-notes-1.0.0.tgz asset.'
 * ```
 */
function keptAsset(name: string): string {
  return `Kept the ${escaped(name)} asset.`;
}

/**
 * A record's line for an unfinished asset it deleted.
 *
 * @example
 * ```ts
 * deletedAsset('acme-notes-1.0.0.tgz'); // 'Deleted the unfinished acme-notes-1.0.0.tgz asset.'
 * ```
 */
function deletedAsset(name: string): string {
  return `Deleted the unfinished ${escaped(name)} asset.`;
}

/**
 * A record's line for an asset it uploaded.
 *
 * @example
 * ```ts
 * uploadedAsset('acme-notes-1.0.0.tgz'); // 'Uploaded the acme-notes-1.0.0.tgz asset.'
 * ```
 */
function uploadedAsset(name: string): string {
  return `Uploaded the ${escaped(name)} asset.`;
}

/**
 * A record's last line.
 *
 * @example
 * ```ts
 * recorded('v1.0.0'); // 'Recorded v1.0.0.'
 * ```
 */
function recorded(tag: string): string {
  return `Recorded ${escaped(tag)}.`;
}

// Commands: releases.

/**
 * The failure of `loom release cut` run below the repository root.
 *
 * @example
 * ```ts
 * cutFromRoot; // 'Run release cut from the repository root.'
 * ```
 */
const cutFromRoot = 'Run release cut from the repository root.';

/**
 * The failure of `loom release cut` in a checkout with changes.
 *
 * @example
 * ```ts
 * cleanCheckoutRequired; // 'release cut requires a clean checkout. Commit the release inputs first.'
 * ```
 */
const cleanCheckoutRequired =
  'release cut requires a clean checkout. Commit the release inputs first.';

/**
 * The failure of a cut whose checkout moved while it prepared the release.
 *
 * @example
 * ```ts
 * checkoutChanged; // 'Checkout changed during release preparation.'
 * ```
 */
const checkoutChanged = 'Checkout changed during release preparation.';

/**
 * The failure of a cut whose file changed while it prepared the release.
 *
 * @example
 * ```ts
 * changedDuringPreparation('CHANGELOG.md'); // 'CHANGELOG.md: changed during release preparation.'
 * ```
 */
function changedDuringPreparation(path: string): string {
  return `${escaped(path)}: changed during release preparation.`;
}

/**
 * The failure of a cut that could not restore the files it wrote.
 *
 * @example
 * ```ts
 * rollbackIncomplete(['CHANGELOG.md']);
 * // 'Release rollback incomplete for CHANGELOG.md. Use a fresh isolated checkout.'
 * ```
 */
function rollbackIncomplete(failed: readonly string[]): string {
  return `Release rollback incomplete for ${escaped(failed.join(', '))}. Use a fresh isolated checkout.`;
}

/**
 * The failure of a cut whose release lock another writer holds.
 *
 * @example
 * ```ts
 * lockExists('/repo/.git/release-cut.lock');
 * // 'Release lock already exists at /repo/.git/release-cut.lock. Another writer may be active. ...'
 * ```
 */
function lockExists(lock: string): string {
  return `Release lock already exists at ${escaped(lock)}. Another writer may be active. After an interrupted write, use a fresh isolated checkout.`;
}

/**
 * The failure of `loom release record` without a token.
 *
 * @example
 * ```ts
 * tokenRequired; // 'Recording a release requires GH_TOKEN.'
 * ```
 */
const tokenRequired = 'Recording a release requires GH_TOKEN.';

export {
  abandonedVersion,
  changedDuringPreparation,
  changedSinceCut,
  checkoutChanged,
  cleanCheckoutRequired,
  commitOutsideCheckout,
  createdRelease,
  createdTag,
  cutFromRoot,
  deletedAsset,
  initialNeedsZero,
  integrityMismatch,
  invalidJsonAnswer,
  keptAsset,
  libraryState,
  lockExists,
  lockfileInvalidYaml,
  lockfilePreparationFailed,
  lockfileTimedOut,
  neverAppeared,
  noChangelogSection,
  noFragments,
  noVersionCommit,
  onRegistry,
  planDecision,
  planHeading,
  planWithoutNotes,
  pnpmMissing,
  provenanceConflict,
  provenanceElsewhere,
  provenanceNotOurs,
  provenanceOf,
  provenanceWithoutSource,
  readFromRegistry,
  recorded,
  refusedRequest,
  releaseState,
  releaseWithoutEntries,
  requestTimedOut,
  reusedRelease,
  reusedTag,
  rollbackIncomplete,
  sectionWithoutNotes,
  stableTargetOnly,
  tagAwayFromPublication,
  tagExists,
  tagNamesOther,
  tagObjectMissing,
  tagState,
  tagWithoutProvenance,
  tarballOf,
  targetBelowRelease,
  theAsset,
  theRelease,
  theTag,
  tokenRequired,
  unreleasedPlan,
  unsupportedIntegrity,
  uploadOriginRefused,
  uploadedAsset,
  uploadsDisagree,
  verifiedTarball,
};
