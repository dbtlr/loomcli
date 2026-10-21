import { createHash } from 'node:crypto';

import { array, looseObject, minLength, pipe, record, string, unknown } from 'valibot';

import { readJson } from './http.js';
import type { HttpPolicy } from './http.js';
import { parseOrThrow } from './parse-or-throw.js';

const nonEmpty = pipe(string(), minLength(1));

const packumentSchema = looseObject({ versions: record(string(), unknown()) });

const distSchema = looseObject({ integrity: nonEmpty, tarball: nonEmpty });

const releasedSchema = looseObject({ dist: distSchema });

const envelopeSchema = looseObject({ payload: string() });

const bundleSchema = looseObject({ dsseEnvelope: envelopeSchema });

const attestationSchema = looseObject({ bundle: bundleSchema, predicateType: string() });

const attestationsSchema = looseObject({ attestations: array(attestationSchema) });

const digestSchema = looseObject({ gitCommit: nonEmpty });

const dependencySchema = looseObject({ digest: digestSchema, uri: string() });

// The provenance statement names the source of the build in its first resolved dependency.
const buildDefinitionSchema = looseObject({ resolvedDependencies: array(dependencySchema) });

const predicateSchema = looseObject({ buildDefinition: buildDefinitionSchema });

const subjectSchema = looseObject({ name: string() });

const provenanceSchema = looseObject({
  predicate: predicateSchema,
  subject: array(subjectSchema),
});

const provenancePredicateType = 'https://slsa.dev/provenance/v1';

// Npm attests a version under its package URL, whose scope separator is percent-encoded.
function packageUrl(name: string, version: string) {
  return `pkg:npm/${name.replace('@', '%40')}@${version}`;
}

function endpoint(target: RegistryTarget, path: string) {
  return `${target.registry.replace(/\/+$/u, '')}/${path}`;
}

// The registry the release reads, with the deadline every one of its requests carries.
export interface RegistryTarget {
  policy: HttpPolicy;
  registry: string;
}

// The distribution facts of one published version, or undefined while the registry lacks it.
export async function readPublished(target: RegistryTarget, name: string, version: string) {
  const { data } = await readJson(target.policy, endpoint(target, name));
  if (data === undefined) {
    return undefined;
  }
  const released = parseOrThrow(packumentSchema, data).versions[version];
  return released === undefined ? undefined : parseOrThrow(releasedSchema, released).dist;
}

// The commit and the source repository npm attests for one published version.
export async function readProvenance(target: RegistryTarget, name: string, version: string) {
  const path = `-/npm/v1/attestations/${name}@${version}`;
  const { data } = await readJson(target.policy, endpoint(target, path));
  if (data === undefined) {
    return undefined;
  }
  const attestation = parseOrThrow(attestationsSchema, data).attestations.find(
    (candidate) => candidate.predicateType === provenancePredicateType,
  );
  if (attestation === undefined) {
    return undefined;
  }
  const statement = Buffer.from(attestation.bundle.dsseEnvelope.payload, 'base64').toString('utf8');
  const payload: unknown = JSON.parse(statement);
  const provenance = parseOrThrow(provenanceSchema, payload);
  const purl = packageUrl(name, version);
  if (!provenance.subject.some((subject) => subject.name === purl)) {
    const attested = provenance.subject.map((subject) => subject.name).join(', ');
    throw new Error(
      `${name}@${version}: its provenance attests ${attested || 'nothing'}, not ${purl}.`,
    );
  }
  const [source] = provenance.predicate.buildDefinition.resolvedDependencies;
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
