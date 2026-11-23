import { z } from 'zod';

const switchPolicy = z.enum(['auto', 'always', 'never']);
const renderingInput = z.object({
  background: z.enum(['auto', 'dark', 'light']).optional(),
  color: switchPolicy.optional(),
  hyperlinks: switchPolicy.optional(),
  modifiers: switchPolicy.optional(),
  terminalControls: z.enum(['strip', 'preserve']).optional(),
});

export { renderingInput };
