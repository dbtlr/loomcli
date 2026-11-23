/**
 * The example checks library declarations (`skipLibCheck: false`) without the DOM lib. The Vitest
 * declarations its tests import reach tinybench, whose declarations name this DOM type. Declaring
 * it keeps the library check on, and the example's own code still cannot reach a DOM global.
 */
declare type DOMHighResTimeStamp = number;
