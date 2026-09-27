import { readExtension } from '@loomcli/core';
import type {
  CommandGraph,
  ContextualStyle,
  OptionNode,
  Out,
  SourceAnswer,
  SourceContext,
  SourceResolver,
} from '@loomcli/core';

import type { SettingsOptions, settings } from './sources.js';
import { settingKey } from './sources.js';

// The resolver reads its own plugin's options, typed from the factory, and answers by name.
const resolver: SourceResolver<typeof settings> = async (context) => {
  const typed: SourceContext<SettingsOptions> = context;
  const file: string | undefined = typed.options.config;
  const verbose: boolean = typed.options.verbose;
  const requests: readonly OptionNode[] = typed.requests;
  // The ordinary channels a middleware and an action read: the graph, the channel, and the style.
  const graph: CommandGraph = typed.graph;
  const out: Out = typed.out;
  const style: ContextualStyle = typed.style;
  if (graph.globals.length === 0) {
    await out.warn(style.escape(`No global option in ${graph.name}.`));
  }
  const answers: Record<string, SourceAnswer> = {};
  for (const request of requests) {
    const key = readExtension(request, settingKey);
    if (key !== undefined) {
      answers[request.name] = { label: `${key} in ${file ?? typed.host.cwd}`, value: verbose };
    }
  }
  return answers;
};

export default resolver;
