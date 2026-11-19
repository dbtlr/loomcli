import type { Host, Log } from '@loomcli/core';

import type { Requesting } from './request.js';

/**
 * The brand only this module can write, so an object literal cannot satisfy `AttestationSetting`.
 * It is not exported: a value with it comes from `settingOf`, which `attestation()` calls.
 */
const attestationSetting: unique symbol = Symbol('@loomcli/plugins/self-update/attestation');

/**
 * A value only `attestation()` in `@loomcli/plugins/self-update/attestation` makes, which
 * `selfUpdate()` takes as `attestation`. Its brand is keyed by an unexported unique symbol, so an
 * object literal such as `{ workflow: '.github/workflows/release.yml' }` does not compile as one.
 *
 * @public
 * @sealed
 */
interface AttestationSetting {
  /** The brand, which only `attestation()` writes. */
  readonly [attestationSetting]: true;
  /** The attesting workflow's path, as `attestation()` was given it. */
  readonly workflow: string;
}

/** What verifying an attestation of the asset reads, once `SHA256SUMS` lists its digest. */
interface AttestationCheck {
  /** The application's name, as the graph holds it. */
  readonly name: string;
  /** The running binary's version, which a sentence about a form it cannot read names. */
  readonly running: string;
  /** The run's host, whose release facts name the repository the binary bakes. */
  readonly host: Host;
  /** The asset's name, as the release facts hold it. */
  readonly asset: string;
  /** The repository the Command resolved, after any redirect. */
  readonly repository: string;
  /** The version being installed, without its `v`. */
  readonly version: string;
  /** The asset's SHA-256 digest that `SHA256SUMS` lists, in lowercase hexadecimal. */
  readonly digest: string;
  /** The application's cache directory, which holds Sigstore's trust root. */
  readonly cache: string;
  /** The run signal, and the `trace` line each request is named by. */
  readonly requesting: Requesting;
  /** The run's log, which the `-v` lines go to. */
  readonly log: Log;
}

/** Verifies an attestation of the asset, or throws the failure the update reports. */
type Attest = (check: AttestationCheck) => Promise<void>;

/** The verification each setting `attestation()` made carries, which no member of it exposes. */
const attesters = new WeakMap<object, Attest>();

/** A setting for `workflow` whose verification is `attest`, frozen so no caller rewrites it. */
function settingOf(workflow: string, attest: Attest): AttestationSetting {
  const setting = Object.freeze({ [attestationSetting]: true as const, workflow });
  attesters.set(setting, attest);
  return setting;
}

/** The verification a value carries when `attestation()` made it, or `undefined` for any other. */
function attesterOf(value: unknown): Attest | undefined {
  return typeof value === 'object' && value !== null ? attesters.get(value) : undefined;
}

export type { Attest, AttestationCheck, AttestationSetting };
export { attesterOf, settingOf };
