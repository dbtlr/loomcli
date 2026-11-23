import { Application, lanes, plugin } from '@loomcli/core';
import type { MessageArguments, Out, View } from '@loomcli/core';

/** A view over a string, which a string message takes and a stream never does. */
const framed: View<string> = { render: (message) => `[${message}]\n` };

/** An answer's text as it arrives. */
async function* answer(): AsyncGenerator<string> {
  yield 'Loom ';
  yield 'streams.';
}

/** Text whose chunks are at hand all at once, which no semantic method takes. */
const words: Iterable<string> = new Set(['one', 'two']);

/** A message that may be either form, which a caller narrows before the call. */
declare const either: string | AsyncIterable<string>;

/** Each semantic method takes an async iterable of its text, and no view beside it. */
new Application('streamed').action(async ({ out }) => {
  await out.print(answer());
  await out.info(answer());
  await out.success(answer());
  await out.warn(answer());
  await out.error(answer());
  await (typeof either === 'string' ? out.info(either) : out.info(either));
  // @ts-expect-error TS2769: A stream takes no view.
  await out.info(answer(), framed);
  // @ts-expect-error TS2769: A stream draws through its lane view alone, a declared one included.
  await out.warn(answer(), lanes.error);
  // @ts-expect-error TS2769: A plain iterable of text is no stream.
  await out.print(words);
  // @ts-expect-error TS2769: An array of strings is no stream.
  await out.print(['one', 'two']);
  // @ts-expect-error TS2769: A message that may be either form is neither until it is narrowed.
  await out.info(either);
});

/** The two argument lists are one exported type, which a wrapper forwards whole. */
function forward(out: Out, ...call: MessageArguments): Promise<void> {
  return out.info(...call);
}
void forward;

/** A generic answer, as a prompt returns one, whose type a call infers from where it is used. */
declare function answered<Output = string>(): Promise<Output>;

/** A generic answer passed straight to a method is read as a string message. */
new Application('answered').action(async ({ out }) => {
  await out.print(await answered());
});

/** A lane a test states keeps compiling with a string parameter, and may take both forms. */
const stated: Partial<Out> = {
  info: async (...call: MessageArguments) => {
    void call;
  },
  print: async (_message: string) => undefined,
};
void stated;

/** The warn an onEnvironment hook receives takes a stream too, and no view beside it. */
plugin('fixture/environment-stream', {
  onEnvironment: async ({ out }) => {
    await out.warn(answer());
    // @ts-expect-error TS2769: A stream takes no view.
    await out.warn(answer(), framed);
    return {};
  },
});
