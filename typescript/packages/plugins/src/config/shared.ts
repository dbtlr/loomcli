import type {
  CommandGraph,
  ContextualStyle,
  Host,
  Log,
  Out,
  Phrase,
  StandardSchemaV1,
} from '@loomcli/core';

import { dropUntilPasses } from './drop.js';
import type { Removal, Step } from './drop.js';
import { findFile } from './lookup.js';
import type { UsableFile } from './lookup.js';
import { configPhrase } from './phrases.js';
import { withoutPointer } from './pointer.js';
import type { ConfigurationReader } from './reading.js';
import type { Reach } from './scopes.js';
import { covers, coversRemoval, isStrict } from './strict.js';
import type { Strictness } from './strict.js';
import { shownUnknownPath } from './unknown-path.js';
import { unknownKeys } from './unknown.js';

/**
 * What the source and the provider of one `configuration()` call share: the lookup, the read, and
 * the validated result of a run. The result is keyed by the run's `host`, the one object core hands
 * both, so each warning and each `-v` line is written once, whichever reads first.
 */

/** What the call fixed for every run: the file pattern's candidates, the other settings, and the schema. */
interface Shared<Schema extends StandardSchemaV1> {
  readonly candidates: readonly string[] | undefined;
  /** The directory option's name, when the settings declare one. */
  readonly directory: string | undefined;
  /** The variable that names the configuration file, when the settings name one. */
  readonly env: string | undefined;
  readonly notice: boolean;
  /** The scopes the lookup reads and the markers that end its walk. */
  readonly reach: Reach;
  /** The readers of the formats beyond JSON the application reads. */
  readonly readers: readonly ConfigurationReader[];
  readonly schema: Schema;
  /** What `strict` covers. */
  readonly strict: Strictness;
  /** The result each run read, by the run's host. */
  readonly reads: WeakMap<Host, Promise<Loaded<Schema>>>;
}

/** What a run read: the file that passed, when one was found, and the schema's output for it. */
interface Loaded<Schema extends StandardSchemaV1> {
  /** The file the run read with every dropped value removed, or `undefined` when it found none. */
  readonly usable: UsableFile | undefined;
  /** The line of each covered removal and covered unknown key, which fail the run, in the order found. */
  readonly held: readonly Phrase[];
  readonly output: StandardSchemaV1.InferOutput<Schema>;
}

/** What a reader hands the shared read: the facts of its run. */
interface Scene {
  readonly graph: CommandGraph;
  readonly host: Host;
  /** How the run received its inputs, which decides how a problem names the `--config` option. */
  readonly invokedBy: 'argv' | 'name';
  readonly options: Readonly<Record<string, unknown>>;
  readonly out: Out;
  readonly log: Log;
  readonly style: ContextualStyle;
}

/** The option value a global string option holds, read as the one typed accessor over the values. */
function stringOption(
  options: Readonly<Record<string, unknown>>,
  name: string | undefined,
): string | undefined {
  const value = name === undefined ? undefined : options[name];
  return typeof value === 'string' ? value : undefined;
}

const noSteps = 0;

/** A removed value's path as the `-v` line shows it: keys joined by dots, an array item as its index in brackets. */
function shownPath(path: readonly Step[]): string {
  return path.reduce<string>((text, step) => {
    if (typeof step === 'number') {
      return `${text}[${step}]`;
    }
    return text === '' ? step : `${text}.${step}`;
  }, '');
}

/** Where a read reports what it finds: the file's name, the lines `strict` holds, and the `-v` channel. */
interface Reporting {
  readonly file: string | undefined;
  /** The line of each covered removal and covered unknown key, in the order found. */
  readonly held: Phrase[];
  readonly log: Log;
  readonly strict: Strictness;
}

/**
 * Logs the `debug` line for a removed value or an unknown key: its path, or every key for the whole
 * file, the file when the run read one, and the issue, which renders in the run's language at `-v`.
 */
