/**
 * The `mcp` Command's server: it serves every opted-in Command as a tool, each call run through
 * `invoke`, over the host's stdin and stdout or, with `--http`, over HTTP. The plugin loads this
 * module when the Command runs, so the protocol package loads only then, and this module loads the
 * HTTP server only when `--http` is given.
 */
import { errorCodes, McpServer, ProtocolError } from '@loom/mcp';
import type { CallToolResult, JsonValue, ServerIdentity, TextContent, ToolCall } from '@loom/mcp';
import { resolveTimeZone } from '@loomcli/core';
import type {
  ActionContext,
  CommandGraph,
  CommandNode,
  InvocationOutcome,
  InvocationValues,
  InvokeOptions,
} from '@loomcli/core';

import { singleLine } from '../lines.js';
import { isRecord } from '../plain-data.js';
import type { HttpAddress } from './address.js';
import { excludedNames } from './exposure.js';
import { mcpPhrase } from './phrases.js';
import type { McpSettings } from './plugin.js';
import { progressRelay } from './progress.js';
import { listedTool, propertiesOf, toolEntries } from './tools.js';
import type { ListedTool, Property, ToolEntry } from './tools.js';

/** The context the `mcp` action reads: the run's graph, host, signal, `invoke`, `log`, and `out`. */
type ServeContext = Pick<
  ActionContext<unknown>,
  'graph' | 'host' | 'invoke' | 'log' | 'out' | 'signal'
>;

/** How the `mcp` action serves: the plugin's settings, and the address `--http` names, if any. */
interface Serving {
  readonly settings: McpSettings;
  readonly http: HttpAddress | undefined;
}

/** What a failed call's handler returns, which the call answers as its structured content. */
interface FailedCall {
  readonly exitCode: number;
  readonly failure: JsonValue;
}

/** The media type whose view a call selects and whose output it sends as structured content. */
const jsonMediaType = 'application/json';

/**
 * The server's identity: the application's name, version, and description where it declares one,
 * on one line, a line break the author wrote read as a space.
 */
function identityOf(graph: CommandGraph): ServerIdentity {
  return {
    name: graph.name,
    version: graph.version,
    ...(graph.description === undefined ? {} : { description: singleLine(graph.description) }),
  };
}

/** The first view, in record order, that declares `application/json`, if the Command has one. */
function jsonView(command: CommandNode): string | undefined {
  const { result } = command;
  return result?.views.find((name) => result.mediaTypes[name] === jsonMediaType);
}

/** One text item, its type first as the protocol writes it. */
function text(value: string): TextContent {
  return { type: 'text', text: value };
}

/** The nonempty texts as text items in order, or one empty item when every text is empty. */
function contentOf(...texts: readonly string[]): readonly TextContent[] {
  const written = texts.filter((each) => each !== '');
  const [first] = written;
  return first === undefined ? [text('')] : written.map(text);
}

/** The output parsed as JSON, or nothing when it does not parse: a media type is a promise. */
function parsedJson(output: string): { readonly structuredContent: JsonValue } | undefined {
  try {
    const structuredContent: JsonValue = JSON.parse(output);
    return { structuredContent };
  } catch {
    return undefined;
  }
}

/** The result a settled call answers. A cancelled call answers nothing, so its result is dropped. */
function callResult(
  outcome: InvocationOutcome<FailedCall>,
  view: string | undefined,
): CallToolResult {
  if (outcome.status === 'failed') {
    return {
      content: contentOf(outcome.messages, outcome.output),
      isError: true,
      structuredContent: { ...outcome.failure },
    };
  }
  if (outcome.status === 'cancelled') {
    return { content: [] };
  }
  return {
    content: contentOf(outcome.output, outcome.messages),
    isError: false,
    ...(view === undefined ? {} : parsedJson(outcome.output)),
  };
}

/** A call's arguments, an object or nothing, which reads as no arguments. */
function argumentsOf(entry: ToolEntry, call: ToolCall): Readonly<Record<string, unknown>> {
  const received = call.arguments === undefined ? {} : call.arguments;
  if (!isRecord(received)) {
    throw new ProtocolError(
      errorCodes.invalidParams,
      mcpPhrase('argumentsNotObject', entry.name).text,
    );
  }
  return received;
}

/**
 * A client's named values, split by whether each names an argument. A value is passed as the
 * client sent it, because `invoke` judges every value and reports one it cannot lower by name.
 */
function invocationValues(
  received: Readonly<Record<string, unknown>>,
  properties: readonly Property[],
): InvocationValues {
  const argumentNames = new Set(
    properties.flatMap((property) => (property.kind === 'argument' ? [property.node.name] : [])),
  );
  const args: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(received)) {
    (argumentNames.has(key) ? args : options)[key] = value;
  }
  // Last resort: no typed path exists, because a client's JSON can hold any value under any name.
  // It holds because invoke reads every value as unknown at run time, as it reads a JavaScript caller's, and reports a value outside its value types as an input problem by name.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { args, options } as InvocationValues;
}

