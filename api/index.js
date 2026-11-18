// Vercel function: every /api/* request is rewritten here (see vercel.json) with ?__p=<rest>.
import { createHandler } from '../lib/app.js';
import { createStore } from '../lib/store.js';

export default createHandler({ store: createStore() });
