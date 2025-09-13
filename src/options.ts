// This is a drop-in replacement for packages such as `commander` which allows
// a user to pass command line options to a script. The objective is writing
// a minimal parser with no dependencies - reducing the attack surface and
// keeping the codebase simple and light.

export type CLIOptions = {
  dir?: string;
  base: string;
  auto: boolean;
  preferRemove: boolean;
  dryRun: boolean;
  include?: string;
  exclude?: string;
  provider: string;
  openaiKey?: string;
  model: string;
  concurrency: string;
  cache: boolean;
  verbose: boolean;
  help?: boolean;
  version?: boolean;
};

const DEFAULTS: CLIOptions = {
  base: "en",
  auto: false,
  preferRemove: false,
  dryRun: false,
  provider: "openai",
  model: "gpt-4o-mini",
  concurrency: "3",
  cache: true,
  verbose: false,
};

type OptType = "boolean" | "string";
type Spec = {
  long: string;
  short?: string;
  type: OptType;
  desc?: string;
  negatable?: boolean;
  key?: keyof CLIOptions;
};

const SPEC: Spec[] = [
  {
    long: "dir",
    short: "d",
    type: "string",
    desc: "Locales root (auto-detects ./locales if present)",
  },
  { long: "base", short: "b", type: "string", desc: "Base language" },
  {
    long: "auto",
    short: "a",
    type: "boolean",
    desc: "Run non-interactively (choose defaults)",
  },
  {
    long: "prefer-remove",
    type: "boolean",
    desc: "Prefer removals in conflicts",
  },
  { long: "dry-run", type: "boolean", desc: "Report only; do not write files" },
  {
    long: "include",
    type: "string",
    desc: "Comma-separated locales to include (e.g. ru,pt)",
  },
  {
    long: "exclude",
    type: "string",
    desc: "Comma-separated locales to exclude",
  },
  { long: "provider", type: "string", desc: "Translator provider" },
  { long: "openai-key", type: "string", desc: "OpenAI API key override" },
  { long: "model", type: "string", desc: "OpenAI model" },
  { long: "concurrency", type: "string", desc: "Max concurrent translations" },
  {
    long: "cache",
    type: "boolean",
    desc: "Enable translation cache",
    negatable: true,
  },
  { long: "verbose", type: "boolean", desc: "Verbose logging" },
  { long: "help", short: "h", type: "boolean", desc: "Show help" },
  { long: "version", short: "v", type: "boolean", desc: "Show version" },
];

/** @description Converts a kebab-case string to camelCase. */
function toCamel(s: string) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** @description Builds lookups for long and short options. */
function buildLookups(specs: Spec[]) {
  const byLong = new Map<string, Spec>();
  const byShort = new Map<string, Spec>();

  for (const s of specs) {
    byLong.set(s.long, s);
    if (s.short) byShort.set(s.short, s);
  }

  return { byLong, byShort };
}

/** @description Sets an option in the target object. */
function setOpt(target: any, spec: Spec, value: any) {
  const key = (spec.key ?? toCamel(spec.long)) as keyof CLIOptions;
  target[key] = value;
}

/** @description Generates the help text. */
export function getHelp(version?: string, defaults?: Partial<CLIOptions>) {
  const d: CLIOptions = { ...DEFAULTS, ...(defaults ?? {}) } as CLIOptions;
  const lines: string[] = [];

  lines.push(`gglot ${version ? `v${version}` : ""}`.trim());
  lines.push("");
  lines.push("Usage: gglot [options]");
  lines.push("");
  lines.push("Options:");
  for (const s of SPEC) {
    const flags = [
      s.short ? `  -${s.short}` : "    ",
      `--${s.long}${s.type === "string" ? " <value>" : ""}`,
    ].join(", ");
    const key = (s.key ?? toCamel(s.long)) as keyof CLIOptions;
    const defVal = (d as any)[key];
    const defText =
      defVal === undefined
        ? ""
        : s.type === "boolean"
        ? ` (default: ${defVal ? "on" : "off"})`
        : ` (default: ${defVal})`;
    lines.push(`${flags.padEnd(32)} ${s.desc ?? ""}${defText}`);
  }
  lines.push("");
  lines.push("Examples:");
  lines.push("  gglot --base en --auto");
  lines.push("  gglot --dir i18n --include ru,pt --model gpt-4o-mini");
  lines.push("  gglot --no-cache --verbose");

  return lines.join("\n");
}

/** @description Parses the command line options. */
export function parseOptions(
  argv: string[],
  _meta?: { version?: string },
  userDefaults?: Partial<CLIOptions>
): CLIOptions {
  const { byLong, byShort } = buildLookups(SPEC);
  const effectiveDefaults: CLIOptions = {
    ...DEFAULTS,
    ...(userDefaults ?? {}),
  } as CLIOptions;
  const out: CLIOptions = { ...effectiveDefaults };

  const args = [...argv];
  while (args.length > 0) {
    const token = args.shift() as string;

    if (token === "--") break;

    if (token.startsWith("--no-")) {
      const name = token.slice(5);
      const spec = byLong.get(name);
      if (!spec) throw new Error(`Unknown option: ${token}`);
      if (spec.type !== "boolean" || !spec.negatable) {
        throw new Error(`Option --${name} is not negatable`);
      }
      setOpt(out, spec, false);
      continue;
    }

    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      let name = token.slice(2);
      let value: string | undefined;
      if (eq !== -1) {
        name = token.slice(2, eq);
        value = token.slice(eq + 1);
      }
      const spec = byLong.get(name);
      if (!spec) throw new Error(`Unknown option: --${name}`);

      if (spec.type === "boolean") {
        setOpt(out, spec, true);
      } else {
        if (value === undefined) {
          value = args.shift();
          if (value === undefined)
            throw new Error(`Missing value for --${name}`);
        }
        setOpt(out, spec, value);
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const shorts = token.slice(1).split("");
      while (shorts.length) {
        const ch = shorts.shift() as string;
        const spec = byShort.get(ch);
        if (!spec) throw new Error(`Unknown option: -${ch}`);

        if (spec.type === "boolean") {
          setOpt(out, spec, true);
          continue;
        }

        if (shorts.length) {
          const rest = shorts.join("");
          setOpt(out, spec, rest);
          shorts.length = 0;
        } else {
          const value = args.shift();
          if (value === undefined) throw new Error(`Missing value for -${ch}`);
          setOpt(out, spec, value);
        }
      }
      continue;
    }

    throw new Error(`Unexpected argument: ${token}`);
  }

  return out;
}

/** @description Parses and validates the command line options. */
export function parseOrExit(
  argv: string[],
  meta?: { version?: string },
  userDefaults?: Partial<CLIOptions>
): CLIOptions {
  try {
    const opts = parseOptions(argv, meta, userDefaults);

    if ((opts as any).help) {
      console.log(getHelp(meta?.version, userDefaults));
      process.exit(0);
    }

    if ((opts as any).version) {
      console.log(meta?.version ?? "0.0.0");
      process.exit(0);
    }

    return opts;
  } catch (e: any) {
    console.error(e?.message ?? String(e));
    console.log("");
    console.log(getHelp(meta?.version, userDefaults));
    process.exit(1);
  }
}
