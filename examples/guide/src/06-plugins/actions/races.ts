import type { ActionHandler } from '@loomcli/core';

import type { races } from '../commands/races.js';
import { knownRaces } from '../pace.js';

export const listRaces: ActionHandler<typeof races> = ({ out }) => out.results(knownRaces);
