import { format } from '@loomcli/plugins/format';
import type { FormatSettings } from '@loomcli/plugins/format';

const plain = format();
const lower = format({ short: 'f' });
const upper = format({ short: 'F' });
const settings: FormatSettings = {};
const empty = format(settings);
// @ts-expect-error TS2322: A short spelling is one ASCII letter.
const word = format({ short: 'fo' });
// @ts-expect-error TS2322: A short spelling carries no hyphen.
const hyphen = format({ short: '-f' });

export { empty, hyphen, lower, plain, upper, word };
