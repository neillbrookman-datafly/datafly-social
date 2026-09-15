// Copies pdf.js's worker into public/ so the browser can load it from our own
// origin (/pdfjs/pdf.worker.min.mjs, see document.carousel.tsx).
//
// Done as a file copy rather than a bundler worker import because the frontend
// builds with Turbopack, and pdf.js's `new URL(..., import.meta.url)` worker
// pattern is bundler-specific. Copying from the installed package on every
// build keeps the worker's version locked to pdfjs-dist's API version — a
// mismatched worker fails at runtime.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('pdfjs-dist/package.json'));
const source = join(pkgDir, 'build', 'pdf.worker.min.mjs');
const targetDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pdfjs');

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, 'pdf.worker.min.mjs'));
console.log(`pdf.js worker copied from pdfjs-dist@${require('pdfjs-dist/package.json').version}`);
