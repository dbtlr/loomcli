import { Application, Command } from '@loomcli/core';

new Command('plain').action((context) => {
  // @ts-expect-error TS2339: The Command does not declare passthrough.
  context.passthrough;
});
new Application('plain').action((context) => {
  // @ts-expect-error TS2339: The root does not declare passthrough.
  context.passthrough;
});
const forwarding = new Command('forward').passthrough();
forwarding.action(({ passthrough }) => {
  const words: string[] = passthrough;
  return words;
});
// @ts-expect-error TS2339: The mode is callable once.
forwarding.passthrough();
// @ts-expect-error TS2339: Action closes the mode.
new Command('done').action(() => {}).passthrough();
new Application('pipe')
  .passthrough()
  .stdin({ required: true })
  .action(({ stdin, passthrough }) => {
    const words: string[] = passthrough;
    return [stdin.text(), words];
  });
new Application('pipe')
  .stdin({ required: true })
  .passthrough()
  .action(({ stdin, passthrough }) => {
    const words: string[] = passthrough;
    return [stdin.text(), words];
  });
