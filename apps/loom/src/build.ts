import { readFile } from 'node:fs/promises';

/** What Bun passes the writer for one module it loads: the module's file path. */
interface PacketLoad {
  readonly path: string;
}

/** The part of Bun's plugin builder the writer uses: answering the load of matching modules. */
interface PacketBuilder {
  onLoad(
    constraints: { filter: RegExp },
    callback: (args: PacketLoad) => Promise<{ contents: string; loader: 'js' | 'json' }>,
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

/** The generated modules of core's Unicode tables, which read their data files at run time. */
const unicodeTables = /[\\/]@rockorager[\\/]uucode[\\/]dist[\\/]src[\\/]generated[\\/][\w-]+\.js$/u;

/** One table module's read of the data file beside it. */
const tableRead =
  /JSON\.parse\(readFileSync\(new URL\("\.\/(?<file>[\w-]+\.json)", import\.meta\.url\), "utf8"\)\)/gu;

/**
 * A table module with each data file it reads beside itself imported as a JSON module instead, so
 * the bundle carries the data. A bundle, and a compiled binary most of all, holds no file beside
 * the module that the original read could find. A table module with no read of that shape fails
 * the build, because a bundle built from it would fail at run time instead.
 */
async function inlinedTables(path: string): Promise<string> {
  const source = await readFile(path, 'utf8');
  const imports: string[] = [];
  // The one capture is the data file's name, which the callback receives after the whole match.
  const contents = source.replaceAll(tableRead, (_read: string, file: string) => {
    const name = `table${String(imports.length)}`;
    imports.push(`import ${name} from './${file}' with { type: 'json' };`);
    return name;
  });
  if (imports.length === 0) {
    throw new Error(
      `packet() found no data file read in the Unicode table module ${path}. Update @loomcli/loom to a version that supports the installed @rockorager/uucode.`,
    );
  }
  return [...imports, contents].join('\n');
}

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
 * binary built through `Bun.build` with this plugin is distributed too. It also carries the data
 * files core's Unicode tables read beside their own modules into the bundle, without which neither
 * a bundle nor a compiled binary can start.
 */
export function packet(): PacketPlugin {
  return {
    name: '@loomcli/loom/build/packet',
    setup(build) {
      build.onLoad({ filter: packetFile }, async ({ path }) => ({
        contents: await distributedPacket(path),
        loader: 'json',
      }));
      build.onLoad({ filter: unicodeTables }, async ({ path }) => ({
        contents: await inlinedTables(path),
        loader: 'js',
      }));
    },
  };
}

export type { PacketBuilder, PacketLoad, PacketPlugin };
