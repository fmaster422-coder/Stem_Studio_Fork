
import type {AIBackend} from "./AIBackend";
import type {BYOKKeyStore} from "./BYOKKeyStore";
import type {AICapabilities, AIProvider, AIRequestOptions, AIResponse} from "./types";

const CAPABILITIES_PATH = "/api/AI/Capabilities";

const BYOK_HEADER = "X-BYOK-Key";
const BYOK_PROVIDER_HEADER = "X-BYOK-Provider";

export interface HttpAIBackendOptions {
    keyStore?: BYOKKeyStore;
    resolveUrl?: (path: string) => string;
}

const defaultResolveUrl = (path: string): string => {
    if (/^https?:\/\//i.test(path)) return path;

    if (typeof window !== "undefined" && window.location?.origin) {
        return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
    }

    return path;
};

export class HttpAIBackend implements AIBackend {
    private capabilitiesCache: AICapabilities | undefined;
    private capabilitiesPromise: Promise<AICapabilities> | undefined;

    constructor(private readonly options: HttpAIBackendOptions = {}) {}

    private resolveUrl(path: string): string {
        if (this.options.resolveUrl) return this.options.resolveUrl(path);
        return defaultResolveUrl(path);
    }

    async capabilities(forceRefresh = false): Promise<AICapabilities> {
        if (!forceRefresh && this.capabilitiesCache) {
            return this.capabilitiesCache;
        }

        if (this.capabilitiesPromise) {
            return this.capabilitiesPromise;
        }

        this.capabilitiesPromise = (async () => {
            const url = this.resolveUrl(CAPABILITIES_PATH);
            const res = await fetch(url, {
                method: "GET",
                credentials: "include",
            });

            if (!res.ok) {
                throw new Error(`AI capabilities query failed: ${res.status}`);
            }

            const parsed = (await res.json()) as AICapabilities;
            this.capabilitiesCache = parsed;
            return parsed;
        })();

        try {
            return await this.capabilitiesPromise;
        } finally {
            this.capabilitiesPromise = undefined;
        }
    }

    async setProviderKey(provider: AIProvider, key: string): Promise<boolean> {
        const trimmed = key.trim();

        if (!trimmed || !this.options.keyStore) {
            return false;
        }

        // Provider keys are stored locally only.
        // They are sent individually through X-BYOK-Key when needed.
        await this.options.keyStore.set(provider, trimmed);

        this.capabilitiesCache = undefined;
        return true;
    }

    async clearProviderKey(provider: AIProvider): Promise<void> {
        // Never clear a shared server-side key.
        await this.options.keyStore?.delete(provider);
        this.capabilitiesCache = undefined;
    }

    private async dispatch(path: string, options: AIRequestOptions): Promise<Response> {
        const url = this.resolveUrl(path);
        const method = options.method ?? (options.body !== undefined ? "POST" : "GET");

        const body = options.body;

        const isStreamingBody =
            body instanceof FormData ||
            (typeof Blob !== "undefined" && body instanceof Blob) ||
            (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) ||
            body instanceof ArrayBuffer ||
            ArrayBuffer.isView(body);

        const isString = typeof body === "string";

        const headers: Record<string, string> = {
            ...(isStreamingBody ? {} : {"Content-Type": "application/json"}),
            ...(options.headers ?? {}),
        };

        const targetProvider = headers[BYOK_PROVIDER_HEADER] as AIProvider | undefined;

        if (targetProvider && this.options.keyStore) {
            const stored = await this.options.keyStore.get(targetProvider);

            if (stored && !headers[BYOK_HEADER]) {
                headers[BYOK_HEADER] = stored;
            }
        }

        return fetch(url, {
            method,
            headers,
            credentials: "include",
            signal: options.signal,
            body:
                body === undefined
                    ? undefined
                    : isStreamingBody || isString
                        ? (body as BodyInit)
                        : JSON.stringify(body),
        });
    }

    async request<T = unknown>(
        path: string,
        options: AIRequestOptions = {},
    ): Promise<AIResponse<T>> {
        const res = await this.dispatch(path, options);

        let data: T;
        const contentType = res.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
            data = (await res.json()) as T;
        } else {
            data = (await res.text()) as unknown as T;
        }

        return {
            ok: res.ok,
            status: res.status,
            data,
        };
    }

    async requestStream(
        path: string,
        options: AIRequestOptions = {},
    ): Promise<Response> {
        return this.dispatch(path, options);
    }
}
