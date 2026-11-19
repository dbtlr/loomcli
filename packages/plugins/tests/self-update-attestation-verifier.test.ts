/*
 * Acceptance plan for the verifier self-update's attestation builds (ADR-0212): it takes the trust
 * material alone. Any option would change a threshold from sigstore-js's default of one, which
 * lets a bundle with no transparency-log entry, certificate timestamp, or verified timestamp pass.
 */

import type { TrustMaterial } from '@sigstore/verify';
import { Verifier } from '@sigstore/verify';
import { expect, test, vi } from 'vite-plus/test';

import { verifierOf } from '../src/self-update/attestation/verifier.js';

/** The argument counts of every construction of a `Verifier`. */
const constructions = vi.hoisted((): number[] => []);

vi.mock('@sigstore/verify', async (importOriginal) => {
  const actual = await importOriginal<{ Verifier: typeof Verifier }>();
  class Recording extends actual.Verifier {
    constructor(...given: ConstructorParameters<typeof actual.Verifier>) {
      super(...given);
      constructions.push(given.length);
    }
  }
  return { ...actual, Verifier: Recording };
});

const material: TrustMaterial = {
  certificateAuthorities: [],
  ctlogs: [],
  publicKey: () => {
    throw new Error('No key.');
  },
  timestampAuthorities: [],
  tlogs: [],
};

test('the verifier is built from the trust material alone, with sigstore-js’s default thresholds', () => {
  const verifier = verifierOf(Verifier, material);
  expect(verifier).toBeInstanceOf(Verifier);
  expect(constructions).toEqual([1]);
});
