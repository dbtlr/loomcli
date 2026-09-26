import { setTimeout as after } from 'node:timers/promises';

import { InputError, readExtension } from '@loomcli/core';

import { configKey } from './extension.mjs';

/** How this run's source behaves, chosen by the test. */
const mode = process.env.FIXTURE_SOURCE ?? 'answer';

if (mode === 'import-fails') {
  throw new Error('the source module failed to evaluate');
}

/**
 * The fixture's configuration source. It prints what core handed it, then answers each requested
 * option whose key the settings in `FIXTURE_SETTINGS` hold.
 */
const source = async ({ graph, host, options, out, requests, style }) => {
  const names = requests.map((request) => request.name);
  process.stdout.write(`source:${JSON.stringify({ options, requests: names })}\n`);
  if (mode === 'throw') {
    throw new Error(process.env.FIXTURE_REASON ?? 'the settings file is locked');
  }
  if (mode === 'context') {
    // The graph is the one inspect() returns, and each request is a node inside it.
    const globals = requests.map((request) => graph.globals.includes(request));
    const select = graph.root.children.find((child) => child.name === 'select');
    const routed = select.options.some((option) => requests.includes(option));
    process.stdout.write(
      `context:${JSON.stringify({ globals, name: graph.name, routed, style: typeof style.escape })}\n`,
    );
  }
  if (mode === 'warn') {
    await out.warn(
      `Skipped ${style.escape(host.env.FIXTURE_WARN_PATH ?? 'a.json')}: the file is not valid JSON.`,
    );
  }
  if (mode === 'input-error') {
    throw new InputError('Option "--config": File "missing.json" does not exist.', [
      {
        input: { global: true, kind: 'option', name: 'config' },
        issues: [{ message: 'File "missing.json" does not exist.' }],
        reason: 'invalid',
        spelling: '--config',
      },
    ]);
  }
  if (mode === 'results') {
    await out.results('x');
  }
  if (mode === 'fatal') {
    out.fatal('the source gave up');
  }
  if (mode === 'input-error-getter') {
    return {
      get limit() {
        throw new InputError('Option "--limit": not from the resolver.', []);
      },
    };
  }
  if (mode === 'cancel') {
    globalThis.fixtureAbort();
    await after(50);
    process.stdout.write('source:settled\n');
  }
  if (mode === 'not-record') {
    return names;
  }
  if (mode === 'unrequested') {
    return { port: { label: 'port in fixture.json', value: '1' } };
  }
  if (mode === 'sparse' || mode === 'hollow') {
    // A list with holes, which a check that skips holes would pass as a list of strings.
    // `sparse` holds a hole beside a string, and `hollow` holds two holes and nothing else.
    const value = [];
    if (mode === 'sparse') {
      value[1] = 'a';
    } else {
      value.length = 2;
    }
    return { fields: { label: 'fields in fixture.json', value } };
  }
  if (mode === 'record-getter') {
    return {
      get limit() {
        throw new Error('the answers record threw');
      },
    };
  }
  if (mode === 'label-getter') {
    return {
      limit: {
        get label() {
          throw new Error('the answer label threw');
        },
        value: '1',
      },
    };
  }
  const settings = JSON.parse(host.env.FIXTURE_SETTINGS ?? '{}');
  const answers = {};
  for (const request of requests) {
    const key = readExtension(request, configKey);
    if (key !== undefined && Object.hasOwn(settings, key)) {
      const label = mode === 'bad-label' ? 'two\nlines' : `${key} in fixture.json`;
      answers[request.name] = mode === 'bare' ? settings[key] : { label, value: settings[key] };
    }
  }
  return answers;
};

export default source;
