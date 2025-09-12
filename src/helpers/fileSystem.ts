import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { info } from "./logging";
import { sortDeepKeys } from "./objects";

/** @description Checks if a path is a directory. */
export function isDirectory(p: string) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** @description Ensures a directory exists. */
export function ensureDirSync(p: string) {
  if (!isDirectory(p)) fs.mkdirSync(p, { recursive: true });
}

/** @description Reads a JSON file. */
export function readJSONSync(p: string): any {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/** @description Writes a JSON file. */
export async function writeJSON(p: string, obj: any, dryRun: boolean) {
  const formatted = JSON.stringify(sortDeepKeys(obj), null, 2) + "\n";
  if (dryRun) {
    info(`[dry-run] Would write ${p}`);
  } else {
    ensureDirSync(path.dirname(p));
    await fsp.writeFile(p, formatted, "utf8");
  }
}
