
import {useCallback, useEffect, useMemo, useState} from "react";

import type {AICapabilities, AIProvider} from "../../../../../../ai";
import {getAIBackend, getBYOKKeyStore} from "../../../../../../ai";
import {
    clearCopilotChatKeyHandoff,
    prepareCopilotChatKeyHandoff,
    refreshCopilotKeysMarker,
} from "../../../../../../copilot";

import {
    ActionsRow,
    Box,
    Heading,
    Hint,
    KeyInput,
    Label,
    PassphraseRow,
    PassphraseSection,
    Row,
    SmallButton,
    SourceText,
    StatusBadge,
    Table,
} from "./BYOKKeysPanel.style";

const PROVIDER_LABELS: Record<AIProvider, string> = {
    anthropic: "Anthropic (Claude)",
    openai: "OpenAI",
    meshy: "Meshy (3D models)",
    elevenlabs: "ElevenLabs (TTS)",
    anythingworld: "Anything World",
    gemini: "Gemini",
    tripo: "Tripo (3D models)",
    rodin: "Rodin / Hyper3D (3D models)",
};

const ORDERED_PROVIDERS: AIProvider[] = [
    "anthropic",
    "openai",
    "meshy",
    "elevenlabs",
    "anythingworld",
    "gemini",
    "tripo",
    "rodin",
];

type BYOKKeysPanelProps = {
    statusMode?: "backend" | "local";
};

const sourceText = (
    source: string,
    localReady: boolean,
    statusMode: BYOKKeysPanelProps["statusMode"],
): string => {
    if (statusMode === "local") {
        return localReady ? "saved in this browser" : "";
    }

    if (source === "env") {
        return "from server environment";
    }

    if (localReady) {
        return "saved in this browser; sent with matching requests";
    }

    if (source === "byok-session") {
        return "saved in an older server session";
    }

    return "";
};

