/**
 * The global setup of Loom's own test suite: it snapshots the real home before any test file runs
 * and fails the run at teardown, naming every entry a test added or changed there. A test seals
 * `HOME` and the XDG folders, and passes `home` to every process handle it builds.
 */
import { homedir } from 'node:os';

import { homeChanges, homeSnapshot } from './home-guard.js';

export default function guardHome(): () => void {
  const home = homedir();
  const before = homeSnapshot(home);
  return () => {
    const changed = homeChanges(before, homeSnapshot(home));
    if (changed.length > 0) {
      throw new Error(
        `The test run wrote under the real home. Seal HOME and the XDG folders, and pass home to every process handle a test builds. New or changed: ${changed.join(', ')}`,
      );
    }
  };
}
