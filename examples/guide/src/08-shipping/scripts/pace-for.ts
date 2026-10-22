import { pace } from '../application.js';

/**
 * Runs `pace calc` by name, as a program that embeds pace does, and returns what the run wrote:
 * the pace, or the failure's message.
 */
export async function paceFor(distance: string, time: string): Promise<string> {
  const outcome = await pace.invoke(['calc'], { args: { distance, time } });
  if (outcome.status === 'cancelled') {
    throw new Error('The run was cancelled.');
  }
  return outcome.status === 'completed' ? outcome.output : outcome.form.message;
}
