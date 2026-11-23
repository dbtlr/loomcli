import { fifty } from './fifty.js';

// @ts-expect-error TS2820: A mistyped name at the second level names the leaves its group declares.
const misnamed = fifty.invoke(['group3', 'leaf9'], { args: { target: 'x' } });

export { misnamed };
