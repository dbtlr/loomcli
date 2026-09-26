import { textstat } from '../../dist/src/application.js';

// The built application under a host whose platform the test chooses, so Windows is proven here.
// The files it counts live in the working directory the test supplies.
// The variables come from the test's environment.
const [platform, cwd, ...argv] = process.argv.slice(2);

const code = await textstat.run({ host: { argv, cwd, platform } });
process.stdout.write(`resolved:${code}\n`);
