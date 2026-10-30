import { Command, plugin } from '@loomcli/core';
import type { ActionContext, Plugin } from '@loomcli/core';

import { json } from '../format/views.js';
import { control, installChild, isPresent, prepare, uninstallChild } from './children.js';
import type { ChildRun } from './children.js';
import { judgeRun } from './route.js';
import { identity, judgeSettings } from './settings.js';
import { stateOf, statusOf, statusText } from './status.js';
import type { ServiceDetail, ServiceSettings, ServiceState, ServiceStatus } from './types.js';

/** What every child reads from its action context. */
type ChildContext = Pick<
  ActionContext<unknown>,
  'graph' | 'host' | 'invoke' | 'log' | 'onShutdown' | 'out' | 'signal'
>;

/** The run a child acts on, read from its action context. */
function childRun(label: string, context: ChildContext): ChildRun {
  const { graph, host, onShutdown, out, signal } = context;
  return {
    description: graph.description,
    host,
    info: (message) => out.info(message),
    label,
    name: graph.name,
    onShutdown,
    signal,
    success: (message) => out.success(message),
  };
}

/** A maker of the children with no arguments and no options, each action reading the run. */
function childrenOf(label: string) {
  return (name: string, description: string, act: (run: ChildRun) => Promise<void>) =>
    new Command(name, { description }).action(async (context) => {
      await act(childRun(label, context));
    });
}

/** The probe's rows for an installed unit, or none. */
async function detailsOf(
  settings: ServiceSettings,
  state: ServiceState,
  context: ChildContext,
): Promise<readonly ServiceDetail[]> {
  if (settings.probe === undefined || !state.installed) {
    return [];
  }
  const { host, invoke, log, signal } = context;
  return await settings.probe({ host, invoke, log, signal, state });
}

/**
 * `status`: the checks, then the manager's state, the probe's rows for an installed unit, and one
 * result. It exits 0 whenever it produced a report.
 */
function statusCommand(settings: ServiceSettings) {
  return new Command('status', { description: 'Report whether the service is running.' })
    .result<ServiceStatus>({
      views: { text: { render: (status, { style }) => statusText(status, style) } },
    })
    .views({ json: json<ServiceStatus>() })
    .action(async (context) => {
      const { backend, service: unit } = prepare(childRun(settings.label, context));
      const installed = isPresent(unit.unit);
      const reading = await backend.read(unit, installed);
      const state = stateOf({ installed, label: settings.label, unit: unit.unit }, reading);
      await context.out.results(statusOf(state, await detailsOf(settings, state, context)));
    });
}

/** The `service` group and its six children. */
function serviceCommand(settings: ServiceSettings) {
  const { label, run } = settings;
  const child = childrenOf(label);
  return new Command('service', { description: 'Run this application as a background service.' })
    .command(
      child('install', 'Install the service and start it.', (each) => installChild(each, run)),
    )
    .command(child('uninstall', 'Stop the service and remove it.', uninstallChild))
    .command(child('start', 'Start the service.', (each) => control(each, 'start')))
    .command(child('stop', 'Stop the service.', (each) => control(each, 'stop')))
    .command(child('restart', 'Restart the service.', (each) => control(each, 'restart')))
    .command(statusCommand(settings));
}

/**
 * A plugin that installs one of the application's own Commands as a per-user service the platform
 * supervises, a systemd user unit on Linux and a launchd user agent on macOS, and starts, stops,
 * restarts, reports, and removes it. Its whole contribution is the `service` group and the graph
 * check that the run words route to a Command with an action.
 */
function service(settings: ServiceSettings): Plugin {
  const judged = judgeSettings(settings);
  return plugin(identity, {
    commands: [serviceCommand(judged)],
    onGraphBuilt: judgeRun(judged.run),
  });
}

export type {
  ProbeContext,
  ServiceDetail,
  ServiceSettings,
  ServiceState,
  ServiceStatus,
} from './types.js';
export { service };
