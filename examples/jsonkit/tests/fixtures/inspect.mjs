import { jsonkit } from '../../dist/application.js';

process.stdout.write(`${JSON.stringify(jsonkit.inspect())}\n`);
