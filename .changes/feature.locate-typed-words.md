- Add `typed` to every position `locate()` reports except `none`: the words the earlier words gave each option and each argument, by declared name, exactly as the parser read them and before any validation, a parent's own option that routing still holds included, and an arity option's words ending with those its unfinished occurrence has received. `TypedInputs` is exported as a type. A reader that completes one input can now narrow by the others.
  ```ts
  const position = locate(graph, ['task', '--project', 'alpha', '']);
  position.kind === 'argument' && position.typed.options.get('project'); // ['alpha']
  ```
