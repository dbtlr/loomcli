import { Application, override } from '@loomcli/core';
import { interaction } from '@loomcli/plugins/interaction';
import { progress, progressStyle, text } from '@loomcli/prompts';
import { answeredLine, cancelledLine, progressLine, questionFrame } from '@loomcli/prompts/views';

const app = new Application('prompts', {
  description: 'Resolve a linked prompt from a supplied option.',
  plugins: [interaction(), progressStyle({ spinner: { frames: ['-', '+'], interval: 120 } })],
  views: [
    override(questionFrame, { render: () => 'asking\n' }),
    override(answeredLine, { render: () => 'answered\n' }),
    override(cancelledLine, { render: () => 'cancelled\n' }),
    override(progressLine, { render: ({ label }) => label }),
  ],
})
  .option('port', { description: 'Service port.', required: 'non-interactive', type: 'string' })
  .action(async (context) => {
    const answer = await text(context, { message: 'Service port', option: 'port' });
    // A run that asked writes a progress line; the packed check supplies the port and skips it.
    if (context.supplied.options.port === undefined) {
      await progress(context, { label: 'Saving the port' }).track(Promise.resolve(answer));
    }
    await context.out.print(String(answer));
  });
process.exitCode = await app.run();
