import { Application, override } from '@loomcli/core';
import { interaction } from '@loomcli/plugins/interaction';
import { text } from '@loomcli/prompts';
import { answeredLine, cancelledLine, questionFrame } from '@loomcli/prompts/views';

const app = new Application('prompts', {
  description: 'Resolve a linked prompt from a supplied option.',
  plugins: [interaction()],
  views: [
    override(questionFrame, { render: () => 'asking\n' }),
    override(answeredLine, { render: () => 'answered\n' }),
    override(cancelledLine, { render: () => 'cancelled\n' }),
  ],
})
  .option('port', { description: 'Service port.', required: 'non-interactive', type: 'string' })
  .action(async (context) => {
    const answer = await text(context, { message: 'Service port', option: 'port' });
    await context.out.print(String(answer));
  });
process.exitCode = await app.run();
