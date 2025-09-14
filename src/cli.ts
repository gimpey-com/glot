/**
 * @file CLI for Processing i18n Keys and Translations
 * @author Gimpey <gimpey@gimpey.com> (https://gimpey.com)
 * @version 0.0.1 Initial implementation.
 * @license Apache-2.0
 *
 * @usage For a full list of options, run with the `--help` flag.
 * @example ts-node i18n/syncTranslations.ts --help
 * @example ts-node i18n/syncTranslations.ts
 * @example ts-node i18n/syncTranslations.ts --base en --auto
 * @example ts-node i18n/syncTranslations.ts --dry-run
 *
 * @behavior The following is how the CLI behaves:
 * - Compares every locale folder against a base (default 'en').
 * - Reports files/keys missing vs extra, per file.
 * - For missing-in-target keys, we either translate or remove from base.
 * - For extra-in-target keys, we either translate or remove from target.
 * - The `--auto` flag will choose defaults automatically (translate/add).
 */

// Third party packages. Ideally we minimize these dependencies in order to
// keep the CLI simple and light - while also avoiding any potential security
// issues with dependencies.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import inquirer from "inquirer";

import OpenAITranslator, { Translator } from "./adapters/openai";
import { parseOrExit } from "./options";
import style from "./cli-style";
import {
  log,
  warn,
  info,
  ok,
  err,
  flatten,
  isDirectory,
  readJSONSync,
  writeJSON,
} from "./helpers";

declare const __GGLOT_VERSION__: string;

// ! ===========================================================================
// ! CONFIG
// ! ===========================================================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const DEFAULT_MODEL = "gpt-4o-mini";

const CACHE_FILENAME = ".translation-cache.json";

const LOCALE_DIR_RE = /^[A-Za-z]{2}(?:[-_][A-Za-z]{2})?$/;

const VERSION = __GGLOT_VERSION__;

const opts = parseOrExit(
  process.argv.slice(2),
  { version: VERSION },
  {
    base: "en",
    concurrency: "5",
    cache: false,
    model: DEFAULT_MODEL,
  }
);

// ! ===========================================================================
// ! UTILITIES
// ! ===========================================================================

function getAtPath(obj: any, dot: string) {
  const parts = dot.split(".");
  let cur = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function setAtPath(obj: any, dot: string, value: any) {
  const parts = dot.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

function deleteAtPath(obj: any, dot: string) {
  const parts = dot.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cur || typeof cur !== "object") return;
    cur = cur[key];
  }
  if (cur && typeof cur === "object") {
    delete cur[parts[parts.length - 1]];
  }
}

function diffKeys(baseObj: any, targetObj: any) {
  const baseFlat = flatten(baseObj);
  const targetFlat = flatten(targetObj);

  const missingInTarget: string[] = [];
  const extraInTarget: string[] = [];
  const typeMismatches: Array<{
    path: string;
    baseType: string;
    targetType: string;
  }> = [];

  for (const [k, v] of baseFlat) {
    if (!targetFlat.has(k)) {
      missingInTarget.push(k);
    } else {
      const tv = targetFlat.get(k);
      const t1 = Array.isArray(v) ? "array" : typeof v;
      const t2 = Array.isArray(tv) ? "array" : typeof tv;
      if (t1 !== t2) {
        typeMismatches.push({ path: k, baseType: t1, targetType: t2 });
      }
    }
  }

  for (const [k] of targetFlat) {
    if (!baseFlat.has(k)) {
      extraInTarget.push(k);
    }
  }

  return { missingInTarget, extraInTarget, typeMismatches };
}

// ! ===========================================================================
// ! MAIN PROGRAM
// ! ===========================================================================

async function main() {
  const cwd = process.cwd();
  const rawDir = opts.dir
    ? path.resolve(cwd, opts.dir)
    : path.resolve(cwd, "i18n");
  const autoLocalesDir = detectLocalesRoot(rawDir);
  const localesRoot = autoLocalesDir ?? rawDir;

  if (!isDirectory(localesRoot)) {
    err(`Locales root not found: ${localesRoot}`);
    process.exit(1);
  }

  const allCandidates = fs
    .readdirSync(localesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && LOCALE_DIR_RE.test(d.name))
    .map((d) => d.name);

  if (allCandidates.length === 0) {
    err(
      `No locale directories found in ${localesRoot}. (Expected e.g. en, ru, pt-BR)`
    );
    process.exit(1);
  }

  let languages = [...allCandidates].sort((a, b) => a.localeCompare(b));

  if (opts.include) {
    const allow = new Set(
      opts.include
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    );
    languages = languages.filter((l) => allow.has(l));
  }
  if (opts.exclude) {
    const deny = new Set(
      opts.exclude
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    );
    languages = languages.filter((l) => !deny.has(l));
  }

  if (!languages.includes(opts.base)) {
    err(
      `Base language "${
        opts.base
      }" not found under ${localesRoot}. Found: ${languages.join(", ")}`
    );
    process.exit(1);
  }

  info(`Locales root: ${localesRoot}`);
  info(`Base: ${opts.base}`);
  info(`Languages: ${languages.join(", ")}`);

  const openaiKey = opts.openaiKey || OPENAI_API_KEY;

  if (!openaiKey) {
    warn(
      "OpenAI key is not set. Set --openai-key or edit OPENAI_API_KEY in the environment."
    );
    process.exit(1);
  }

  if (
    opts.provider === "openai" &&
    (!openaiKey || openaiKey.startsWith("YOUR_"))
  ) {
    warn(
      "OpenAI key is not set (using placeholder). Set --openai-key or edit HARDCODED_OPENAI_API_KEY."
    );
  }

  const cacheFile = path.join(localesRoot, CACHE_FILENAME);
  const translator: Translator = new OpenAITranslator({
    apiKey: openaiKey,
    model: opts.model,
    enableCache: !!opts.cache,
    cacheFile,
    concurrency: Number(opts.concurrency),
  });

  const others = languages.filter((l) => l !== opts.base);
  ok(
    `We have ${style.bold(others.length)} non-base language(s): ${others.join(
      ", "
    )}`
  );

  for (const lang of others) {
    await syncLanguage({
      localesRoot,
      base: opts.base,
      lang,
      translator,
      dryRun: opts.dryRun,
      auto: opts.auto,
      preferRemove: opts.preferRemove,
      verbose: opts.verbose,
    });
  }

  if (opts.cache) {
    await (translator as OpenAITranslator).flushCache?.();
  }

  ok("Done.");
}

