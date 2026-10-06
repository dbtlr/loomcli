import { errorCodes, McpServer, ProtocolError } from '@loom/mcp';

/**
 * A server over this process's stdio whose tools exercise each path a handler can take. A handler
 * reports what it saw on stderr, because stdout carries protocol messages alone.
 */
const scenario = process.argv[2] ?? 'default';
const stop = new AbortController();

const tools = [
  {
    description: 'Answers the call it received.',
    inputSchema: { properties: { text: { type: 'string' } }, type: 'object' },
    name: 'echo',
  },
  { inputSchema: { type: 'object' }, name: 'wait' },
];

/** The tool handlers, keyed by tool name. */
const calls = {
  echo: ({ name, arguments: input }) => ({
    content: [{ text: 'first line\nsecond line', type: 'text' }],
    isError: false,
    structuredContent: { arguments: input, name },
  }),
  refuse: () => {
    throw new ProtocolError(errorCodes.invalidParams, 'Refused.', { reason: 'fixture' });
  },
  stop: () => {
    stop.abort();
    return { content: [{ text: 'stopped', type: 'text' }], isError: false };
  },
  throw: () => {
    throw new Error('The fixture tool failed.');
  },
  wait: ({ arguments: input, signal }) =>
    new Promise((resolve) => {
      process.stderr.write(`started ${input.label}\n`);
      signal.addEventListener('abort', () => {
        process.stderr.write(`aborted ${input.label}\n`);
        resolve({ content: [{ text: `aborted ${input.label}`, type: 'text' }], isError: true });
      });
    }),
};

const server = new McpServer({
  callTool: (call) => calls[call.name](call),
  identity: { description: 'A conformance fixture.', name: 'fixture', version: '1.2.3' },
  listTools: () => {
    if (scenario === 'list-throws') {
      throw new Error('The fixture listing failed.');
    }
    return tools;
  },
});

await server.run(process.stdin, process.stdout, { signal: stop.signal });
process.stderr.write('resolved\n');
