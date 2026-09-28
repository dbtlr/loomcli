// A CommonJS module is sloppy mode code.
// This assignment to a getter without a setter is ignored there, where an ES module's would throw.
module.exports = function assignSloppily(failure, value) {
  failure.exitCode = value;
};
