import { dotenv } from '@loomcli/plugins/dotenv';
import type { DotenvSettings } from '@loomcli/plugins/dotenv';

const everything = dotenv();
const allowed = dotenv({ only: ['API_TOKEN'] });
const denied = dotenv({ except: ['PATH'] });
const settings: DotenvSettings = { only: [] };
// @ts-expect-error TS2322: One call gives an allow list or a deny list, not both.
const both = dotenv({ except: ['PATH'], only: ['API_TOKEN'] });

export { allowed, both, denied, everything, settings };
