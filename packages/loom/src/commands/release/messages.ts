/*
 * The operator sentences of `loom release` and the helpers that serve it, under ADR-0164. `loom pr
 * check` loads this module too. A launch never does. Every value is escaped, except `output`.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const escaped = escapeControlCharacters;

// Repository reads.

function noVersionCommit(version: string): string {
  return `No first-parent commit sets version ${escaped(version)}.`;
}

// Synchronized releases.

const initialNeedsZero = '--initial requires library version 0.0.0.';

const noFragments = 'No fragments to release.';

const stableTargetOnly = 'Release target must be a stable 0.x version.';

function targetBelowRelease(minimum: string, current: string): string {
  return `Release target must be at least ${escaped(minimum)}; current version is ${escaped(current)}.`;
}

function releaseWithoutEntries(version: string): string {
  return `Release v${escaped(version)} carries no entries, so it requires a narrative for its notes.`;
}

function tagExists(version: string): string {
  return `Tag v${escaped(version)} already exists.`;
}

// Lockfiles.

const pnpmMissing =
  'Preparing pnpm-lock.yaml requires pnpm, an optional peer dependency of @loomcli/loom. Install pnpm 12.16.1 beside @loomcli/loom and run the command again.';

const lockfileInvalidYaml = 'pnpm-lock.yaml is invalid YAML.';

function lockfileTimedOut(seconds: number): string {
  return `Lockfile preparation did not finish within ${String(seconds)} seconds, so pnpm was stopped.`;
}

function lockfilePreparationFailed(output: string): string {
  return `Lockfile preparation failed:\n${output}`;
}

// Services.

function invalidJsonAnswer(url: string): string {
  return `${escaped(url)} answered with invalid JSON.`;
}

function refusedRequest(method: string, url: string, status: number, output: string): string {
  return `${escaped(method)} ${escaped(url)} answered ${String(status)}: ${output}`;
}

function requestTimedOut(method: string, url: string, deadlineMs: number): string {
  return `${escaped(method)} ${escaped(url)} did not answer within ${String(deadlineMs)} ms.`;
}

function neverAppeared(subject: string, attempts: number): string {
  return `${escaped(subject)} did not appear after ${String(attempts)} attempts.`;
}

function tagObjectMissing(tag: string, sha: string): string {
  return `Tag ${escaped(tag)} names tag object ${escaped(sha)}, which the API does not return.`;
}

function uploadOriginRefused(origin: string, api: string, upload: string): string {
  return `The Release publishes its upload endpoint at ${escaped(origin)}, which is neither ${escaped(api)} nor ${escaped(upload)}.`;
}

function provenanceElsewhere(
  name: string,
  version: string,
  attested: readonly string[],
  purl: string,
): string {
  return `${escaped(name)}@${escaped(version)}: its provenance attests ${escaped(attested.join(', ') || 'nothing')}, not ${escaped(purl)}.`;
}

function provenanceWithoutSource(name: string, version: string): string {
  return `${escaped(name)}@${escaped(version)}: its provenance resolves no source repository.`;
}

function unsupportedIntegrity(subject: string, integrity: string): string {
  return `${escaped(subject)}: the registry reports unsupported integrity ${escaped(integrity)}.`;
}

function integrityMismatch(subject: string, actual: string, integrity: string): string {
  return `${escaped(subject)}: the downloaded tarball hashes to sha512-${escaped(actual)}, not ${escaped(integrity)}.`;
}

// Release plans.

function noChangelogSection(version: string): string {
  return `CHANGELOG.md has no v${escaped(version)} section.`;
}

function sectionWithoutNotes(version: string): string {
  return `CHANGELOG.md: the v${escaped(version)} section has no notes.`;
}

function abandonedVersion(version: string, reason: string): string {
  return `Version ${escaped(version)} is absent from the registry and ${escaped(reason)} Publication attests the head, so ${escaped(version)} must be abandoned as unpublished and superseded by the next cut.`;
}

function changedSinceCut(paths: readonly string[], cutCommit: string, head: string): string {
  return `${escaped(paths.join(', '))} changed between the cut commit ${escaped(cutCommit)} and the head ${escaped(head)}.`;
}

function tagNamesOther(tag: string, tagCommit: string, head: string): string {
  return `tag ${escaped(tag)} already names ${escaped(tagCommit)} instead of the head ${escaped(head)}.`;
}

function provenanceConflict(
  name: string,
  version: string,
  commit: string,
  earlier: string,
): string {
  return `${escaped(name)}@${escaped(version)} was published from ${escaped(commit)}, but an earlier library names ${escaped(earlier)}.`;
}

function tagWithoutProvenance(tag: string, tagCommit: string, version: string): string {
  return `Tag ${escaped(tag)} names ${escaped(tagCommit)}, but the registry reports no provenance for ${escaped(version)}, so the commit it was published from is unknown.`;
}

function tagAwayFromPublication(
  tag: string,
  tagCommit: string,
  version: string,
  commit: string,
): string {
  return `Tag ${escaped(tag)} names ${escaped(tagCommit)}, but ${escaped(version)} was published from ${escaped(commit)}; recording never moves a tag.`;
}

const planWithoutNotes = 'A plan for a released version carries notes.';

function unreleasedPlan(version: string, head: string): string {
  return `${escaped(version)} is the unreleased version at head ${escaped(head)}, so there is nothing to reconcile.\nPublish: no. Record: no.`;
}

function planHeading(tag: string, head: string, cutCommit: string): string {
  return `Plan ${escaped(tag)} at head ${escaped(head)}, cut commit ${escaped(cutCommit)}.`;
}

function libraryState(name: string, published: boolean): string {
  return `${escaped(name)}: ${published ? 'published' : 'absent from the registry'}.`;
}

function tagState(tag: string, commit: string | null): string {
  return `Tag ${escaped(tag)}: ${commit === null ? 'absent' : `present at ${escaped(commit)}`}.`;
}

function releaseState(tag: string, present: boolean): string {
  return `Release ${escaped(tag)}: ${present ? 'present' : 'absent'}.`;
}

function planDecision(publish: boolean, record: boolean): string {
  return `Publish: ${publish ? 'yes' : 'no'}. Record: ${record ? 'yes' : 'no'}.`;
}

// Release records.

function onRegistry(subject: string): string {
  return `${escaped(subject)} on the registry`;
}

function provenanceOf(subject: string): string {
  return `the provenance of ${escaped(subject)}`;
}

function tarballOf(subject: string): string {
  return `the ${escaped(subject)} tarball`;
}

function theTag(tag: string): string {
  return `the tag ${escaped(tag)}`;
}

function theRelease(tag: string): string {
  return `the ${escaped(tag)} Release`;
}

function theAsset(name: string): string {
  return `the ${escaped(name)} asset`;
}

function readFromRegistry(subject: string): string {
  return `Read ${escaped(subject)} from the registry.`;
}

function provenanceNotOurs(subject: string, uri: string, source: string): string {
  return `${escaped(subject)}: its provenance names ${escaped(uri)}, which is not a build of ${escaped(source)}.`;
}

function verifiedTarball(subject: string, integrity: string): string {
  return `Verified the ${escaped(subject)} tarball against ${escaped(integrity)}.`;
}

function commitOutsideCheckout(subject: string, commit: string, head: string): string {
  return `${escaped(subject)} was published from ${escaped(commit)}, which is neither the head ${escaped(head)} of the checkout nor an ancestor of it.`;
}

function uploadsDisagree(
  subject: string,
  commit: string,
  firstSubject: string,
  firstCommit: string,
): string {
  return `${escaped(subject)} was published from ${escaped(commit)}, but ${escaped(firstSubject)} was published from ${escaped(firstCommit)}.`;
}

function createdTag(tag: string, commit: string): string {
  return `Created the annotated tag ${escaped(tag)} at ${escaped(commit)}.`;
}

function reusedTag(tag: string, commit: string): string {
  return `Reused the tag ${escaped(tag)} at ${escaped(commit)}.`;
}

function createdRelease(tag: string): string {
  return `Created the ${escaped(tag)} Release.`;
}

function reusedRelease(tag: string): string {
  return `Reused the ${escaped(tag)} Release.`;
}

function keptAsset(name: string): string {
  return `Kept the ${escaped(name)} asset.`;
}

function deletedAsset(name: string): string {
  return `Deleted the unfinished ${escaped(name)} asset.`;
}

function uploadedAsset(name: string): string {
  return `Uploaded the ${escaped(name)} asset.`;
}

function recorded(tag: string): string {
  return `Recorded ${escaped(tag)}.`;
}

// Commands: releases.

const cutFromRoot = 'Run release cut from the repository root.';

const cleanCheckoutRequired =
  'release cut requires a clean checkout. Commit the release inputs first.';

const checkoutChanged = 'Checkout changed during release preparation.';

function changedDuringPreparation(path: string): string {
  return `${escaped(path)}: changed during release preparation.`;
}

function rollbackIncomplete(failed: readonly string[]): string {
  return `Release rollback incomplete for ${escaped(failed.join(', '))}. Use a fresh isolated checkout.`;
}

function lockExists(lock: string): string {
  return `Release lock already exists at ${escaped(lock)}. Another writer may be active. After an interrupted write, use a fresh isolated checkout.`;
}

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
