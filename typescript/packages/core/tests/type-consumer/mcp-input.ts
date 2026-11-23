import { mcpInput } from '@loomcli/plugins/mcp/extension';

// An option is described for an agent, or excluded from every tool.
const described = mcpInput({ description: 'The file to read.' });
const excluded = mcpInput({ exclude: true });

// @ts-expect-error TS2322: An excluded option has no property to describe, so a value never holds both.
const both = mcpInput({ description: 'The file to read.', exclude: true });

// @ts-expect-error TS2322: Only `true` excludes an option.
const kept = mcpInput({ exclude: false });

export { both, described, excluded, kept };
