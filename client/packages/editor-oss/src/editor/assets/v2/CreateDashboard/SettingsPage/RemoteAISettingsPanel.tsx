
import {useState} from "react";

import {
    DEFAULT_REMOTE_AI_URL,
    getRemoteAIConfig,
    saveRemoteAIConfig,
} from "../../../../../ai/RemoteAIConfig";

import {
    Box,
    Heading,
    Hint,
    KeyInput,
    PassphraseRow,
    SmallButton,
} from "./BYOKKeysPanel/BYOKKeysPanel.style";

export const RemoteAISettingsPanel = () => {
    const initial = getRemoteAIConfig();

    const [url, setUrl] = useState(initial.baseUrl);
    const [token, setToken] = useState(initial.token);
    const [error, setError] = useState("");

    const save = () => {
        const normalized = url.trim().replace(/\/+$/, "");

        if (!/^https:\/\//i.test(normalized)) {
            setError("Please enter a valid HTTPS server URL.");
            return;
        }

        if (!token.trim()) {
            setError("Please enter your server access token.");
            return;
        }

        saveRemoteAIConfig({
            baseUrl: normalized,
            token: token.trim(),
        });

        window.location.reload();
    };

    return (
        <Box className="box">
            <Heading>Remote AI Server</Heading>

            <Hint>
                Connect Stem Studio to your personal remote AI server.
                The URL and access token are stored only in this browser.
                Avoid using this configuration on shared devices.
            </Hint>

            <PassphraseRow>
                <KeyInput
                    type="url"
                    aria-label="AI server URL"
                    placeholder={DEFAULT_REMOTE_AI_URL}
                    value={url}
                    onChange={event => {
                        setUrl(event.target.value);
                        setError("");
                    }}
                    style={{width: "min(100%, 420px)"}}
                />
            </PassphraseRow>

            <PassphraseRow>
                <KeyInput
                    type="password"
                    autoComplete="off"
                    aria-label="AI server access token"
                    placeholder="AI_SERVER_TOKEN"
                    value={token}
                    onChange={event => {
                        setToken(event.target.value);
                        setError("");
                    }}
                    style={{width: "min(100%, 420px)"}}
                />

                <SmallButton
                    type="button"
                    onClick={save}
                    disabled={!url.trim() || !token.trim()}
                >
                    Save and reconnect
                </SmallButton>
            </PassphraseRow>

            {error ? (
                <Hint style={{color: "#ff8b8b"}}>{error}</Hint>
            ) : null}
        </Box>
    );
};