function logIgnored(
  log: Log,
  { file, path }: { readonly path: string | undefined; readonly file: string | undefined },
  issue: string | Phrase,
): void {
  if (path === undefined) {
    if (file === undefined) {
      log.debug(configPhrase('ignoredEveryKey'), { issue });
    } else {
      log.debug(configPhrase('ignoredEveryKeyIn'), { file, issue });
    }
  } else if (file === undefined) {
    log.debug(configPhrase('ignoredKey'), { issue, key: path });
  } else {
    log.debug(configPhrase('ignoredKeyIn'), { file, issue, key: path });
  }
}

/**
 * One removed value: held for the failure when `strict` covers it, naming its issue's own path,
 * and else written at `-v`, naming the removed value, each by its position in the file as read. `round` is the file of the round that removes
 * it.
 */
async function reportRemoval(
  removal: Removal,
  round: Readonly<Record<string, unknown>>,
  reporting: Reporting,
): Promise<void> {
  const { file, held, log, strict } = reporting;
  if (!coversRemoval(strict, removal, round)) {
    logIgnored(
      log,
      { file, path: removal.readPath.length === noSteps ? undefined : shownPath(removal.readPath) },
      removal.sentence,
    );
    return undefined;
  }
  const path =
    removal.readIssuePath.length === noSteps ? undefined : shownPath(removal.readIssuePath);
  held.push(configPhrase('valueLine', path, file, removal.sentence));
  return undefined;
}

/** The unknown keys of a read: each held for the failure when `strict` covers it, and else written at `-v`. */
async function reportUnknown(paths: readonly Step[][], reporting: Reporting): Promise<void> {
  const { file, held, log, strict } = reporting;
  for (const path of paths) {
    if (covers(strict, path)) {
      held.push(configPhrase('unknownKeyLine', shownUnknownPath(path), file));
    } else {
      logIgnored(log, { file, path: shownUnknownPath(path) }, configPhrase('unknownKeyIssue'));
    }
  }
}

/** The lookup, the read, and the validation of one run. */
async function load<Schema extends StandardSchemaV1>(
  shared: Shared<Schema>,
  scene: Scene,
): Promise<Loaded<Schema>> {
  const { graph, host, invokedBy, log, options, out, style } = scene;
  const usable = await findFile(
    {
      app: graph.name,
      candidates: shared.candidates ?? [`.${graph.name}.json`],
      directory: stringOption(options, shared.directory),
      fromVariable: shared.env === undefined ? undefined : host.env[shared.env],
      host,
      ignored: options['no-config'] === true,
      invokedBy,
      named: stringOption(options, 'config'),
      notice: shared.notice,
      reach: shared.reach,
      readers: shared.readers,
      strict: isStrict(shared.strict),
    },
    { log, out, style },
  );
  // The `$schema` pointer names the file's hosted schema for an editor, and is never a setting.
  const object = usable === undefined ? {} : withoutPointer(usable.object);
  const reporting: Reporting = {
    file: usable?.file.shown,
    held: [],
    log,
    strict: shared.strict,
  };
  const passed = await dropUntilPasses(shared.schema, object, (removal, round) =>
    reportRemoval(removal, round, reporting),
  );
  const published = graph.configuration?.schema;
  if (published !== undefined && published !== null) {
    await reportUnknown(unknownKeys(passed.file, published, passed.origins), reporting);
  }
  return {
    held: reporting.held,
    output: passed.output,
    usable: usable === undefined ? undefined : { file: usable.file, object: passed.file },
  };
}

/** The run's shared result: the first reader starts the read, and every later reader awaits it. */
function loadOnce<Schema extends StandardSchemaV1>(
  shared: Shared<Schema>,
  scene: Scene,
): Promise<Loaded<Schema>> {
  const known = shared.reads.get(scene.host);
  if (known !== undefined) {
    return known;
  }
  const started = load(shared, scene);
  shared.reads.set(scene.host, started);
  return started;
}

export { loadOnce, stringOption };
export type { Loaded, Scene, Shared };
