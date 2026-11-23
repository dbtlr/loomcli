import { Command } from '@loomcli/core';

// An action's `invoke` reads the registered paths, so a mistyped leaf is rejected at that element.
const probe = new Command('probe').action(async ({ invoke }) => {
  // @ts-expect-error TS2820: A mistyped name at the second level names the leaves its group declares.
  await invoke(['group3', 'leaf9'], { args: { target: 'x' } });
});

export { probe };
