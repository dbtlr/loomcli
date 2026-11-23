import { manifest } from '@loomcli/plugins/manifest';
import type { ManifestSettings } from '@loomcli/plugins/manifest';

const plain = manifest();
const lower = manifest({ short: 'm' });
const upper = manifest({ short: 'M' });
const settings: ManifestSettings = {};
const empty = manifest(settings);
// @ts-expect-error TS2322: A short spelling is one ASCII letter.
const word = manifest({ short: 'manifest' });
// @ts-expect-error TS2322: A short spelling carries no hyphen.
const hyphen = manifest({ short: '-M' });

export { empty, hyphen, lower, plain, upper, word };
