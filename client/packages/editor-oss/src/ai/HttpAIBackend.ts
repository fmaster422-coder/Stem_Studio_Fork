
import type {AIBackend} from "./AIBackend";
import type {BYOKKeyStore} from "./BYOKKeyStore";
import {getRemoteAIConfig} from "./RemoteAIConfig";
import type {
    AICapabilities,
    AIProvider,
    AIRequestOptions,
    AIResponse,
} from "./types";

const CAPABILITIES_PATH = "/api/AI/Capabilities";
const BYOK_HEADER = "X-BYOK-Key";
const BYOK_PROVIDER_HEADER = "X-BYOK-Provider";

export interface HttpAIBackendOptions {
    keyStore?: BYOKKeyStore;
    resolveUrl?: (path: string) => string;
}

const defaultResolveUrl = (path: string): string => {
    if (/^https?:\/\//i.test(path)) return path;

    const config = getRemoteAIConfig();
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");

    if (baseUrl) {
        return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    }

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
        return this.options.resolveUrl
            ? this.options.resolveUrl(path)
            : defaultResolveUrl(path);
    }

    private authHeaders(
        headers: Record<string, string> = {},
    ): Record<string, string> {
        const token = getRemoteAIConfig().token.trim();

        return token
            ? {...headers, Authorization: `Bearer ${token}`}
            : {...headers};
    }

    async capabilities(forceRefresh = false): Promise<AICapabilities> {
        if (!forceRefresh && this.capabilitiesCache) {
            return this.capabilitiesCache;
        }

        if (this.capabilitiesPromise) {
            return this.capabilitiesPromise;
        }

        this.capabilitiesPromise = (async () => {
            const res = await fetch(this.resolveUrl(CAPABILITIES_PATH), {
                method: "GET",
                headers: this.authHeaders(),
            });

            if (!res.ok) {
                throw new Error(
                    `AI capabilities query failed: ${res.status}`,
                );
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

    async setProviderKey(
        provider: AIProvider,
        key: string,
    ): Promise<boolean> {
        const trimmed = key.trim();

        if (!trimmed || !this.options.keyStore) {
            return false;
        }

        await this.options.keyStore.set(provider, trimmed);
        this.capabilitiesCache = undefined;

        return true;
    }

    async clearProviderKey(provider: AIProvider): Promise<void> {
        await this.options.keyStore?.delete(provider);
        this.capabilitiesCache = undefined;
    }

    private async dispatch(
        path: string,
        options: AIRequestOptions,
    ): Promise<Response> {
        const body = options.body;

        const isStreamingBody =
            body instanceof FormData ||
            (typeof Blob !== "undefined" && body instanceof Blob) ||
            (typeof ReadableStream !== "undefined" &&
                body instanceof ReadableStream) ||
            body instanceof ArrayBuffer ||
            ArrayBuffer.isView(body);

        const isString = typeof body === "string";

        const headers: Record<string, string> = this.authHeaders({
            ...(isStreamingBody
                ? {}
                : {"Content-Type": "application/json"}),
            ...(options.headers ?? {}),
        });

        const targetProvider = headers[
            BYOK_PROVIDER_HEADER
        ] as AIProvider | undefined;

        if (targetProvider && this.options.keyStore) {
            const stored = await this.options.keyStore.get(targetProvider);

            if (stored && !headers[BYOK_HEADER]) {
                headers[BYOK_HEADER] = stored;
            }
        }

        return fetch(this.resolveUrl(path), {
            method:
                options.method ??
                (body !== undefined ? "POST" : "GET"),
            headers,
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
        const contentType = res.headers.get("content-type") ?? "";

        const data = (
            contentType.includes("application/json")
                ? await res.json()
                : await res.text()
        ) as T;

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
