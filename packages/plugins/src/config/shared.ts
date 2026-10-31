import { escapeControlCharacters, nowrap } from '@loomcli/core';
import type { CommandGraph, ContextualStyle, Host, Out, StandardSchemaV1 } from '@loomcli/core';

import { dropUntilPasses } from './drop.js';
import type { Removal, Step } from './drop.js';
import { findFile } from './lookup.js';
import type { UsableFile } from './lookup.js';
import { withoutPointer } from './pointer.js';
import type { Reach } from './scopes.js';

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
  readonly schema: Schema;
  /** The result each run read, by the run's host. */
  readonly reads: WeakMap<Host, Promise<Loaded<Schema>>>;
}

/** What a run read: the file that passed, when one was found, and the schema's output for it. */
interface Loaded<Schema extends StandardSchemaV1> {
  /** The file the run read with every dropped value removed, or `undefined` when it found none. */
  readonly usable: UsableFile | undefined;
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

/** The `-v` line for one removed value, each piece of raw data escaped. */
function removalLine(removal: Removal, file: string | undefined, style: ContextualStyle): string {
  const raw = (text: string) => style.escape(escapeControlCharacters(text));
  const where = file === undefined ? '' : ` in ${nowrap(style.escape(file))}`;
  const subject =
    removal.path.length === noSteps ? 'every key' : nowrap(raw(shownPath(removal.path)));
  return `Ignored ${subject}${where}: ${raw(removal.message)}`;
}

/** The lookup, the read, and the validation of one run. */
async function load<Schema extends StandardSchemaV1>(
  shared: Shared<Schema>,
  scene: Scene,
): Promise<Loaded<Schema>> {
  const { graph, host, invokedBy, options, out, style } = scene;
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
    },
    { out, style },
  );
  // The `$schema` pointer names the file's hosted schema for an editor, and is never a setting.
  const object = usable === undefined ? {} : withoutPointer(usable.object);
  const passed = await dropUntilPasses(shared.schema, object, (removal) =>
    out.debug(removalLine(removal, usable?.file.shown, style)),
  );
  return {
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
