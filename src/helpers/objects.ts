export type FlatMap = Map<string, unknown>;

/** @description Checks if a value is a plain object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** @description Flattens a nested object into a map. */
export function flatten(obj: unknown, prefix = ""): FlatMap {
  const out: FlatMap = new Map();
  const stack: Array<{ value: unknown; path: string }> = [
    { value: obj, path: prefix },
  ];

  while (stack.length) {
    const { value, path } = stack.pop()!;
    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        const nextPath = path ? path + "." + k : k;
        stack.push({ value: v, path: nextPath });
      }
    } else {
      out.set(path, value);
    }
  }

  return out;
}

/** @description Sorts the keys of a nested object. */
export function sortDeepKeys<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((x) => sortDeepKeys(x)) as unknown as T;
  }

  if (isPlainObject(input)) {
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(src).sort((a, b) => a.localeCompare(b));
    for (const k of keys) out[k] = sortDeepKeys(src[k]);
    return out as unknown as T;
  }

  return input;
}
