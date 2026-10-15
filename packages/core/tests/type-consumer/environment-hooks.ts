import { plugin } from '@loomcli/core';
import type { EnvironmentContext, EnvironmentHook } from '@loomcli/core';

const prepare: EnvironmentHook = async (context: EnvironmentContext) => {
  const cwd: string = context.host.cwd;
  const existing: string | undefined = context.host.env.TOKEN;
  await context.out.warn('A fixed warning.');
  context.log.debug('Preparing the environment.');
  // @ts-expect-error Preparation exposes no parsed invocation or process streams.
  void context.host.argv;
  // @ts-expect-error Preparation exposes only the warning output call.
  void context.out.results;
  // @ts-expect-error Hook input is a read-only environment snapshot.
  context.host.env.TOKEN = 'changed';
  return { TOKEN: existing ?? cwd };
};

plugin('fixture/environment', { onEnvironment: prepare });
// @ts-expect-error Environment additions hold strings.
plugin('fixture/invalid', { onEnvironment: () => ({ TOKEN: 4 }) });
