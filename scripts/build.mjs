import { build } from "esbuild";
import fs from "node:fs";

const pkg = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.cjs",
  platform: "node",
  format: "cjs",
  target: "node18",
  bundle: true,
  minify: true,
  sourcemap: false,
  legalComments: "none",
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __GGLOT_VERSION__: JSON.stringify(pkg.version),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
