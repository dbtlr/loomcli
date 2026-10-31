/** The second takeover in the chain, which an earlier takeover must never reach. */
const middleware = ({ graph, out }) => out.print(`version:${graph.version ?? 'none'}`);

export default middleware;
