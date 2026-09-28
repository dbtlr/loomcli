// A CommonJS module is sloppy mode code, so this assignment to a getter without a setter is
// Ignored where an ES module's would throw.
module.exports = function assignSloppily(failure, value) {
  failure.exitCode = value;
};
