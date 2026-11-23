import type { EnvironmentHook } from '@loomcli/core';
import { describe, expect, it, vi } from 'vite-plus/test';

import { environmentContext } from '../src/index.js';

/** Defaults REGION to us-east-1, and warns when it is set to a region outside the list. */
const regionDefault: EnvironmentHook = async ({ host, log, out }) => {
  const region = host.env.REGION;
  if (region === undefined) {
    log.debug('REGION defaulted.');
    return { REGION: 'us-east-1' };
  }
  if (!region.startsWith('us-')) {
    await out.warn(`REGION ${region} is outside the US.`);
  }
  return undefined;
};

/** Names the directory the hook ran in. */
const workingDirectory: EnvironmentHook = ({ host }) => ({ WORKDIR: host.cwd });

describe('environmentContext', () => {
  it('the hook reads the environment the test stated and returns its additions', async () => {
    const context = environmentContext(regionDefault, { host: { env: {} } });
    await expect(regionDefault(context)).resolves.toEqual({ REGION: 'us-east-1' });
  });

  it('a stated out.warn and log level receive the calls', async () => {
    const warn = vi.fn(async (_message: string) => {});
    const debug = vi.fn();
    const outside = environmentContext(regionDefault, {
      host: { env: { REGION: 'eu-west-1' } },
      out: { warn },
    });
    await regionDefault(outside);
    expect(warn).toHaveBeenCalledWith('REGION eu-west-1 is outside the US.');
    const unset = environmentContext(regionDefault, { host: { env: {} }, log: { debug } });
    await regionDefault(unset);
    expect(debug).toHaveBeenCalledWith('REGION defaulted.');
  });

  it('an unstated out.warn resolves and log levels do nothing', async () => {
    const context = environmentContext(regionDefault, { host: { env: { REGION: 'eu-west-1' } } });
    await expect(context.out.warn('anything')).resolves.toBeUndefined();
    expect(context.log.info('anything')).toBeUndefined();
    await expect(regionDefault(context)).resolves.toBeUndefined();
  });

  it('a stated host member is the value the test stated', () => {
    const env = { REGION: 'us-west-2' };
    const context = environmentContext(workingDirectory, { host: { cwd: '/srv/notes', env } });
    expect(context.host.cwd).toBe('/srv/notes');
    expect(context.host.env).toBe(env);
    expect(workingDirectory(context)).toEqual({ WORKDIR: '/srv/notes' });
  });

  it('an unstated host member throws its sentence when read', () => {
    const context = environmentContext(workingDirectory, { host: { env: {} } });
    expect(() => workingDirectory(context)).toThrow(
      'environmentContext has no host.cwd. Add host.cwd to its values.',
    );
    const bare = environmentContext(regionDefault, {});
    expect(() => bare.host.env).toThrow(
      'environmentContext has no host.env. Add host.env to its values.',
    );
    expect(() => bare.host.cwd).toThrow(
      'environmentContext has no host.cwd. Add host.cwd to its values.',
    );
  });
});
