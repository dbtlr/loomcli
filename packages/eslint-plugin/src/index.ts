import { readFileSync } from 'node:fs';

import { discardedDeclaration } from './rules/discarded-declaration.js';
import { hostBypass } from './rules/host-bypass.js';
import { nameShape } from './rules/name-shape.js';
import { strictConfigurationSchema } from './rules/strict-configuration-schema.js';
import { undescribed } from './rules/undescribed.js';

/** The plugin's published name, which is also the specifier both tools load it by. */
const packageName = '@loomcli/eslint-plugin';

/** The namespace ESLint's scoped-plugin convention gives `@loomcli/eslint-plugin`. */
const namespace = '@loomcli';

/** The version the package manifest declares, read once so the plugin never states its own. */
function manifestVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
    const { version } = manifest;
    if (typeof version === 'string') {
      return version;
    }
  }
  throw new TypeError(`${packageName} found no version in its package.json.`);
}

/** Every rule the plugin ships, by the name that follows the namespace in a rule id. */
const rules = {
  'discarded-declaration': discardedDeclaration,
  'host-bypass': hostBypass,
  'name-shape': nameShape,
  'strict-configuration-schema': strictConfigurationSchema,
  undescribed,
};

/** The severity every rule runs at. */
const severity = 'error';

/** Every rule at `error`, under the rule id a tool resolves for this plugin's namespace. */
const enabledRules = Object.fromEntries(
  Object.keys(rules).map((name): [string, typeof severity] => [`${namespace}/${name}`, severity]),
);

const meta = { name: packageName, version: manifestVersion() };

/**
 * The ESLint flat-config object that registers the plugin under `@loomcli` and turns every rule
 * on at `error`. Add it to `eslint.config.js` as it is.
 */
const recommended = { plugins: { [namespace]: { meta, rules } }, rules: enabledRules };

/**
 * The oxlint configuration that loads the plugin and turns every rule on at `error`. It is plain
 * JSON, so an `.oxlintrc.json` can hold it as it is.
 */
const oxlint = { jsPlugins: [packageName], rules: enabledRules };

/** The plugin: its name and version, its rules, and the configurations that turn them on. */
const loomPlugin = { configs: { oxlint, recommended }, meta, rules };

export default loomPlugin;
