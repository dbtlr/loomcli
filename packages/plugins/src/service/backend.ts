import type { Manager } from './manager.js';
import type { UnitValues } from './unit.js';

/** One run's service: who runs it, its label, where its unit lives, and how its calls run. */
interface Service {
  /** The application's name. */
  readonly name: string;
  readonly label: string;
  /** The process's user id, the one fact the plugin reads from the process. */
  readonly uid: number;
  /** The unit file's path. */
  readonly unit: string;
  readonly manager: Manager;
}

/** What a manager reports about the unit, before status adds the probe's rows. */
interface Reading {
  readonly state: string;
  readonly running: boolean;
  readonly pid?: number;
  readonly notes: readonly string[];
}

/** What one platform's manager does for each child. The plugin exports no such seam. */
interface Backend {
  /** The unit's path under the home directory and the environment. */
  readonly unitPath: (label: string, home: string, env: Manager['env']) => string;
  readonly render: (values: UnitValues) => string;
  /** Loads and starts the unit once its file is in place, `written` when the file changed. */
  readonly install: (service: Service, written: boolean) => Promise<void>;
  /** Stops a recorded unit, and disables it where the manager does, before its file is removed. */
  readonly retire: (service: Service, path: string) => Promise<void>;
  /** What the manager needs once recorded files are removed. */
  readonly afterRemoval: (service: Service) => Promise<void>;
  readonly start: (service: Service) => Promise<void>;
  readonly stop: (service: Service) => Promise<void>;
  readonly restart: (service: Service) => Promise<void>;
  readonly read: (service: Service, installed: boolean) => Promise<Reading>;
}

/** The reading of a state the manager could not report: unknown and not running, its note first. */
function unknownReading(note: string, session: readonly string[]): Reading {
  return { notes: [note, ...session], running: false, state: 'unknown' };
}

export type { Backend, Reading, Service };
export { unknownReading };
