import { Application } from '@loomcli/core';

process.env.LOOM_MiXeD_CASE = 'captured';
const nativeUppercase = process.env.LOOM_MIXED_CASE;
await new Application('environment')
  .action(({ host, out }) => {
    process.env.LOOM_MiXeD_CASE = 'changed';
    out.print(
      JSON.stringify({
        captured: host.env.LOOM_MiXeD_CASE,
        capturedUppercase: host.env.LOOM_MIXED_CASE ?? null,
        nativeUppercase: nativeUppercase ?? null,
      }),
    );
  })
  .run({ host: { argv: [] } });
