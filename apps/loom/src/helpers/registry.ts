import { createHash } from 'node:crypto';

import { z } from 'zod';

import { readJson } from './http.js';

const packumentSchema = z.looseObject({ versions: z.record(z.string(), z.unknown()) });

const distSchema = z.looseObject({ integrity: z.string().min(1), tarball: z.string().min(1) });

const releasedSchema = z.looseObject({ dist: distSchema });

const envelopeSchema = z.looseObject({ payload: z.string() });

const bundleSchema = z.looseObject({ dsseEnvelope: envelopeSchema });

const attestationSchema = z.looseObject({ bundle: bundleSchema, predicateType: z.string() });

const attestationsSchema = z.looseObject({ attestations: z.array(attestationSchema) });

const digestSchema = z.looseObject({ gitCommit: z.string().min(1) });

const dependencySchema = z.looseObject({ digest: digestSchema, uri: z.string() });

// The provenance statement names the source of the build in its first resolved dependency.
const buildDefinitionSchema = z.looseObject({ resolvedDependencies: z.array(dependencySchema) });

const predicateSchema = z.looseObject({ buildDefinition: buildDefinitionSchema });

const provenanceSchema = z.looseObject({ predicate: predicateSchema });

const provenancePredicateType = 'https://slsa.dev/provenance/v1';

function endpoint(registry: string, path: string) {
  return `${registry.replace(/\/+$/u, '')}/${path}`;
}

// The distribution facts of one published version, or undefined while the registry lacks it.
export async function readPublished(registry: string, name: string, version: string) {
  const { data } = await readJson(endpoint(registry, name));
  if (data === undefined) {
    return undefined;
  }
  const released = packumentSchema.parse(data).versions[version];
  return released === undefined ? undefined : releasedSchema.parse(released).dist;
}

// The commit and the source repository npm attests for one published version.
export async function readProvenance(registry: string, name: string, version: string) {
  const path = `-/npm/v1/attestations/${name}@${version}`;
  const { data } = await readJson(endpoint(registry, path));
  if (data === undefined) {
    return undefined;
  }
  const attestation = attestationsSchema
    .parse(data)
    .attestations.find((candidate) => candidate.predicateType === provenancePredicateType);
  if (attestation === undefined) {
    return undefined;
  }
  const statement = Buffer.from(attestation.bundle.dsseEnvelope.payload, 'base64').toString('utf8');
  const payload: unknown = JSON.parse(statement);
  const [source] = provenanceSchema.parse(payload).predicate.buildDefinition.resolvedDependencies;
  if (source === undefined) {
    throw new Error(`${name}@${version}: its provenance resolves no source repository.`);
  }
  return { commit: source.digest.gitCommit, uri: source.uri };
}

// A published tarball keeps the name npm pack gives it, and its Release asset uses that same name.
export function tarballName(name: string, version: string) {
  return `${name.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`;
}

export function verifyIntegrity(subject: string, bytes: Buffer, integrity: string) {
  const expected = /^sha512-(?<digest>[\w+/=]+)$/u.exec(integrity)?.groups?.digest;
  if (expected === undefined) {
    throw new Error(`${subject}: the registry reports unsupported integrity ${integrity}.`);
  }
  const actual = createHash('sha512').update(bytes).digest('base64');
  if (actual !== expected) {
    throw new Error(
      `${subject}: the downloaded tarball hashes to sha512-${actual}, not ${integrity}.`,
    );
  }
}
