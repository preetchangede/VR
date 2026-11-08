// node --experimental-strip-types --import ./tools/preview/surface/register.mjs <tool.ts>
import { register } from 'node:module';
register('./ts-hooks.mjs', import.meta.url);
