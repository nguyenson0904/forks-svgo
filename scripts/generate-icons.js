#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { optimize } from '../lib/svgo-node.js';
import * as sass from 'sass';

/**
 * Simple CLI argument parser.
 * Supports --key value and --flag forms.
 *
 * @param {string[]} argv
 * @returns {Map<string, string | boolean>}
 */
const parseArgs = (argv) => {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, true);
    }
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));

const resolvePath = (value, fallback) => path.resolve(process.cwd(), value ?? fallback);

const inputDir = resolvePath(args.get('input'), 'input');
const outputDir = resolvePath(args.get('output'), 'output');
const scssFile = resolvePath(args.get('scss'), path.join('output', '_icon.scss'));
const demoHtmlFile = resolvePath(args.get('demo'), path.join('demo', 'icons.html'));
const demoCssFile = resolvePath(args.get('democss'), path.join('demo', 'icons.css'));

const ensureDir = async (target) => fs.mkdir(target, { recursive: true });

/**
 * Minify SVG for inline usage inside data URIs.
 *
 * @param {string} svg
 * @returns {string}
 */
const toInlineSvg = (svg) =>
  svg
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/"/g, "'")
    .trim();

const escapeForScss = (svg) => svg.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const encodeSvgForDataUri = (svg) =>
  encodeURIComponent(svg).replace(/%27/g, "'").replace(/%2F/g, '/');

const main = async () => {
  const entries = await fs.readdir(inputDir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') {
      throw new Error(`Input directory not found: ${inputDir}`);
    }
    throw error;
  });

  const svgEntries = entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'),
  );

  if (svgEntries.length === 0) {
    throw new Error(`No SVG files found in ${inputDir}`);
  }

  svgEntries.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  await ensureDir(outputDir);
  await ensureDir(path.dirname(scssFile));
  await ensureDir(path.dirname(demoCssFile));
  await ensureDir(path.dirname(demoHtmlFile));

  const icons = [];

  for (const entry of svgEntries) {
    const sourcePath = path.join(inputDir, entry.name);
    const targetPath = path.join(outputDir, entry.name);
    const rawSvg = await fs.readFile(sourcePath, 'utf8');

    const result = optimize(rawSvg, {
      path: sourcePath,
      multipass: true,
      plugins: [
        'preset-default',
        {
          name: 'removeViewBox',
          active: true,
        },
      ],
    });

    const optimizedSvg = result.data.trim();
    await fs.writeFile(targetPath, optimizedSvg, 'utf8');

    const name = path.basename(entry.name, path.extname(entry.name));
    const inlineSvg = toInlineSvg(optimizedSvg);
    const encodedSvg = encodeSvgForDataUri(inlineSvg);
    icons.push({
      name,
      svg: inlineSvg,
      encoded: encodedSvg,
      scss: escapeForScss(encodedSvg),
    });
  }

  const iconMapLines = icons
    .map((icon) => `  '${icon.name}': '${icon.scss}',`)
    .join(os.EOL);

  const scssContent = `$icons: (
${iconMapLines}
);

i[class*=svg] {
  display: inline-block;
  width: var(--icon-size, 2.4rem);
  height: var(--icon-size, 2.4rem);
}

@each $icon-name, $icon-svg in $icons {
  .svg-#{$icon-name} {
    background: var(--icon-color, currentColor);
    -webkit-mask: url('data:image/svg+xml,' + #{$icon-svg});
    mask-image: url('data:image/svg+xml,' + #{$icon-svg});
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    background-size: cover;
  }
}
`;

  await fs.writeFile(scssFile, scssContent, 'utf8');

  const sassResult = sass.compileString(scssContent, { style: 'expanded' });
  await fs.writeFile(demoCssFile, sassResult.css, 'utf8');

  const cssHref = path
    .relative(path.dirname(demoHtmlFile), demoCssFile)
    .split(path.sep)
    .join('/');

  const iconCards = icons
    .map(
      (icon) => `        <div class="icon-card">
            <i class="svg-${icon.name}"></i>
            <span>${icon.name}</span>
        </div>`,
    )
    .join(os.EOL);

  const demoHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SVG Icon Demo</title>
    <link rel="stylesheet" href="${cssHref}">
    <style>
      :root {
        --icon-size: 3rem;
      }
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        margin: 0;
        padding: 2rem;
        background-color: #f5f5f5;
        color: #1f2933;
      }
      h1 {
        margin-bottom: 1.5rem;
        font-size: clamp(1.5rem, 2.5vw, 2.25rem);
      }
      .icon-grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      }
      .icon-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 1.25rem;
        border-radius: 0.75rem;
        background-color: #ffffff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
        gap: 0.75rem;
      }
      .icon-card span {
        font-size: 0.9rem;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>SVG Icon Demo</h1>
      <div class="icon-grid">
${iconCards}
      </div>
    </main>
  </body>
</html>
`;

  await fs.writeFile(demoHtmlFile, demoHtml, 'utf8');

  console.log(`Processed ${icons.length} SVG ${icons.length === 1 ? 'icon' : 'icons'}.`);
  console.log(`Optimized files written to: ${outputDir}`);
  console.log(`SCSS map generated at: ${scssFile}`);
  console.log(`Demo page generated at: ${demoHtmlFile}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
