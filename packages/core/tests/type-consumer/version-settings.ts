import { override } from '@loomcli/core';
import type { CommandGraph } from '@loomcli/core';
import { version } from '@loomcli/plugins/version';
import type { VersionSettings } from '@loomcli/plugins/version';
import { versionLine } from '@loomcli/plugins/version/views';
import type { VersionLine } from '@loomcli/plugins/version/views';

const plain = version();
const postfixed = version({ postfix: '(Report schema v1)' });
const settings: VersionSettings = {};
const empty = version(settings);
// @ts-expect-error TS2322: A postfix is a string.
const numbered = version({ postfix: 1 });

// An override reads the graph and the postfix the line receives.
const tail = override(versionLine, {
  render: ({ graph, postfix }: VersionLine) => `${graph.name} ${postfix ?? ''}\n`,
});
const composed = override(versionLine, {
  render: (line, context) => `build\n${versionLine.render(line, context)}`,
});
const graphOnly = override(versionLine, {
  // @ts-expect-error TS2322: The version line's data is { graph, postfix }, not the graph.
  render: (graph: CommandGraph) => `${graph.name}\n`,
});

export { composed, empty, graphOnly, numbered, plain, postfixed, tail };
