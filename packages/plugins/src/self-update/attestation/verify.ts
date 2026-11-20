import { join } from 'node:path';

import type { Phrase } from '@loomcli/core';
import { bundleFromJSON, isBundleWithDsseEnvelope } from '@sigstore/bundle';
import type { BundleWithDsseEnvelope } from '@sigstore/bundle';
import { getTrustedRoot } from '@sigstore/tuf';
import { toSignedEntity, toTrustMaterial, Verifier } from '@sigstore/verify';
import type { Signer, TrustMaterial } from '@sigstore/verify';

import type { AttestationCheck } from '../attestation-setting.js';
import { fatal } from '../fatal.js';
import { selfUpdatePhrase } from '../phrases.js';
import { fetchBytes, RequestError, shownAddress } from '../request.js';
import { isAssetStatement, isPinnedSigner, isReleaseRun } from './checks.js';
import type { Expected, SignerIdentity } from './checks.js';
import { listAttestations, releaseOf } from './listing.js';
import type { Listed } from './listing.js';
import { decodeSnappyBlock } from './snappy.js';
import { trustRootFailure, untilAborted } from './trust-root.js';
import { verifierOf } from './verifier.js';

/** The folder in the cache directory that holds Sigstore's trust root. */
const trustRootFolder = 'sigstore';

/**
 * How far an attestation got through the checks, in their order: its bundle reads, Sigstore's
 * checks hold, the identity is the pinned workflow's, the run was on the release's tag, and the
 * statement names the asset. A fault at a higher step went further.
 */
const reads = 1;
const verifies = 2;
const signedByWorkflow = 3;
const onTag = 4;
const namesAsset = 5;

/** Why one attestation did not pass: the step it failed at, its sentence, and the error beneath. */
interface Fault {
  readonly step: number;
  readonly sentence: Phrase;
  readonly beneath?: unknown;
}

/** What checking every attestation needs beside the attestation itself. */
interface Context {
  readonly check: AttestationCheck;
  readonly workflow: string;
  readonly verifier: Verifier;
}

/** A fault at `step` with its sentence. */
function faultAt(step: number, sentence: Phrase, beneath?: unknown): Fault {
  return beneath === undefined ? { sentence, step } : { beneath, sentence, step };
}

/** The fault of a bundle that does not read. */
function unreadable({ check }: Context, cause?: unknown): Fault {
  return faultAt(
    reads,
    selfUpdatePhrase('attestationUnreadable', releaseOf(check), check.name),
    cause,
  );
}

/** Whether a listed value is an absolute HTTPS URL. */
function httpsUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || !URL.canParse(value)) {
    return undefined;
  }
  const url = new URL(value);
  return url.protocol === 'https:' ? url : undefined;
}

/**
 * The bytes at a bundle's URL. A request that fails fails the run under the request rows, naming
 * the URL without its query, which carries a signature; an abort propagates as it is.
 */
async function bundleBytes(url: URL, check: AttestationCheck): Promise<Uint8Array> {
  try {
    return await fetchBytes(url, check.requesting);
  } catch (error) {
    if (check.requesting.signal.aborted || !(error instanceof RequestError)) {
      throw error;
    }
    const { kind, status } = error;
    throw fatal(
      selfUpdatePhrase(
        'requestFailed',
        check.name,
        { kind, status, url: shownAddress(url) },
        undefined,
      ),
      error,
    );
  }
}

/** The JSON a Snappy body decodes and parses to, or the fault of one that does not. */
function decodedJson(body: Uint8Array, context: Context): { parsed: unknown } | Fault {
  const decoded = decodeSnappyBlock(body);
  if (decoded === undefined || decoded === 'too-long') {
    return unreadable(context);
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decoded));
    return { parsed };
  } catch (error) {
    return unreadable(context, error);
  }
}

/** The bundle's JSON, inline or from its URL, or the fault of an attestation with neither. */
async function bundleJson(listed: Listed, context: Context): Promise<{ parsed: unknown } | Fault> {
  if (typeof listed.bundle === 'object' && listed.bundle !== null) {
    return { parsed: listed.bundle };
  }
  const url = httpsUrl(listed.bundleUrl);
  if (url === undefined) {
    return unreadable(context);
  }
  return decodedJson(await bundleBytes(url, context.check), context);
}

/** The Sigstore bundle with a DSSE envelope the JSON parses as, or the fault of one that does not. */
function dsseBundle(parsed: unknown, context: Context): BundleWithDsseEnvelope | Fault {
  try {
    const bundle = bundleFromJSON(parsed);
    return isBundleWithDsseEnvelope(bundle) ? bundle : unreadable(context);
  } catch (error) {
    return unreadable(context, error);
  }
}

/** The signer Sigstore's checks return, or the fault of a bundle that fails them. */
function verifiedSigner(bundle: BundleWithDsseEnvelope, context: Context): Signer | Fault {
  try {
    return context.verifier.verify(toSignedEntity(bundle));
  } catch (error) {
    return faultAt(
      verifies,
      selfUpdatePhrase('attestationNotVerified', releaseOf(context.check)),
      error,
    );
  }
}

