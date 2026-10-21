import { text } from '@loomcli/validators';

const patterned = text({ message: 'Expected lowercase letters.', pattern: /^[a-z]+$/u });
// @ts-expect-error TS2345: Only the author can say what the pattern accepts, so message is required.
const withoutMessage = text({ pattern: /^[a-z]+$/u });

export { patterned, withoutMessage };
