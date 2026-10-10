import { Application, plugin } from '@loomcli/core';
import type {
  JsonValue,
  Log,
  LogDefect,
  LogDestination,
  LogEvent,
  LogFields,
  LogHook,
  LogLevel,
  MiddlewareContext,
  PluginDefinition,
  SourceContext,
} from '@loomcli/core';

interface Entry {
  readonly name: string;
}

class Point {
  readonly across = 1;
}

declare const entry: Entry;

// An action logs with fields of any kind, because the copy turns each into JSON.
const app = new Application('probe').action(({ log }) => {
  const returned: void = log.info('indexed', {
    at: new Date(),
    big: 10n,
    cause: new Error('x'),
    entry,
    missing: undefined,
    point: new Point(),
  });
  log.trace('t');
  log.debug('d');
  log.warn('w');
  log.error('e');
  log.info('no fields');
  const bound: Log = log;
  void [returned, bound];
});

// A middleware, a source, and an onFailure hook each carry the same log.
const reaching: PluginDefinition = {
  middleware: {
    activate: 'always',
    load: async () => ({
      default: async (context: MiddlewareContext) => {
        context.log.info('from middleware');
        await context.next();
      },
    }),
  },
  onFailure: (_failure, { log }) => {
    log.warn('from hook');
    return undefined;
  },
};
const resolve = (context: SourceContext) => context.log;

// A hook is written as an arrow with no return, and reads the event and its destination.
const stacks: LogHook = (event: LogEvent, destination: LogDestination) => {
  const level: LogLevel = event.level;
  const fields: Readonly<Record<string, JsonValue>> = event.fields;
  const defect: LogDefect | undefined = event.defect;
  const path: readonly string[] = event.path;
  const owner: string | null = event.plugin;
  const run: string = event.run;
  const { name, version }: { readonly name: string; readonly version: string } = event.application;
  void [level, fields, defect, path, owner, run, name, version];
  destination.stderr?.write(`${event.message}\n`);
};
const observing = plugin('@acme/stacks', { onLog: stacks });
const inline: PluginDefinition = { onLog: (event) => void event.time };

const looseFields: LogFields = { anything: new Map() };

// @ts-expect-error TS2339: Log has no fatal, because out.fatal() throws and ends the run.
const fatal = new Application('probe').action(({ log }) => log.fatal('gone'));

// @ts-expect-error TS2322: A hook observes, so it returns nothing.
const returning: PluginDefinition = { onLog: () => true };

// @ts-expect-error TS2322: A hook is synchronous, so it returns no promise.
const asynchronous: PluginDefinition = { onLog: async () => undefined };

const noGraphLog: PluginDefinition = {
  // @ts-expect-error TS2339: onGraphBuilt runs at graph build, where no run exists, so it has no log.
  onGraphBuilt: (graph) => graph.log,
};

const noAttachLog: PluginDefinition = {
  // @ts-expect-error TS2339: onCommandAttach runs at graph build, where no run exists, so it has no log.
  onCommandAttach: (command) => command.log,
};

void [app, reaching, resolve, observing, inline, looseFields, fatal, returning, asynchronous];
void [noGraphLog, noAttachLog];
