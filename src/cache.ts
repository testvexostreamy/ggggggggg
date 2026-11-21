interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  readonly #store = new Map<string, CacheEntry<unknown>>();
  readonly #maxEntries: number;
  readonly #defaultTtlSeconds: number;

  constructor(defaultTtlSeconds = 300, maxEntries = 2048) {
    this.#defaultTtlSeconds = Math.max(0, defaultTtlSeconds);
    this.#maxEntries = Math.max(1, maxEntries);
  }

  get<T>(key: string): T | undefined {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.#store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds = this.#defaultTtlSeconds): void {
    if (ttlSeconds <= 0) return;
    if (this.#store.has(key)) {
      this.#store.delete(key);
    } else if (this.#store.size >= this.#maxEntries) {
      const oldestKey = this.#store.keys().next().value;
      if (oldestKey !== undefined) {
        this.#store.delete(oldestKey);
      }
    }
    this.#store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async wrap<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    if (ttlSeconds <= 0) {
      return await loader();
    }
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }
    const fresh = await loader();
    this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  get size(): number {
    return this.#store.size;
  }

  clear(): void {
    this.#store.clear();
  }
}