/** The signer's identity as the checks read it. */
function identityOf(signer: Signer): SignerIdentity {
  const identity = signer.identity;
  return {
    extensions: (identity?.oids ?? []).flatMap(({ oid, value }) =>
      oid === undefined ? [] : [{ oid: { id: oid.id }, value }],
    ),
    issuer: identity?.extensions?.issuer,
    subjectAlternativeName: identity?.subjectAlternativeName,
  };
}

/** What the identity and release checks compare against: both repositories, the workflow, the version. */
function expectedOf({ check, workflow }: Context): Expected {
  const baked = check.host.release.release?.repository;
  return {
    repositories: baked === undefined ? [check.repository] : [baked, check.repository],
    version: check.version,
    workflow,
  };
}

/** The fault of a verified signer or statement that is not the release's, or `undefined` when all hold. */
function releaseFault(
  bundle: BundleWithDsseEnvelope,
  signer: Signer,
  context: Context,
): Fault | undefined {
  const { check, workflow } = context;
  const identity = identityOf(signer);
  const expected = expectedOf(context);
  if (!isPinnedSigner(identity, expected)) {
    return faultAt(
      signedByWorkflow,
      selfUpdatePhrase('attestationOtherSigner', releaseOf(check), workflow),
    );
  }
  if (!isReleaseRun(identity, expected)) {
    return faultAt(onTag, selfUpdatePhrase('attestationOtherRef', releaseOf(check)));
  }
  const envelope = bundle.content.dsseEnvelope;
  return isAssetStatement(envelope, { asset: check.asset, digest: check.digest })
    ? undefined
    : faultAt(namesAsset, selfUpdatePhrase('attestationOtherSubject', releaseOf(check)));
}

/** Whether a step's outcome is a fault. */
function isFault(value: unknown): value is Fault {
  return typeof value === 'object' && value !== null && 'step' in value && 'sentence' in value;
}

/** The fault of one listed attestation, or `undefined` when it passes every check. */
async function attempt(listed: Listed, context: Context): Promise<Fault | undefined> {
  const json = await bundleJson(listed, context);
  if (isFault(json)) {
    return json;
  }
  const bundle = dsseBundle(json.parsed, context);
  if (isFault(bundle)) {
    return bundle;
  }
  const signer = verifiedSigner(bundle, context);
  return isFault(signer) ? signer : releaseFault(bundle, signer, context);
}

/**
 * Sigstore's trust root, brought current in `folder` through TUF from the root `@sigstore/tuf`
 * ships, at every call, or the failure of a fault that kept it from being so. The run signal stops
 * the wait, not sigstore-js's requests, which no signal reaches.
 */
async function currentMaterial(check: AttestationCheck, folder: string): Promise<TrustMaterial> {
  const { signal } = check.requesting;
  signal.throwIfAborted();
  try {
    const current = getTrustedRoot({ cachePath: folder, forceCache: false, forceInit: true });
    return toTrustMaterial(await untilAborted(current, signal));
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw trustRootFailure(error, { folder, name: check.name, temporary: check.host.tmpdir });
  }
}

/** The verifier of Sigstore's current trust root, named at `-v` once it is current. */
async function trustRoot(check: AttestationCheck, folder: string): Promise<Verifier> {
  const verifier = verifierOf(Verifier, await currentMaterial(check, folder));
  check.log.debug(selfUpdatePhrase('checkedTrustRootIn'), { path: folder });
  return verifier;
}

/**
 * Checks each listed attestation in GitHub's order and stops at the first that passes, answering
 * `undefined`. When none passes, it answers the fault of the one that got furthest, the first of
 * those when several tie.
 */
async function furthestFault(
  listed: readonly Listed[],
  context: Context,
): Promise<Fault | undefined> {
  let furthest: Fault | undefined = undefined;
  for (const entry of listed) {
    const fault = await attempt(entry, context);
    if (fault === undefined) {
      return undefined;
    }
    if (furthest === undefined || fault.step > furthest.step) {
      furthest = fault;
    }
  }
  return furthest ?? unreadable(context);
}

/**
 * Verifies an attestation of the asset under ADR-0212: lists the provenance attestations of the
 * digest, brings Sigstore's trust root current, then checks each in GitHub's order. When none
 * passes, the run fails with the furthest fault. Nothing falls back to the digest alone.
 */
async function verifyAttestation(workflow: string, check: AttestationCheck): Promise<void> {
  const listed = await listAttestations(check, Date.now());
  const verifier = await trustRoot(check, join(check.cache, trustRootFolder));
  const fault = await furthestFault(listed, { check, verifier, workflow });
  if (fault !== undefined) {
    throw fatal(fault.sentence, fault.beneath);
  }
  check.log.debug(selfUpdatePhrase('verifiedAttestationFrom'), { asset: check.asset, workflow });
}

export { verifyAttestation };
