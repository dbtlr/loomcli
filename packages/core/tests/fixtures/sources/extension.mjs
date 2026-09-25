import { extension } from '@loomcli/core';
import { z } from 'zod';

/** The fixture source's binding: the key an option reads in the settings the source holds. */
export const configKey = extension('@fixture/config/key', { schema: z.string(), target: 'option' });
