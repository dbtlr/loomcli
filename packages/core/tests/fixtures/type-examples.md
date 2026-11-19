# Type-check fixture

```ts sketch
const illustration: string = 42;
```

```ts
// src/main.ts
import { count } from './count.js';
import config from './config.json' with { type: 'json' };

const total: number = count + config.initial;

// src/count.ts
export const count = 3;

// src/config.json
{ "initial": 1 }
```

```ts
// src/main.ts
import { title } from './title.js';
console.log(title);

// src/title.ts
export const title: string = 42;
```
