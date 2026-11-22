// Bundled into assets/vendor/qa-libs.js (npm run build:vendor). Re-exports third-party libraries only.
import { parse, differenceCiede2000 } from 'culori';
import { distance } from 'fastest-levenshtein';
window.QALibs = { parse, deltaE: differenceCiede2000(), distance };
