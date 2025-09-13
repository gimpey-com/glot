import OpenAI from "openai";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { warn, dedupe } from "../helpers";

/** @description Interface for translators. */
export interface Translator {
  translateString(
    text: string,
    fromLang: string,
    toLang: string
  ): Promise<string>;
}

class OpenAITranslator implements Translator {
  private client: OpenAI;
  private model: string;
  private cache: Map<string, string>;
  private cacheFile: string | null;
  private concurrency: number;
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(params: {
    apiKey: string;
    model: string;
    enableCache: boolean;
    cacheFile: string;
    concurrency: number;
  }) {
    this.client = new OpenAI({ apiKey: params.apiKey });
    this.model = params.model;
    this.cache = new Map<string, string>();
    this.cacheFile = params.enableCache ? params.cacheFile : null;
    this.concurrency = Math.max(1, params.concurrency);

    if (this.cacheFile && fs.existsSync(this.cacheFile)) {
      try {
        const raw = fs.readFileSync(this.cacheFile, "utf8");
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries<string>(data)) this.cache.set(k, v);
      } catch {}
    }
  }

  /** @description Generates a key for the cache. */
  private key(text: string, fromLang: string, toLang: string) {
    return `${fromLang}→${toLang}::${text}`;
  }

  /** @description Acquires a lock. */
  private acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++;
      return Promise.resolve();
    }

    return new Promise((resolve) => this.queue.push(resolve));
  }

  /** @description Releases a lock. */
  private release() {
    const next = this.queue.shift();
    if (next) next();
    else this.running--;
  }

  /** @description Translates a string. */
  async translateString(
    text: string,
    fromLang: string,
    toLang: string
  ): Promise<string> {
    if (typeof text !== "string") return String(text);

    const k = this.key(text, fromLang, toLang);
    const cached = this.cache.get(k);
    if (cached) return cached;

    const system = [
      `You are a professional translator.`,
      `Translate from ${fromLang} to ${toLang}.`,
      `Strictly preserve placeholders like {name}, {count}, and ICU MessageFormat segments.`,
      `Do not add explanations. Return only the translated sentence.`,
    ].join(" ");

    await this.acquire();
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      });

      const out = (res.choices?.[0]?.message?.content ?? "").trim();

      const lost = placeholders(text).filter((ph) => !out.includes(ph));
      if (lost.length > 0) {
        warn(
          `Placeholder(s) ${lost.join(
            ", "
          )} missing in translation. Using source text.`
        );
        this.cache.set(k, text);
        return text;
      }

      this.cache.set(k, out);
      return out;
    } finally {
      this.release();
    }
  }

  /** @description Flushes the cache. */
  async flushCache() {
    if (!this.cacheFile) return;

    const obj: Record<string, string> = {};
    for (const [k, v] of this.cache) obj[k] = v;

    await fsp.writeFile(
      this.cacheFile,
      JSON.stringify(obj, null, 2) + "\n",
      "utf8"
    );
  }
}

/**
 * @description Extracts placeholders from a string. The are used with "Rich"
 * components that allow for injected data or dynamic content.
 */
function placeholders(s: string): string[] {
  const re = /\{[^{}]+\}/g;
  return dedupe(s.match(re) ?? []);
}

export default OpenAITranslator;
