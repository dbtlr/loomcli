/** A JSON value, as a message carries it. */
export type JsonValue =
  | boolean
  | number
  | string
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Who the server is. Every result carries it in `_meta` under `io.modelcontextprotocol/serverInfo`. */
export interface ServerIdentity {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
}

/** The hints a tool may carry about its effects. A client treats them as untrusted. */
export interface ToolAnnotations {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

/** One tool as `tools/list` lists it. Its input schema describes the object `arguments` holds. */
export interface Tool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: { readonly type: 'object'; readonly [key: string]: unknown };
  readonly outputSchema?: { readonly type: 'object'; readonly [key: string]: unknown };
  readonly annotations?: ToolAnnotations;
}

/** One text item of a tool result's `content`. */
export interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

/**
 * What a tool call answers. `isError` marks a tool execution error, which a model reads and can
 * correct, as opposed to a protocol error. `structuredContent` may hold any JSON value.
 */
export interface CallToolResult {
  readonly content: readonly TextContent[];
  readonly structuredContent?: JsonValue;
  readonly isError?: boolean;
}

/**
 * One `tools/call` request as a handler receives it. `arguments` is what the client sent, absent
 * or not, so the handler judges its shape. `signal` aborts when the client cancels the request or
 * the server shuts down.
 */
export interface ToolCall {
  readonly name: string;
  readonly arguments: unknown;
  readonly signal: AbortSignal;
}
