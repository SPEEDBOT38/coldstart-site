import { build } from 'esbuild';
await build({ entryPoints: ['scripts/vendor-entry.js'], bundle: true, minify: true, format: 'iife', outfile: 'assets/vendor/qa-libs.js', target: 'es2020' });
console.log('built assets/vendor/qa-libs.js');
