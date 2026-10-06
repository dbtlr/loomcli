import { Command, DeclarationError, diagnosticRule, plugin, view } from '@loomcli/core';
import type {
  CommandGraph,
  GraphBuiltHook,
  OptionNode,
  PluginDefinition,
  ResultNode,
  RowView,
  View,
} from '@loomcli/core';

const tooWide = diagnosticRule('@acme/judge/too-wide', {
  explanation: 'An agent reads every Command, so the root holds a short list.',
  headline: 'Too many Commands',
});

// A hook judges the frozen graph and returns nothing; it rejects the graph by throwing.
const judge: GraphBuiltHook = (graph: CommandGraph) => {
  if (graph.root.children.length > 100) {
    throw new DeclarationError(tooWide, {
      correction: 'Group the Commands.',
      sentence: 'The root holds more than 100 Commands.',
    });
  }
  return undefined;
};
const silent: GraphBuiltHook = () => {};
const definition: PluginDefinition = { onGraphBuilt: judge };

// @ts-expect-error TS2322: A hook returns nothing, so a returned value is a compile error.
const returning: GraphBuiltHook = () => true;
// @ts-expect-error TS2322: A promise is a returned value too.
const later: GraphBuiltHook = async () => {};

// Every view shape declares the media type of the text it writes, or none.
const csv: View<readonly string[]> = { mediaType: 'text/csv', render: (rows) => rows.join('\n') };
const lines: RowView<string> = { mediaType: 'text/plain', row: (line) => `${line}\n` };
const page = view<{ readonly title: string }>('@acme/notes/page', {
  mediaType: 'text/plain',
  render: (data) => `${data.title}\n`,
});
// @ts-expect-error TS2322: A media type is a string.
const numbered: View<string> = { mediaType: 5, render: (text) => text };
view<string>('@acme/notes/count', {
  // @ts-expect-error TS2769: A declared view's media type is a string too.
  mediaType: 5,
  // @ts-expect-error TS2769: No overload matches, so the row view overload rejects render too.
  render: (text: string) => text,
});

// A result publishes each view's media type by view name, null where a view declares none.
const read = (node: ResultNode): string | null | undefined => node.mediaTypes.csv;
const count = new Command('count').rows<string>({ views: { csv, lines } }).action(() => {});

// Every option kind takes the control mark, and a node publishes it as a Boolean.
const marked = new Command('get')
  .option('format', { control: true, type: 'string' })
  .option('help', { control: true, type: 'boolean' })
  .option('verbose', { control: false, type: 'count' })
  .action(() => {});
const control = (node: OptionNode): boolean => node.control;
void plugin('@acme/help', { options: { help: { control: true, type: 'boolean' } } });

// @ts-expect-error TS2322: A control mark is a Boolean.
new Command('get').option('format', { control: 'yes', type: 'string' });
// @ts-expect-error TS2353: An argument is always the Command's input, so it takes no control mark.
new Command('get').argument('path', { control: true });

void [silent, definition, returning, later, page, numbered, read, count, marked, control];
