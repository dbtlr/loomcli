import {
  array,
  boolean,
  literal,
  number,
  picklist,
  strictObject,
  string,
  union,
  unknown,
  safeParse,
} from 'valibot';
import type { BaseIssue, BaseSchema, InferOutput } from 'valibot';

import {
  coreUnresolved,
  coreWithoutApplication,
  manyApplicationExports,
  noApplicationExport,
} from '../commands/init/messages.js';
import {
  loaderFailure,
  loadFailure,
  readerFailure,
  renderFailure,
  skillLoaderFailure,
  threw,
} from './application-load-failure.js';
import { runReader } from './application-reader.js';
import type { ReaderRequest } from './application-reader.js';
import { parseOrThrow } from './parse-or-throw.js';
import type { RunHost } from './run-host.js';

/** The names a module exports its Application under. */
const names = array(string());

/**
 * What the read found: each name the module exports its one Application under, `default`
 * included; or why no Application could be read, a declaration fault's Developer Diagnostic
 * included, and whether the module loaded before the read stopped.
 */
const exportsResult = union([
  strictObject({ names }),
  strictObject({ failure: string(), loaded: boolean() }),
]);

/**
 * Why the reading process found no single Application, as a fact this process words: the package
 * resolves no core, its core exports no Application, or the module exports none or `count` of them.
 */
const readProblem = union([
  strictObject({ problem: picklist(['core-unresolved', 'core-without-application']) }),
  strictObject({ count: number(), problem: literal('applications') }),
]);

/**
 * What the reading process writes to its result file: the read, a problem it found, or the reason
 * the module threw.
 */
const readResult = union([exportsResult, readProblem, threw]);

/** One problem a read found, as the reading process writes it. */
type ReadProblem = InferOutput<typeof readProblem>;

/** A problem the read found, worded for the module, and whether the module loaded before it. */
function problemExports(module: string, read: ReadProblem): { failure: string; loaded: boolean } {
  if (read.problem === 'applications') {
    const failure =
      read.count === 0 ? noApplicationExport(module) : manyApplicationExports(module, read.count);
    return { failure, loaded: true };
  }
  const failure =
    read.problem === 'core-unresolved' ? coreUnresolved(module) : coreWithoutApplication(module);
  return { failure, loaded: false };
}

const projectionFailure = union([
  readProblem,
  threw,
  strictObject({ failure: string(), loaded: boolean() }),
  strictObject({ loaderThrew: string() }),
  strictObject({ loaderThrew: string(), skill: string() }),
  strictObject({ readerThrew: string() }),
  strictObject({ rendererThrew: string() }),
]);

/** One read of an application module, a throw while it loaded formatted as its diagnostic. */
export type ApplicationExports = InferOutput<typeof exportsResult>;

/** One read of an application module, as the reading process writes it to its result file. */
export type ApplicationRead = InferOutput<typeof readResult>;

/**
 * Reads the exports of one application module under Bun, in a process of its own in the package
 * directory, as init runs. `path` is absolute, resolved against the working directory before the
 * spawn, and `module` is the module as the operator reads it. A module that threw while it loaded
 * reads as the failure `@loomcli/loom/application-load-failed` names, or, for a throw of the
 * package's own `DeclarationError`, as that error's own Developer Diagnostic.
 */
export async function readApplicationExports(
  run: RunHost,
  options: { directory: string; module: string; path: string },
): Promise<ApplicationExports> {
  const result = await runReader(run, { ...options, reader: 'read-application' }, readResult);
  if ('threw' in result) {
    return { failure: loadFailure(options.module, result.threw), loaded: false };
  }
  return 'problem' in result ? problemExports(options.module, result) : result;
}

/**
 * Runs a reader request under Bun and validates its successful answer against schema.
 * Throws a worded export-count or core-resolution failure, a DeclarationError's own diagnostic,
 * the diagnostic for author code that threw, naming the skill whose loader threw when the reader
 * told it, or the diagnostic for the plugin that threw. Projections share this bin-side reader boundary.
 */
export async function readApplicationProjection<
  Schema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(run: RunHost, request: ReaderRequest, schema: Schema): Promise<InferOutput<Schema>> {
  const value = await runReader(run, request, unknown());
  const failure = safeParse(projectionFailure, value);
  if (!failure.success) {
    return parseOrThrow(schema, value);
  }
  const result = failure.output;
  if ('threw' in result) {
    throw new Error(loadFailure(request.module, result.threw));
  }
  if ('skill' in result) {
    throw new Error(skillLoaderFailure(request.module, result.skill, result.loaderThrew));
  }
  if ('loaderThrew' in result) {
    throw new Error(loaderFailure(request.module, result.loaderThrew));
  }
  if ('readerThrew' in result) {
    throw new Error(readerFailure(request.module, result.readerThrew));
  }
  if ('rendererThrew' in result) {
    throw new Error(renderFailure(request.module, result.rendererThrew));
  }
  if ('failure' in result) {
    throw new Error(result.failure);
  }
  throw new Error(problemExports(request.module, result).failure);
}
