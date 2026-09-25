import { readExtension } from '@loomcli/core';
import type { OptionNode, SourceAnswer, SourceContext, SourceResolver } from '@loomcli/core';

import type { SettingsOptions, settings } from './sources.js';
import { settingKey } from './sources.js';

// The resolver reads its own plugin's options, typed from the factory, and answers by name.
const resolver: SourceResolver<typeof settings> = async (context) => {
  const typed: SourceContext<SettingsOptions> = context;
  const file: string | undefined = typed.options.config;
  const verbose: boolean = typed.options.verbose;
  const requests: readonly OptionNode[] = typed.requests;
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
