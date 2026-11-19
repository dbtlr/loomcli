import { Command } from '@loomcli/core';
import type { ActionHandler } from '@loomcli/core';

// An action's `invoke` reads the registered Command paths, so a literal path types its values.
// The Application installs a plugin, so a first name it does not declare reads dynamically.
export const relay = new Command('relay').action(async ({ invoke }) => {
  const typed = await invoke(['get'], {
    args: { path: 'user' },
    options: { file: 'doc.json', identifier: true, level: 'debug', raw: true },
  });
  // @ts-expect-error TS2353: An option the routed Command and the globals do not declare is rejected.
  await invoke(['get'], { options: { flie: 'doc.json' } });
  // @ts-expect-error TS2322: A Boolean option takes a Boolean.
  await invoke(['get'], { options: { raw: 'yes' } });
  // @ts-expect-error TS2345: A Command with no children ends the path.
  await invoke(['get', 'more'], {});
  // @ts-expect-error TS2353: The root's own option is not a child's.
  await invoke(['keys'], { options: { pretty: true } });
  const root = await invoke([], { options: { pretty: true, quiet: true } });
  // A path typed as an array keeps the dynamic values.
  const dynamic: readonly string[] = ['get'];
  const untyped = await invoke(dynamic, { options: { anything: 1 } });
  return [typed, root, untyped];
});

// An extracted handler reads the same registered paths.
export const forward: ActionHandler<typeof relay> = async ({ invoke }) => {
  // @ts-expect-error TS2561: An argument the routed Command does not declare is rejected.
  await invoke(['get'], { args: { pth: 'user' } });
  return invoke(['get'], { args: { path: 'user' } });
};
