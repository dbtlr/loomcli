import { run } from './manifest-rules-app.mjs';

const result = await run(process.argv.slice(2));
process.stdout.write(result.stdout);
