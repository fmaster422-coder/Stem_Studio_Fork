
export interface RemoteAIConfig {
    baseUrl: string;
    token: string;
}

const STORAGE_KEY = "stemstudio.remote-ai-config";

export const DEFAULT_REMOTE_AI_URL =
    "https://stem-studio-ai.onrender.com";

export function getRemoteAIConfig(): RemoteAIConfig {
    if (typeof localStorage === "undefined") {
        return {baseUrl: DEFAULT_REMOTE_AI_URL, token: ""};
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {baseUrl: DEFAULT_REMOTE_AI_URL, token: ""};
        }

        const parsed = JSON.parse(raw) as Partial<RemoteAIConfig>;

        return {
            baseUrl: (parsed.baseUrl || DEFAULT_REMOTE_AI_URL).replace(/\/+$/, ""),
            token: parsed.token || "",
        };
    } catch {
        return {baseUrl: DEFAULT_REMOTE_AI_URL, token: ""};
    }
}

export function saveRemoteAIConfig(config: RemoteAIConfig): void {
    if (typeof localStorage === "undefined") return;

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
            token: config.token.trim(),
        }),
    );
}