function detectLocalesRoot(rawDir: string): string | null {
  const candidate = path.join(rawDir, "locales");
  if (isDirectory(candidate)) {
    const hasLocales = fs
      .readdirSync(candidate, { withFileTypes: true })
      .some((d) => d.isDirectory() && LOCALE_DIR_RE.test(d.name));
    if (hasLocales) return candidate;
  }

  const hasHere =
    fs.existsSync(rawDir) &&
    fs
      .readdirSync(rawDir, { withFileTypes: true })
      .some((d) => d.isDirectory() && LOCALE_DIR_RE.test(d.name));

  if (hasHere) return rawDir;
  return null;
}

function listJsonFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

type SyncParams = {
  localesRoot: string;
  base: string;
  lang: string;
  translator: Translator;
  dryRun: boolean;
  auto: boolean;
  preferRemove: boolean;
  verbose: boolean;
};

async function syncLanguage(params: SyncParams) {
  const {
    localesRoot,
    base,
    lang,
    translator,
    dryRun,
    auto,
    preferRemove,
    verbose,
  } = params;
  const baseDir = path.join(localesRoot, base);
  const langDir = path.join(localesRoot, lang);

  info(style.bold(`\n→ Comparing ${lang} ↔ ${base}`));

  const baseFiles = new Set(listJsonFiles(baseDir));
  const langFiles = new Set(listJsonFiles(langDir));

  const filesMissingInLang = [...baseFiles].filter((f) => !langFiles.has(f));
  const filesExtraInLang = [...langFiles].filter((f) => !baseFiles.has(f));

  if (filesMissingInLang.length) {
    warn(`${lang}: Missing files: ${filesMissingInLang.join(", ")}`);
  }

  if (filesExtraInLang.length) {
    warn(
      `${lang}: Extra files (not in ${base}): ${filesExtraInLang.join(", ")}`
    );
  }

  if (!filesMissingInLang.length && !filesExtraInLang.length) {
    ok(`File sets match (${lang}).`);
  }

  for (const file of filesMissingInLang) {
    const basePath = path.join(baseDir, file);
    const langPath = path.join(langDir, file);
    const baseObj = readJSONSync(basePath);

    const actionCreate = auto
      ? !preferRemove
      : await promptYesNo(
          `${lang}/${file} missing. Create by translating from ${base}?`,
          true
        );

    if (actionCreate) {
      const translated = await translateWholeFile(
        baseObj,
        base,
        lang,
        translator,
        verbose
      );
      await writeJSON(langPath, translated, dryRun);
      ok(`${lang}/${file} created.`);
    } else {
      const actionRemoveFromBase = auto
        ? preferRemove
        : await promptYesNo(`Remove ${base}/${file} instead?`, false);

      if (actionRemoveFromBase) {
        if (!dryRun) await fsp.rm(path.join(baseDir, file));
        ok(`Removed ${base}/${file}.`);
      } else {
        info(`Skipped ${lang}/${file}.`);
      }
    }
  }

  for (const file of filesExtraInLang) {
    const langPath = path.join(langDir, file);
    const basePath = path.join(baseDir, file);

    const actionAddToBase = auto
      ? !preferRemove
      : await promptYesNo(
          `${lang}/${file} exists but ${base}/${file} does not. Add to base by translating?`,
          true
        );

    if (actionAddToBase) {
      const langObj = readJSONSync(langPath);
      const translated = await translateWholeFile(
        langObj,
        lang,
        base,
        translator,
        verbose
      );
      await writeJSON(basePath, translated, dryRun);
      ok(`Added ${base}/${file}.`);
    } else {
      const actionRemoveFromLang = auto
        ? preferRemove
        : await promptYesNo(`Remove ${lang}/${file}?`, false);
      if (actionRemoveFromLang) {
        if (!dryRun) await fsp.rm(langPath);
        ok(`Removed ${lang}/${file}.`);
      } else {
        info(`Kept ${lang}/${file}.`);
      }
    }
  }

  const commonFiles = [...baseFiles].filter((f) => langFiles.has(f));
  for (const file of commonFiles) {
    const basePath = path.join(baseDir, file);
    const langPath = path.join(langDir, file);
    const baseObj = readJSONSync(basePath);
    const langObj = readJSONSync(langPath);
    const { missingInTarget, extraInTarget, typeMismatches } = diffKeys(
      baseObj,
      langObj
    );

    if (
      missingInTarget.length === 0 &&
      extraInTarget.length === 0 &&
      typeMismatches.length === 0
    ) {
      if (verbose) ok(`${lang}/${file} is in sync.`);
      continue;
    }

    info(style.bold(`\nFile: ${file}`));

    for (const key of missingInTarget) {
      const srcVal = getAtPath(baseObj, key);
      const isString = typeof srcVal === "string";

      log(
        style.yellow(
          `• Missing in ${lang}: ${key}${
            isString ? ` = ${JSON.stringify(srcVal)}` : ""
          }`
        )
      );
      const doTranslate = auto
        ? !preferRemove
        : await promptYesNo(
            `Translate this key into ${lang} (Y) or remove from ${base} (n)?`,
            true
          );

      if (doTranslate) {
        const translated = isString
          ? await translator.translateString(srcVal, base, lang)
          : srcVal;
        setAtPath(langObj, key, translated);
        ok(`Added ${lang}:${key}: ${translated}`);
      } else {
        const removeFromBase = auto
          ? preferRemove
          : await promptYesNo(`Remove ${base}:${key}?`, false);
        if (removeFromBase) {
          deleteAtPath(baseObj, key);
          ok(`Removed ${base}:${key}`);
        } else {
          info(`Skipped ${key}.`);
        }
      }
    }

    for (const key of extraInTarget) {
      const tgtVal = getAtPath(langObj, key);
      const isString = typeof tgtVal === "string";

      log(
        style.yellow(
          `• Extra in ${lang}: ${key}${
            isString ? ` = ${JSON.stringify(tgtVal)}` : ""
          }`
        )
      );
      const addToBase = auto
        ? !preferRemove
        : await promptYesNo(
            `Add to ${base} by translating (Y) or remove from ${lang} (n)?`,
            true
          );

      if (addToBase) {
        const translated = isString
          ? await translator.translateString(tgtVal, lang, base)
          : tgtVal;
        setAtPath(baseObj, key, translated);
        ok(`Added ${base}:${key}`);
      } else {
        const removeFromLang = auto
          ? preferRemove
          : await promptYesNo(`Remove ${lang}:${key}?`, false);
        if (removeFromLang) {
          deleteAtPath(langObj, key);
          ok(`Removed ${lang}:${key}`);
        } else {
          info(`Kept ${lang}:${key}.`);
        }
      }
    }

    for (const tm of typeMismatches) {
      warn(
        `Type mismatch at ${tm.path}: ${base} has ${tm.baseType}, ${lang} has ${tm.targetType}`
      );
      const keepBaseShape = auto
        ? true
        : await promptYesNo(
            `Overwrite ${lang} with ${base}'s shape at ${tm.path}?`,
            true
          );

      if (keepBaseShape) {
        const v = getAtPath(baseObj, tm.path);
        setAtPath(langObj, tm.path, v);
        ok(`Overwrote ${lang}:${tm.path} to match ${base}`);
      } else {
        const overwriteBase = auto
          ? false
          : await promptYesNo(
              `Overwrite ${base} with ${lang}'s shape at ${tm.path}?`,
              false
            );
        if (overwriteBase) {
          const v = getAtPath(langObj, tm.path);
          setAtPath(baseObj, tm.path, v);
          ok(`Overwrote ${base}:${tm.path} to match ${lang}`);
        } else {
          info(`Left mismatch at ${tm.path} unchanged.`);
        }
      }
    }

    await writeJSON(basePath, baseObj, dryRun);
    await writeJSON(langPath, langObj, dryRun);
  }
}

async function promptYesNo(message: string, defaultYes: boolean) {
  const { ans } = await inquirer.prompt<{ ans: boolean }>([
    {
      type: "confirm",
      name: "ans",
      message,
      default: defaultYes,
    },
  ]);

  return ans;
}

async function translateWholeFile(
  obj: any,
  from: string,
  to: string,
  translator: Translator,
  verbose: boolean
) {
  const out = JSON.parse(JSON.stringify(obj));
  const flat = flatten(obj);
  const keys = [...flat.keys()];

  for (const k of keys) {
    const v = flat.get(k);
    if (typeof v === "string") {
      const t = await translator.translateString(v, from, to);
      setAtPath(out, k, t);
      if (verbose) info(`Translated ${k}`);
    } else {
      setAtPath(out, k, v);
    }
  }

  return out;
}

main().catch((e) => {
  err(e?.message || String(e));
  process.exit(1);
});
