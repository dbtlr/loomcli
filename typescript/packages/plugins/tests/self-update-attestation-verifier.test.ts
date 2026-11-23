/*
 * Acceptance plan for the verifier self-update's attestation builds (ADR-0212). Passing the trust
 * material alone keeps sigstore-js's default of one transparency-log entry, one certificate
 * timestamp, and one verified timestamp.
 */

import { readFileSync } from 'node:fs';

import type { Verifier } from '@sigstore/verify';
import { expect, test, vi } from 'vite-plus/test';

import {
  cargoDist,
  cargoDistAsset,
  run,
  sandbox,
  useRecordedAttestationFixtures,
} from './fixtures/self-update-attestation-run.ts';

useRecordedAttestationFixtures();

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

test('an attested update builds the verifier from the trust material alone', async () => {
  const box = sandbox();
  const result = await run(box, ['self-update'], {
    release: cargoDist,
    workflow: cargoDist.workflow,
  });

  expect(result.status).toBe(0);
  expect(readFileSync(box.binary, 'utf8')).toBe(cargoDistAsset);
  expect(constructions).toEqual([1]);
});
