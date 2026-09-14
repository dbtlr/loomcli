import { Application, override } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpPage } from '@loomcli/plugins/help/views';

/**
 * The application brands the page the installed help plugin renders. The plugin stays installed and
 * keeps its option and its middleware; only the view function behind the page is replaced. A broken
 * replacement reports one diagnostic and returns 1, which is the second scenario here.
 */
const breaks = {
  render: () => {
    throw new Error('Cannot render the page.');
  },
};

const branded = {
  render: ({ command, graph }, { style }) =>
    `${style.escape(`${graph.name}: ${command.name ?? graph.description ?? ''}`)}\n`,
};

const scenario = process.argv[2];
const application = new Application('jsonkit', {
  description: 'Read and reshape one JSON document.',
  plugins: [help()],
  views: [override(helpPage, scenario === 'broken' ? breaks : branded)],
}).action(({ out }) => out.print('summarized'));

process.exitCode = await application.run({ host: { argv: ['--help'] } });
