import { packet } from '@loomcli/loom/build';

/**
 * The plugins the packed build script hands `Bun.build`, compiled against the declarations
 * `@loomcli/loom` emits, so a consumer that checks library declarations accepts the writer's type.
 */
export const plugins = [packet()];