/** The tool execution error for a key the tool's input schema does not list, if any. */
function unlistedKey(
  entry: ToolEntry,
  properties: readonly Property[],
  received: Readonly<Record<string, unknown>>,
): CallToolResult | undefined {
  const listed = new Set(properties.map(({ node }) => node.name));
  const unlisted = Object.keys(received).find((key) => !listed.has(key));
  if (unlisted === undefined) {
    return undefined;
  }
  return {
    content: [text(mcpPhrase('unlistedArgument', entry.name, unlisted).text)],
    isError: true,
  };
}

/**
 * The time zone a call's metadata names: `zone` holds the resolved IANA name, or `undefined` when
 * the metadata names none, and `refusal` the tool execution error for a value no zone resolves.
 */
type CallZone =
  | { readonly kind: 'resolved'; readonly zone: string | undefined }
  | { readonly kind: 'refused'; readonly refusal: CallToolResult };

/** The zone the call's metadata names, resolved, or the refusal of a value that names none. */
function callTimeZone({ _meta: metadata }: ToolCall): CallZone {
  const key = 'io.github.dbtlr.loomcli/timeZone';
  if (metadata === undefined || !Object.hasOwn(metadata, key)) {
    return { kind: 'resolved', zone: undefined };
  }
  const named = metadata[key];
  const zone = typeof named === 'string' ? resolveTimeZone(named) : undefined;
  return zone === undefined
    ? {
        kind: 'refused',
        refusal: { content: [text(mcpPhrase('invalidTimeZone').text)], isError: true },
      }
    : { kind: 'resolved', zone };
}

/** One tool call on its way to `invoke`: its tool, the call, its values, and its time zone. */
interface CallRun {
  readonly entry: ToolEntry;
  readonly call: ToolCall;
  readonly values: InvocationValues;
  readonly timeZone: string | undefined;
}

/**
 * How a tool call's run is invoked: without the names the tool leaves out, with each failure kept
 * as its form, under the call's signal, time zone, and JSON view, and relaying progress when the
 * call carries a progress token.
 */
function invokeOptions(
  context: ServeContext,
  { call, entry, timeZone }: CallRun,
  view: string | undefined,
): InvokeOptions<FailedCall> {
  const exclude = excludedNames(context.graph, entry.command);
  const [firstExcluded] = exclude;
  return {
    ...(firstExcluded === undefined ? {} : { exclude }),
    failure: (_failure, { exitCode, form }): FailedCall => ({ exitCode, failure: { ...form } }),
    signal: call.signal,
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(view === undefined ? {} : { view }),
    ...(call.progress === undefined ? {} : { onProgress: progressRelay(call.progress) }),
  };
}

/** Runs one admitted tool call through `invoke`, as the Command's own run, and answers its result. */
async function runCall(context: ServeContext, run: CallRun): Promise<CallToolResult> {
  const view = jsonView(run.entry.command);
  const outcome = await context.invoke(
    run.entry.command.path,
    run.values,
    invokeOptions(context, run, view),
  );
  return callResult(outcome, view);
}

/**
 * Runs one tool call through `invoke`, as the Command's own run, and answers its result. A key the
 * input schema does not list, and then a metadata time zone that is not a string naming a zone this
 * runtime knows, each answer a tool execution error, and no run starts. A call that carries a
 * progress token receives each progress event of the run as a notification.
 */
async function callTool(
  context: ServeContext,
  entry: ToolEntry,
  call: ToolCall,
): Promise<CallToolResult> {
  const received = argumentsOf(entry, call);
  const properties = propertiesOf(context.graph, entry.command);
  const unlisted = unlistedKey(entry, properties, received);
  if (unlisted !== undefined) {
    return unlisted;
  }
  const called = callTimeZone(call);
  if (called.kind === 'refused') {
    return called.refusal;
  }
  const values = invocationValues(received, properties);
  return await runCall(context, { call, entry, timeZone: called.zone, values });
}

/**
 * Serves every opted-in Command as a tool over the host's stdin and stdout until stdin ends or the
 * run's signal aborts, or, with `--http`, over HTTP until the run's signal aborts. The tool table is
 * derived here from the run's graph, which the build-fault hook already judged.
 */
async function serve(context: ServeContext, { http, settings }: Serving): Promise<void> {
  const entries = toolEntries(context.graph);
  const tools: readonly ListedTool[] = entries.map((entry) => listedTool(context.graph, entry));
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const server = new McpServer({
    callTool: (call) => {
      const entry = byName.get(call.name);
      if (entry === undefined) {
        throw new ProtocolError(errorCodes.invalidParams, mcpPhrase('unknownTool', call.name).text);
      }
      return callTool(context, entry, call);
    },
    identity: identityOf(context.graph),
    listTools: () => tools,
  });
  if (http === undefined) {
    await server.run(context.host.stdin, context.host.stdout, { signal: context.signal });
    return;
  }
  const { serveHttp } = await import('./serve-http.js');
  await serveHttp(context, {
    address: http,
    settings,
    transport: (options) => server.http(options),
  });
}

export { serve };
