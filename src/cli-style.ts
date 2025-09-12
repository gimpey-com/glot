// A drop in, minimal replacement for packages that style the console.
// This package however aims to be minimal with few to zero dependencies,
// reducing the attack surface and keeping the codebase simple and light.

type Code = [open: number, close: number];
const ESC = "\x1b[";

const CODES = {
  bold: [1, 22] as Code,

  red: [31, 39] as Code,
  green: [32, 39] as Code,
  yellow: [33, 39] as Code,
  blue: [34, 39] as Code,
  magenta: [35, 39] as Code,
  cyan: [36, 39] as Code,
  gray: [90, 39] as Code,
};

/** @description Determines if a color should be enabled via env variables. */
function shouldEnableColor(): boolean {
  if (process.env.NO_COLOR != null) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return !!process.stdout && !!process.stdout.isTTY;
}

/** @description Wraps a string in ANSI codes conditionally. */
function wrap([open, close]: Code, enabledRef: () => boolean) {
  return (value: unknown) => {
    const s = String(value);
    if (!enabledRef()) return s;
    return `${ESC}${open}m${s}${ESC}${close}m`;
  };
}

/** @description The interface for the minimal styling package. */
export interface GimpeyStyle {
  enabled: boolean;
  bold: (s: unknown) => string;
  red: (s: unknown) => string;
  green: (s: unknown) => string;
  yellow: (s: unknown) => string;
  cyan: (s: unknown) => string;
  gray: (s: unknown) => string;
  blue: (s: unknown) => string;
  magenta: (s: unknown) => string;
}

let _enabled = shouldEnableColor();
const isEnabled = () => _enabled;

/** @description The minimal styling package. */
const style: GimpeyStyle = {
  get enabled() {
    return _enabled;
  },

  set enabled(v: boolean) {
    _enabled = v;
  },

  bold: wrap(CODES.bold, isEnabled),

  red: wrap(CODES.red, isEnabled),
  green: wrap(CODES.green, isEnabled),
  yellow: wrap(CODES.yellow, isEnabled),
  cyan: wrap(CODES.cyan, isEnabled),
  gray: wrap(CODES.gray, isEnabled),
  blue: wrap(CODES.blue, isEnabled),
  magenta: wrap(CODES.magenta, isEnabled),
};

export default style;
