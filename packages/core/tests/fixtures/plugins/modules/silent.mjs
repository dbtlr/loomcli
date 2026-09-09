/** A middleware that continues the chain and nothing else, for a build that never reaches it. */
const middleware = ({ next }) => next().then(() => undefined);

export default middleware;
