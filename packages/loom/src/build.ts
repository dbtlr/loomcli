import { readFile } from 'node:fs/promises';

/** What Bun passes the writer for one module it loads: the module's file path. */
interface PacketLoad {
  readonly path: string;
}

/** The part of Bun's plugin builder the writer uses: answering the load of matching modules. */
interface PacketBuilder {
  onLoad(
    constraints: { filter: RegExp },
    callback: (args: PacketLoad) => Promise<{ contents: string; loader: 'json' }>,
  ): unknown;
}

/**
 * The plugin `packet()` returns. It is a Bun plugin by shape, so `Bun.build` accepts it wherever
 * Bun's own plugin type is expected, and an application that type-checks its build script needs
 * no other declarations from this package.
 */
interface PacketPlugin {
  readonly name: string;
  setup(build: PacketBuilder): void;
}

/** Every module whose file name is the packet's, wherever the entry imports it from. */
const packetFile = /(?:^|[\\/])loom\.packet\.json$/u;

/** Whether a parsed JSON value is a plain object, whose members the writer keeps. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The packet a build writes: the source file's own members with `build` set to `distributed`. A
 * byte order mark is dropped, as the runtimes drop it when they import the file. A file that
 * holds no JSON object is left as it is, so the Application rejects it at construction with its
 * own diagnostic.
 */
async function distributedPacket(path: string): Promise<string> {
  const text = await readFile(path, 'utf8');
  const source = text.replace(/^\uFEFF/u, '');
  const members: unknown = JSON.parse(source);
  return isRecord(members) ? JSON.stringify({ ...members, build: 'distributed' }) : source;
}

/**
 * The `Bun.build` plugin that makes a bundle a distributed build. While Bun bundles, it answers the
 * import of every `loom.packet.json` with the file's members and `build` set to `distributed`, and
 * it never writes to the source tree, so the source run keeps reading `development`. A compiled
 * binary built through `Bun.build` with this plugin is distributed too. It answers no other module,
 * so the bundle holds every other module as Bun bundles it.
 */
export function packet(): PacketPlugin {
  return {
    name: '@loomcli/loom/build/packet',
    setup(build) {
      build.onLoad({ filter: packetFile }, async ({ path }) => ({
        contents: await distributedPacket(path),
        loader: 'json',
      }));
    },
  };
}

export type { PacketBuilder, PacketLoad, PacketPlugin };
