import type { ActionContext, Host, Log } from '@loomcli/core';

/**
 * One row status adds under the unit, from the author's probe.
 *
 * @public
 */
export interface ServiceDetail {
  /** The row's name, such as health. */
  readonly name: string;
  /** The row's text, written as the author gives it. */
  readonly value: string;
}

/**
 * What status read from the service manager and the file system.
 *
 * @public
 * @sealed
 */
export interface ServiceState {
  /** The settings' label. */
  readonly label: string;
  /** The unit file's path. */
  readonly unit: string;
  /** Whether a file is at the unit's path. */
  readonly installed: boolean;
  /** Whether the manager reports a running process. */
  readonly running: boolean;
  /** The manager's state word, not installed, not loaded, or unknown. */
  readonly state: string;
  /** The running process, when the manager reports one. */
  readonly pid?: number;
  /** Sentences about the user's session and an unreadable state. */
  readonly notes: readonly string[];
}

/**
 * The result status sends: the state, the probe's rows, and any logging destinations.
 *
 * @public
 * @sealed
 */
export interface ServiceStatus extends ServiceState {
  /** The probe's rows, or none. */
  readonly details: readonly ServiceDetail[];
  /** Logging destinations resolved for the status host, absent without the logging plugin. */
  readonly logs?:
    | {
        readonly kind: 'files';
        readonly files: readonly { readonly path: string; readonly exists: boolean }[];
      }
    | { readonly kind: 'manager'; readonly capture: 'journald' | 'none' };
}

/**
 * What the probe receives from status.
 *
 * @public
 * @sealed
 */
export interface ProbeContext {
  /** What status read from the manager. */
  readonly state: ServiceState;
  /** The run's host. */
  readonly host: Host;
  /** The status action's invoke. */
  readonly invoke: ActionContext<unknown>['invoke'];
  /** The run signal. */
  readonly signal: AbortSignal;
  /** The run's log. */
  readonly log: Log;
}

/**
 * What the application tells the service plugin.
 *
 * @public
 */
export interface ServiceSettings {
  /** The unit's reverse-DNS name, such as com.acme.notes. */
  readonly label: string;
  /** The argument words the unit runs the application with, such as ['serve']. */
  readonly run: readonly string[];
  /** Rows status adds under the unit, once the unit is installed. */
  readonly probe?: (
    context: ProbeContext,
  ) => Promise<readonly ServiceDetail[]> | readonly ServiceDetail[];
}
