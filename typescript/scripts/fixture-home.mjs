/**
 * The home a fixture's process handle states: the `HOME` of the environment the fixture runs with,
 * as it is. A relative one reaches the plugin unresolved, and a missing one is no home.
 * A handle given it never falls back to the user database's home, the developer's own.
 */
export function fixtureHome(env = process.env) {
  return env.HOME ?? '';
}
