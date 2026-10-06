import { errorCodes, McpServer, ProtocolError } from '@loom/mcp';
import type { CallToolResult, JsonValue, ServerIdentity, TextContent, ToolCall } from '@loom/mcp';
import { Command, plugin } from '@loomcli/core';
import type {
  ActionContext,
  CommandGraph,
  CommandNode,
  InvocationOutcome,
  InvocationValues,
  Plugin,
} from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { mcpArgument, mcpCommand, mcpInput } from './extension.js';
import { judgeTools } from './faults.js';
import { listedTool, propertiesOf, toolEntries } from './tools.js';
import type { ListedTool, Property, ToolEntry } from './tools.js';

/** The context the `mcp` action reads: the run's graph, host, signal, and `invoke`. */
type ServeContext = Pick<ActionContext<unknown>, 'graph' | 'host' | 'invoke' | 'signal'>;

/** What a failed call's handler returns, which the call answers as its structured content. */
interface FailedCall {
  readonly exitCode: number;
  readonly failure: JsonValue;
}

/** The media type whose view a call selects and whose output it sends as structured content. */
const jsonMediaType = 'application/json';

/** The server's identity: the application's name, version, and description where it declares one. */
function identityOf(graph: CommandGraph): ServerIdentity {
  return {
    name: graph.name,
    version: graph.version,
    ...(graph.description === undefined ? {} : { description: graph.description }),
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

/** Whether a value is a JSON object, as a call's `arguments` must be. */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A call's arguments, an object or nothing, which reads as no arguments. */
function argumentsOf(entry: ToolEntry, call: ToolCall): Readonly<Record<string, unknown>> {
  const received = call.arguments === undefined ? {} : call.arguments;
  if (!isObject(received)) {
    throw new ProtocolError(
      errorCodes.invalidParams,
      `Tool "${entry.name}" arguments must be an object. Supply a JSON object of named inputs.`,
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
    content: [
      text(
        `Tool "${entry.name}" takes no argument "${unlisted}". Use a property its input schema lists.`,
      ),
    ],
    isError: true,
  };
}

/**
 * Runs one tool call through `invoke`, as the Command's own run, and answers its result. A key the
 * input schema does not list answers a tool execution error, and no run starts.
 */
async function callTool(
  context: ServeContext,
  entry: ToolEntry,
  call: ToolCall,
): Promise<CallToolResult> {
  const received = argumentsOf(entry, call);
  const properties = propertiesOf(context.graph, entry.command);
  const refused = unlistedKey(entry, properties, received);
  if (refused !== undefined) {
    return refused;
  }
  const view = jsonView(entry.command);
  const outcome = await context.invoke(entry.command.path, invocationValues(received, properties), {
    failure: (_failure, { exitCode, form }): FailedCall => ({ exitCode, failure: { ...form } }),
    signal: call.signal,
    ...(view === undefined ? {} : { view }),
  });
  return callResult(outcome, view);
}

/**
 * Serves every opted-in Command as a tool over the host's stdin and stdout until stdin ends or the
 * run's signal aborts. The tool table is derived here from the run's graph, which the build-fault
 * hook already judged.
 */
async function serve(context: ServeContext): Promise<void> {
  const entries = toolEntries(context.graph);
  const tools: readonly ListedTool[] = entries.map((entry) => listedTool(context.graph, entry));
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const server = new McpServer({
    callTool: (call) => {
      const entry = byName.get(call.name);
      if (entry === undefined) {
        throw new ProtocolError(
          errorCodes.invalidParams,
          `Unknown tool "${call.name}". Call tools/list for the tool names.`,
        );
      }
      return callTool(context, entry, call);
    },
    identity: identityOf(context.graph),
    listTools: () => tools,
  });
  await server.run(context.host.stdin, context.host.stdout, { signal: context.signal });
}

// This package compiles outside any Application's registration, so the Command requires no globals.
const mcpServeCommand = new Command('mcp', {
  description: "Serve this application's tools to an MCP client over stdin and stdout.",
}).action(serve);

/**
 * A plugin that serves every Command carrying an `mcpCommand` value as one tool of a Model Context
 * Protocol server over stdio, each call run through `invoke`. It contributes the `mcp` Command, the
 * three extensions, and a hook that rejects a graph whose tools cannot be served.
 */
export function mcp(): Plugin {
  return plugin(`${Package.name}/mcp`, {
    commands: [mcpServeCommand],
    extensions: [mcpCommand, mcpInput, mcpArgument],
    onGraphBuilt: judgeTools,
  });
}
