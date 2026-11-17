import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {InMemoryBYOKKeyStore} from "./BYOKKeyStore";
import {HttpAIBackend} from "./HttpAIBackend";

const ORIGIN = "http://localhost";

const localBackend = (keyStore?: InMemoryBYOKKeyStore) =>
    new HttpAIBackend({
        ...(keyStore ? {keyStore} : {}),
        resolveUrl: path => `${ORIGIN}${path}`,
    });

describe("HttpAIBackend.capabilities", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn(async () =>
            new Response(JSON.stringify({buildMode: "oss", providers: {}}), {
                status: 200,
                headers: {"content-type": "application/json"},
            }),
        );

        vi.stubGlobal("fetch", fetchSpy);
        vi.stubGlobal("window", {location: {origin: ORIGIN}});
    });

    afterEach(() => vi.unstubAllGlobals());

    it("fetches AI capabilities", async () => {
        const backend = localBackend();
        const result = await backend.capabilities();

        expect(fetchSpy).toHaveBeenCalledWith(
            `${ORIGIN}/api/AI/Capabilities`,
            expect.objectContaining({method: "GET"}),
        );

        expect(result.buildMode).toBe("oss");
    });

    it("memoizes capabilities", async () => {
        const backend = localBackend();

        await backend.capabilities();
        await backend.capabilities();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("refreshes capabilities when requested", async () => {
        const backend = localBackend();

        await backend.capabilities();
        await backend.capabilities(true);

        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
});

describe("HttpAIBackend.setProviderKey", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let keyStore: InMemoryBYOKKeyStore;

    beforeEach(() => {
        fetchSpy = vi.fn(async () => new Response("{}", {status: 200}));

        vi.stubGlobal("fetch", fetchSpy);
        vi.stubGlobal("window", {location: {origin: ORIGIN}});

        keyStore = new InMemoryBYOKKeyStore();
    });

    afterEach(() => vi.unstubAllGlobals());

    it("stores provider keys locally without sending them to the server", async () => {
        const backend = localBackend(keyStore);

        const ok = await backend.setProviderKey("anthropic", "sk-test");

        expect(ok).toBe(true);
        expect(await keyStore.get("anthropic")).toBe("sk-test");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects empty keys", async () => {
        const backend = localBackend(keyStore);

        const ok = await backend.setProviderKey("anthropic", "   ");

        expect(ok).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns false without a key store", async () => {
        const backend = localBackend();

        const ok = await backend.setProviderKey("anthropic", "sk-test");

        expect(ok).toBe(false);
    });

    it("clears a provider key locally without contacting the server", async () => {
        await keyStore.set("anthropic", "sk-test");

        const backend = localBackend(keyStore);
        await backend.clearProviderKey("anthropic");

        expect(await keyStore.get("anthropic")).toBeUndefined();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe("HttpAIBackend BYOK header forwarding", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let keyStore: InMemoryBYOKKeyStore;

    beforeEach(() => {
        fetchSpy = vi.fn(async () =>
            new Response("{}", {
                status: 200,
                headers: {"content-type": "application/json"},
            }),
        );

        vi.stubGlobal("fetch", fetchSpy);
        vi.stubGlobal("window", {location: {origin: ORIGIN}});

        keyStore = new InMemoryBYOKKeyStore();
    });

    afterEach(() => vi.unstubAllGlobals());

    it("attaches the stored provider key to the matching request", async () => {
        await keyStore.set("anthropic", "stored-key");

        const backend = localBackend(keyStore);

        await backend.request("/api/AI/Agent", {
            method: "POST",
            headers: {"X-BYOK-Provider": "anthropic"},
            body: {prompt: "hi"},
        });

        const callArg = fetchSpy.mock.calls[0]![1] as {
            headers: Record<string, string>;
        };

        expect(callArg.headers["X-BYOK-Key"]).toBe("stored-key");
        expect(callArg.headers["X-BYOK-Provider"]).toBe("anthropic");
    });

    it("does not attach a key without a provider hint", async () => {
        await keyStore.set("anthropic", "stored-key");

        const backend = localBackend(keyStore);

        await backend.request("/api/AI/Agent", {
            method: "POST",
            body: {},
        });

        const callArg = fetchSpy.mock.calls[0]![1] as {
            headers: Record<string, string>;
        };

        expect(callArg.headers["X-BYOK-Key"]).toBeUndefined();
    });

    it("does not overwrite an explicit BYOK key", async () => {
        await keyStore.set("anthropic", "stored-key");

        const backend = localBackend(keyStore);

        await backend.request("/api/AI/Agent", {
            method: "POST",
            headers: {
                "X-BYOK-Provider": "anthropic",
                "X-BYOK-Key": "explicit-key",
            },
            body: {},
        });

        const callArg = fetchSpy.mock.calls[0]![1] as {
            headers: Record<string, string>;
        };

        expect(callArg.headers["X-BYOK-Key"]).toBe("explicit-key");
    });
});