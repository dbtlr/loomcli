import { Application } from '@loomcli/core';

export const pace = new Application('pace', { description: 'Work out a running pace.' })
  .option('time', { description: 'The time the run took, such as 25:30.', type: 'string' })
  // #region action
  .action(async ({ options, out }) => {
    await out.print(`time: ${options.time ?? 'not given'}`);
  });
// #endregion
