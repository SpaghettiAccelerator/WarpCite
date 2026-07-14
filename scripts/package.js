/**
 * Packages the extension as a VSIX.
 *
 * Dev/tests run against the tsc output (out/, main = out/extension.js) so the
 * verification suite can stub modules via the require cache. The published
 * artifact is an esbuild bundle (dist/) — this script flips `main` to the
 * bundle just for `vsce package` and restores it afterwards.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "package.json");
const original = fs.readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(original);

try {
  execSync(
    "npx esbuild src/extension.ts --bundle --outfile=dist/extension.js " +
      "--external:vscode --external:canvas --format=cjs --platform=node --minify",
    { cwd: root, stdio: "inherit" }
  );

  manifest.main = "./dist/extension.js";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const out = `warpcite-${manifest.version}.vsix`;
  execSync(
    `npx vsce package --no-dependencies --allow-missing-repository -o ${out}`,
    { cwd: root, stdio: "inherit" }
  );
  console.log(`\npackaged: ${out}`);
} finally {
  fs.writeFileSync(manifestPath, original);
}
