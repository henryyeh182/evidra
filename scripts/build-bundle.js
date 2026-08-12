#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Build the single file the packed `.mcpb` runs.
 *
 * The repository ships as readable modules; the bundle does not. Two things
 * change on the way in:
 *
 *   1. Every module under `apps/` and `packages/` is bundled and minified into
 *      one ESM file, so the archive carries no module tree to read off.
 *   2. `rule-packages/base_rules/rules/session-rules.json` is inlined as a string, so no
 *      file by that name travels inside the bundle at all.
 *
 * What this does NOT claim: minification is not encryption. It raises the cost
 * of reading the source; it does not stop anyone who means to. The rule
 * library's thresholds and citations are returned in `governingRule` on every
 * decision regardless — see `packages/rules/src/library.js`'s `describeRule`.
 */

import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(rootDir, "dist/evidra-server.mjs");

/**
 * Swap the two modules whose behaviour depends on the layout they run in.
 *
 * Both are intercepted by filename rather than by full path: they each have
 * exactly one definition in the tree, and matching the name keeps the plugin
 * readable next to matching an absolute path that changes per checkout.
 */
const layoutShims = {
  name: "evidra-layout-shims",
  setup(pluginBuild) {
    // `rootDir.bundled.js` deliberately does not match this filter, so the
    // replacement does not resolve back into itself.
    pluginBuild.onResolve({ filter: /(^|\/)rootDir\.js$/ }, () => ({
      path: join(rootDir, "scripts/bundle-shims/rootDir.bundled.js")
    }));

    pluginBuild.onResolve({ filter: /(^|\/)librarySource\.js$/ }, () => ({
      path: "evidra:rule-library",
      namespace: "evidra-inline"
    }));

    pluginBuild.onLoad({ filter: /^evidra:rule-library$/, namespace: "evidra-inline" }, () => {
      const json = readFileSync(join(rootDir, "rule-packages/base_rules/rules/session-rules.json"), "utf8");
      // Parsed and re-stringified so a malformed library fails the build here
      // rather than at the installed server's first decision.
      const compact = JSON.stringify(JSON.parse(json));
      return {
        contents: `export const librarySourceJson = ${JSON.stringify(compact)};`,
        loader: "js"
      };
    });

    // The engine parameters travel the same way, and must: they are read with
    // `readFileSync` from a path that does not exist inside the archive, so a
    // bundle built without this inlines nothing and throws at import.
    pluginBuild.onResolve({ filter: /(^|\/)parameterSource\.js$/ }, () => ({
      path: "evidra:engine-parameters",
      namespace: "evidra-inline"
    }));

    pluginBuild.onLoad({ filter: /^evidra:engine-parameters$/, namespace: "evidra-inline" }, () => {
      const json = readFileSync(join(rootDir, "rule-packages/base_rules/rules/engine-parameters.json"), "utf8");
      const compact = JSON.stringify(JSON.parse(json));
      return {
        contents: `export const parameterSourceJson = ${JSON.stringify(compact)};`,
        loader: "js"
      };
    });

    pluginBuild.onResolve({ filter: /(^|\/)releaseManifestSource\.js$/ }, () => ({
      path: "evidra:release-manifest",
      namespace: "evidra-inline"
    }));

    pluginBuild.onLoad({ filter: /^evidra:release-manifest$/, namespace: "evidra-inline" }, () => {
      const manifest = readFileSync(join(rootDir, "release-manifest.json"), "utf8");
      return {
        contents: `export const releaseManifestJson = ${JSON.stringify(manifest)};`,
        loader: "js"
      };
    });

    pluginBuild.onResolve({ filter: /(^|\/)basePackageIdentity\.js$/ }, () => ({
      path: "evidra:base-package-identity",
      namespace: "evidra-inline"
    }));

    pluginBuild.onLoad({ filter: /^evidra:base-package-identity$/, namespace: "evidra-inline" }, () => {
      const manifest = JSON.parse(
        readFileSync(join(rootDir, "rule-packages/base_rules/package.json"), "utf8")
      );
      const identity = {
        packageId: manifest.packageId,
        version: manifest.version,
        contentChecksum: manifest.contentChecksum
      };
      return {
        contents: `export const BASE_RULE_PACKAGE_IDENTITY = Object.freeze(${JSON.stringify(identity)});`,
        loader: "js"
      };
    });
  }
};

rmSync(join(rootDir, "dist"), { recursive: true, force: true });

const result = await build({
  entryPoints: [join(rootDir, "apps/mcp-server/src/stdio.js")],
  outfile,
  bundle: true,
  minify: true,
  format: "esm",
  platform: "node",
  // `engines.node` and the manifest's `compatibility.runtimes.node` both say 20.
  target: "node20",
  legalComments: "none",
  plugins: [layoutShims],
  metafile: true
});

const bytes = result.metafile.outputs[relative(rootDir, outfile)].bytes;
console.log(`built ${relative(rootDir, outfile)} — ${bytes.toLocaleString()} bytes`);
