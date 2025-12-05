#!/usr/bin/env node
/**
 * Svelte 5 currently defers DOM getter initialization to `init_operations()`,
 * but nothing calls it in our bundle. This patch executes the initializer
 * eagerly so `first_child_getter`/`next_sibling_getter` are defined at runtime.
 */

const fs = require('fs');
const path = require('path');

const targets = [
  'node_modules/svelte/src/internal/client/dom/template.js',
  'node_modules/svelte/internal/client/dom/template.js',
  'node_modules/svelte/src/internal/client/dom/operations.js',
  'node_modules/svelte/internal/client/dom/operations.js',
];

for (const target of targets) {
  const fullPath = path.resolve(process.cwd(), target);
  if (!fs.existsSync(fullPath)) continue;

  let source = fs.readFileSync(fullPath, 'utf-8');

  // Guard assign_nodes against missing active_effect (legacy build sometimes calls without an active effect)
  if (source.includes('function assign_nodes')) {
    source = source.replace(
      /export function assign_nodes\(start, end\) \{[\s\S]*?if \(effect\.nodes === null\) \{/m,
      'export function assign_nodes(start, end) {\n\tvar effect = active_effect ?? { nodes: null };\n\tif (effect.nodes === null) {'
    );
  }

  // Guard append against anchors without .before (fallback to insertBefore)
  if (source.includes('export function append') && source.includes('anchor.before')) {
    source = source.replace(
      /if \(anchor === null\) \{[\s\S]*?\}/m,
      'if (anchor === null) {\n\t\tconst container = document.getElementById("app") || document.body;\n\t\tcontainer?.append(/** @type {Node} */ (dom));\n\t\treturn;\n\t}'
    );
    source = source.replace(
      /anchor\.before\(\s*\/\*\* @type \{Node\} \*\/\s*\(dom\)\s*\);/m,
      'if (typeof anchor.before === "function") {\n\t\tanchor.before(/** @type {Node} */ (dom));\n\t} else if (anchor.parentNode) {\n\t\tanchor.parentNode.insertBefore(/** @type {Node} */ (dom), anchor);\n\t}'
    );
  }

  // Ensure DOM operations are initialized (for operations.js)
  if (source.includes('init_operations(); // patched') === false && source.includes('init_operations()')) {
    source = `${source}\n\n// Ensure DOM operations are initialized (patched)\ninit_operations(); // patched\n`;
  }

  fs.writeFileSync(fullPath, source, 'utf-8');
  console.log(`Patched ${target}`);
}
