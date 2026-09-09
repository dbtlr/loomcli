import { jsonkit } from '../../dist/src/application.js';

process.stdout.write(`${JSON.stringify(jsonkit.inspect())}\n`);