export const BYOKKeysPanel = ({
    statusMode = "backend",
}: BYOKKeysPanelProps) => {
    const backend = useMemo(() => getAIBackend(), []);
    const byokStore = useMemo(() => getBYOKKeyStore(), []);

    const [caps, setCaps] = useState<AICapabilities | undefined>(undefined);
    const [localReady, setLocalReady] = useState<
        Partial<Record<AIProvider, boolean>>
    >({});

    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [busyProvider, setBusyProvider] = useState<AIProvider | undefined>(
        undefined,
    );
    const [error, setError] = useState<string | undefined>(undefined);

    const [hasPassphrase, setHasPassphrase] = useState<boolean | undefined>(
        undefined,
    );
    const [unlocked, setUnlocked] = useState<boolean>(true);
    const [passphraseInput, setPassphraseInput] = useState<string>("");
    const [passphraseAction, setPassphraseAction] = useState<
        "unlock" | "set" | "change" | "none"
    >("none");
    const [passphraseBusy, setPassphraseBusy] = useState<boolean>(false);

    const refresh = useCallback(async () => {
        setError(undefined);

        try {
            const keys = await byokStore?.all();

            setLocalReady(
                Object.fromEntries(
                    ORDERED_PROVIDERS.map(provider => [
                        provider,
                        Boolean(keys?.[provider]?.trim()),
                    ]),
                ) as Partial<Record<AIProvider, boolean>>,
            );
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to read locally stored keys",
            );
        }

        if (statusMode === "local") {
            setCaps(undefined);
            return;
        }

        try {
            const result = await backend.capabilities(true);
            setCaps(result);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load AI server capabilities",
            );
        }
    }, [backend, byokStore, statusMode]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (!byokStore) {
            setHasPassphrase(false);
            return;
        }

        void (async () => {
            const has = await byokStore.hasPassphrase();

            setHasPassphrase(has);
            setUnlocked(has ? byokStore.isUnlocked() : true);

            if (has && !byokStore.isUnlocked()) {
                setPassphraseAction("unlock");
            }
        })();
    }, [byokStore]);

    const handlePassphraseSubmit = useCallback(async () => {
        if (!byokStore) return;

        const value = passphraseInput;

        setPassphraseBusy(true);
        setError(undefined);

        try {
            if (passphraseAction === "unlock") {
                const ok = await byokStore.unlock(value);

                if (!ok) {
                    setError("Incorrect passphrase.");
                    return;
                }

                setUnlocked(true);
                setPassphraseAction("none");
            } else if (
                passphraseAction === "set" ||
                passphraseAction === "change"
            ) {
                await byokStore.setPassphrase(value);

                setHasPassphrase(true);
                setUnlocked(true);
                setPassphraseAction("none");
            }

            setPassphraseInput("");
            await refresh();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Passphrase operation failed",
            );
        } finally {
            setPassphraseBusy(false);
        }
    }, [
        byokStore,
        passphraseAction,
        passphraseInput,
        refresh,
    ]);

    const handlePassphraseLock = useCallback(async () => {
        if (!byokStore) return;

        setPassphraseBusy(true);

        try {
            await prepareCopilotChatKeyHandoff();

            byokStore.lock();
            setUnlocked(false);
            setPassphraseAction("unlock");

            await refreshCopilotKeysMarker();
            await refresh();
        } finally {
            setPassphraseBusy(false);
        }
    }, [byokStore, refresh]);

    const handlePassphraseReset = useCallback(async () => {
        if (!byokStore) return;

        const confirmed = window.confirm(
            "Resetting the passphrase deletes ALL stored BYOK keys. You will need to re-enter them. Continue?",
        );

        if (!confirmed) return;

        setPassphraseBusy(true);

        try {
            await Promise.all(
                ORDERED_PROVIDERS.map(provider =>
                    backend.clearProviderKey(provider),
                ),
            );

            await byokStore.resetPassphrase();

            clearCopilotChatKeyHandoff();

            setHasPassphrase(false);
            setUnlocked(true);
            setPassphraseAction("none");
            setPassphraseInput("");

            await refresh();
            await refreshCopilotKeysMarker();
        } finally {
            setPassphraseBusy(false);
        }
    }, [backend, byokStore, refresh]);

    const handleSave = useCallback(
        async (provider: AIProvider) => {
            const key = drafts[provider]?.trim() ?? "";

            if (!key) return;

            setBusyProvider(provider);
            setError(undefined);

            try {
                const ok = await backend.setProviderKey(provider, key);

                if (!ok) {
                    throw new Error("Could not save the key in this browser");
                }

                clearCopilotChatKeyHandoff();

                setDrafts(prev => ({
                    ...prev,
                    [provider]: "",
                }));

                await refresh();
                await refreshCopilotKeysMarker();
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Failed to save key",
                );
            } finally {
                setBusyProvider(undefined);
            }
        },
        [backend, drafts, refresh],
    );

    const handleClear = useCallback(
        async (provider: AIProvider) => {
            setBusyProvider(provider);
            setError(undefined);

            try {
                await backend.clearProviderKey(provider);

                clearCopilotChatKeyHandoff();

                await refresh();
                await refreshCopilotKeysMarker();
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Failed to clear key",
                );
            } finally {
                setBusyProvider(undefined);
            }
        },
        [backend, refresh],
    );

    const keysTableDisabled =
        byokStore !== undefined &&
        hasPassphrase === true &&
        !unlocked;

    return (
        <Box className="box">
            <Heading>AI Provider Keys</Heading>

            <Hint>
                Bring your own keys for AI features. Your personal keys are
                stored in this browser&apos;s IndexedDB. When an AI request
                uses the corresponding provider, the key is sent to your
                configured remote AI server so that it can contact that
                provider. Keys are not synchronized to another browser.
                If the remote server has a key configured in its environment,
                that server key always takes priority.
                {byokStore ? (
                    <>
                        {" "}
                        For optional encryption at rest, set a passphrase
                        below. Keys will be encrypted with AES-GCM using a
                        PBKDF2-derived key. You will need to unlock them
                        again in a new session.
                    </>
                ) : null}
            </Hint>

            {byokStore ? (
                <PassphraseSection>
                    <Label>
                        <span>Passphrase encryption</span>

                        <StatusBadge
                            $tone={hasPassphrase ? "ready" : "missing"}
                        >
                            {hasPassphrase === undefined
                                ? "…"
                                : hasPassphrase
                                    ? unlocked
                                        ? "unlocked"
                                        : "locked"
                                    : "off"}
                        </StatusBadge>
                    </Label>

                    {passphraseAction !== "none" ? (
                        <PassphraseRow>
                            <KeyInput
                                type="password"
                                placeholder={
                                    passphraseAction === "unlock"
                                        ? "Enter passphrase to unlock"
                                        : passphraseAction === "change"
                                            ? "Enter new passphrase"
                                            : "Choose a passphrase"
                                }
                                value={passphraseInput}
                                disabled={passphraseBusy}
                                onChange={e =>
                                    setPassphraseInput(e.target.value)
                                }
                                onKeyDown={e => {
                                    if (e.key === "Enter") {
                                        void handlePassphraseSubmit();
                                    }
                                }}
                            />

                            <SmallButton
                                type="button"
                                disabled={!passphraseInput || passphraseBusy}
                                onClick={() =>
                                    void handlePassphraseSubmit()
                                }
                            >
                                {passphraseAction === "unlock"
                                    ? "Unlock"
                                    : passphraseAction === "change"
                                        ? "Change"
                                        : "Set"}
                            </SmallButton>

                            {passphraseAction !== "unlock" ? (
                                <SmallButton
                                    type="button"
                                    $variant="ghost"
                                    disabled={passphraseBusy}
                                    onClick={() => {
                                        setPassphraseAction("none");
                                        setPassphraseInput("");
                                    }}
                                >
                                    Cancel
                                </SmallButton>
                            ) : null}
                        </PassphraseRow>
                    ) : (
                        <PassphraseRow>
                            {hasPassphrase ? (
                                <>
                                    <SmallButton
                                        type="button"
                                        onClick={() =>
                                            setPassphraseAction("change")
                                        }
                                    >
                                        Change passphrase
                                    </SmallButton>

                                    {unlocked ? (
                                        <SmallButton
                                            type="button"
                                            $variant="ghost"
                                            disabled={passphraseBusy}
                                            onClick={() =>
                                                void handlePassphraseLock()
                                            }
                                        >
                                            Lock
                                        </SmallButton>
                                    ) : null}

                                    <SmallButton
                                        type="button"
                                        $variant="ghost"
                                        disabled={passphraseBusy}
                                        onClick={() =>
                                            void handlePassphraseReset()
                                        }
                                    >
                                        Reset (wipe keys)
                                    </SmallButton>
                                </>
                            ) : (
                                <SmallButton
                                    type="button"
                                    onClick={() =>
                                        setPassphraseAction("set")
                                    }
                                >
                                    Set passphrase
                                </SmallButton>
                            )}
                        </PassphraseRow>
                    )}
                </PassphraseSection>
            ) : null}

            {error ? (
                <Hint style={{color: "#ff8b8b"}}>{error}</Hint>
            ) : null}

            <Table>
                {ORDERED_PROVIDERS.map(provider => {
                    const status = caps?.providers?.[provider];

                    const isEnvReady =
                        statusMode === "backend" &&
                        status?.source === "env";

                    const isLocalReady = Boolean(localReady[provider]);

                    const isServerReady =
                        statusMode === "backend" &&
                        status?.status === "ready";

                    const isReady =
                        statusMode === "local"
                            ? isLocalReady
                            : isEnvReady || isLocalReady || isServerReady;

                    const source = isEnvReady
                        ? "env"
                        : isLocalReady
                            ? "local"
                            : status?.source ?? "";

                    const draft = drafts[provider] ?? "";
                    const busy = busyProvider === provider;

                    return (
                        <Row key={provider}>
                            <Label>
                                <span>{PROVIDER_LABELS[provider]}</span>

                                <StatusBadge
                                    $tone={isReady ? "ready" : "missing"}
                                >
                                    {isReady ? "ready" : "missing"}
                                </StatusBadge>

                                <SourceText>
                                    {sourceText(
                                        source,
                                        isLocalReady,
                                        statusMode,
                                    )}
                                </SourceText>
                            </Label>

                            <ActionsRow>
                                <KeyInput
                                    type="password"
                                    placeholder={
                                        keysTableDisabled
                                            ? "🔒 unlock above"
                                            : isEnvReady
                                                ? "Configured on server"
                                                : "paste key"
                                    }
                                    value={draft}
                                    disabled={
                                        isEnvReady ||
                                        busy ||
                                        keysTableDisabled
                                    }
                                    onChange={e =>
                                        setDrafts(prev => ({
                                            ...prev,
                                            [provider]: e.target.value,
                                        }))
                                    }
                                />

                                <SmallButton
                                    type="button"
                                    onClick={() =>
                                        void handleSave(provider)
                                    }
                                    disabled={
                                        !draft ||
                                        busy ||
                                        isEnvReady ||
                                        keysTableDisabled
                                    }
                                >
                                    Save
                                </SmallButton>

                                <SmallButton
                                    type="button"
                                    $variant="ghost"
                                    onClick={() =>
                                        void handleClear(provider)
                                    }
                                    disabled={
                                        !isLocalReady ||
                                        isEnvReady ||
                                        busy ||
                                        keysTableDisabled
                                    }
                                >
                                    Clear
                                </SmallButton>
                            </ActionsRow>
                        </Row>
                    );
                })}
            </Table>
        </Box>
    );
};
