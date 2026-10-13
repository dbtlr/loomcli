import type { ActionContext, Host, Log } from '@loomcli/core';

/** One row status adds under the unit, from the author's probe. */
export interface ServiceDetail {
  /** The row's name, such as health. */
  readonly name: string;
  /** The row's text, written as the author gives it. */
  readonly value: string;
}

/** What status read from the service manager and the file system. */
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

/** The result status sends: the state, then the probe's rows. */
export interface ServiceStatus extends ServiceState {
  /** The probe's rows, or none. */
  readonly details: readonly ServiceDetail[];
}

/** What the probe receives from status. */
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

/** What the application tells the service plugin. */
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
