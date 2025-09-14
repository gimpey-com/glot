import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootPkgPath = path.resolve(__dirname, "../package.json");
const distDir = path.resolve(__dirname, "../dist");
const distPkgPath = path.join(distDir, "package.json");

const root = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));

const minimal = {
  name: root.name,
  version: root.version,
  description: root.description,
  author: root.author,
  license: root.license,
  main: "cli.cjs",
  bin: { gglot: "cli.cjs" },
  publishConfig: { access: "public" },
  engines: root.engines,
};

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(distPkgPath, JSON.stringify(minimal, null, 2) + "\n", "utf8");

for (const f of ["README.md", "LICENSE"]) {
  const src = path.resolve(__dirname, "..", f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(distDir, f));
  }
}

console.log("Wrote minimal dist/package.json");
