
import { useEffect, useState } from "react";
import { Toaster, toast } from "toastywave";

import { getScene } from "@stem/network/api/scene/v2";
import { useAuthorizationContext } from "../../../context";
import EngineRuntime, { ApplicationMode } from "../../../EngineRuntime";
import global from "../../../global";
import { useRewardReferralTracking } from "../../../hooks/useRewardReferralTracking";
import { PlayerMobileOrientationOverlay } from "@web-shared/player/component/PlayerMobileOrientationOverlay";
import PlayerViewport from "@web-shared/player/component/PlayerViewport";
import { PlayerWatermark } from "@web-shared/player/component/PlayerWatermark";
import { StemStudioLoader } from "../../../ui";
import { AppUpdateManager } from "../../../update/AppUpdateManager";
import { OfflineIndicator } from "../../../update/OfflineIndicator";
import { DiscordController } from "../../../userManagement/playerProfile/game-service-controllers";
import CSPMetaTag, { customCSPPolicies } from "../../../utils/CSPMetaTag";
import {
    DEFAULT_ORIENTATION_POLICY,
    type OrientationPolicy,
} from "../../../utils/orientationPolicy";
import { getSceneLoadErrorDetails } from "../../../utils/SceneLoadErrorUtils";
import { getGameUrl } from "../links";
import { PlayerTopNav } from "./PlayerTopNav";

const getProjectIdFromLocation = () => {
    const splitPath = window.location.pathname.split("/").filter(Boolean);
    return splitPath[0] === "play" ? splitPath[1] : undefined;
};

const getQueryString = (name: string) => {
    const reg = new RegExp("(^|&)" + name + "=([^&]*)(&|$)", "i");
    const r = window.location.search.substr(1).match(reg);
    if (r !== null) {
        return unescape(r[2]!);
    }
    return null;
};

export const Player = () => {
    const projectID = getProjectIdFromLocation() || getQueryString("sceneID") || undefined;

    useRewardReferralTracking(projectID);

    const currentUsername = getQueryString("username");
    const app = global?.app as EngineRuntime | undefined;
    const { isInitializingAuth, dbUser } = useAuthorizationContext();
    const myId = dbUser?.id;

    const [showMask, setShowMask] = useState(true);
    const [isAutoLoadingMask, setIsAutoLoadingMask] = useState(false);
    const [orientationPolicy, setOrientationPolicy] =
        useState<OrientationPolicy>(DEFAULT_ORIENTATION_POLICY);
    const [sceneSummary, setSceneSummary] =
        useState<Awaited<ReturnType<typeof getScene>> | null>(null);

    useEffect(() => {
        // Wait until Firebase has restored the current user before making API calls.
        if (isInitializingAuth) return;

        let cancelled = false;
        let redirectHandle: ReturnType<typeof setTimeout> | null = null;

        const hideLoader = () => {
            if (!cancelled) {
                setShowMask(false);
            }
        };

        async function loadSceneId() {
            try {
                if (cancelled) return;

                if (!app) {
                    toast.error(
                        "The game engine is not initialized. Please reload the page.",
                    );
                    return;
                }

                const splitPath = window.location.pathname.split("/");
                const isSandboxViewer = EngineRuntime.isSandboxViewer();

                let sceneID = isSandboxViewer
                    ? splitPath[splitPath.length - 1]
                    : projectID || getQueryString("sceneID");

                if (DiscordController.isInDiscord()) {
                    try {
                        const discordAppId = location.host.split(".")[0];
                        const mappingResponse = await fetch(
                            `/.proxy/resolveSceneId/${discordAppId}`,
                        );

                        if (!mappingResponse.ok) {
                            throw new Error(
                                `Discord mapping request failed: ${mappingResponse.status}`,
                            );
                        }

                        const mappingData = await mappingResponse.json();
                        console.info(
                            `Discord -> Stem Studio Mapping ${JSON.stringify(mappingData)}`,
                        );
                        sceneID = mappingData["game_id"];
                    } catch (error) {
                        console.error(
                            "Error while loading the project:",
                            error,
                        );
                        toast.error(
                            "Failed to load Discord game mapping. Please try again.",
                        );
                        return;
                    }
                }

                if (!sceneID) {
                    console.error(
                        "Error while loading the project: scene not provided",
                    );
                    toast.error(
                        "No game specified. Please check the URL and try again.",
                    );
                    return;
                }

                let prefetchedScene: Awaited<ReturnType<typeof getScene>>;

                try {
                    prefetchedScene = await getScene(sceneID, {
                        includeDerivatives: true,
                        includeDerivativeDataUrl: true,
                        revision: "published",
                    });

                    if (cancelled) return;

                    setSceneSummary(prefetchedScene);

                    const isPublished = prefetchedScene.isPublished;

                    if (!isPublished) {
                        toast.warning(
                            "This game is private. Only creators and collaborators can view this link — publish the game to share it.",
                        );
                    }

                    if (isPublished) {
                        try {
                            const { getGameMapping } = await import(
                                "@stem/network/api/gameMapping"
                            );
                            const mapping = await getGameMapping(sceneID);

                            if (mapping?.Slug) {
                                const publishedUrl = getGameUrl(
                                    sceneID,
                                    mapping.Slug,
                                );
                                const fullUrl = publishedUrl.startsWith("http")
                                    ? publishedUrl
                                    : `https://${publishedUrl}`;

                                const targetHost = new URL(fullUrl).hostname;

                                if (
                                    targetHost.toLowerCase() !==
                                    window.location.hostname.toLowerCase()
                                ) {
                                    window.location.href = fullUrl;
                                    return;
                                }
                            }
                        } catch (slugError) {
                            console.warn(
                                "Could not resolve published URL for redirect:",
                                slugError,
                            );
                        }
                    }
                } catch (err) {
                    console.error(
                        "Error while loading the project:",
                        err,
                    );

                    const details = getSceneLoadErrorDetails(err);

                    if (details.isNotFound || details.isAccessDenied) {
                        toast.error(
                            "The game could not be found. Redirecting to dashboard...",
                        );

                        redirectHandle = setTimeout(() => {
                            window.location.href = "/dashboard";
                        }, 5000);
                    } else {
                        toast.error(
                            "Failed to load game data. Please check your connection and try again.",
                        );
                    }

                    return;
                }

                if (cancelled) return;

                app.authManager.setUserName(currentUsername || "");
                app.options.isPlayModeOnly = true;

                try {
                    await app.setUpScene(sceneID, { prefetchedScene });

                    if (cancelled) return;

                    if (app.editor) {
                        // Keep sandbox scenes playable without exposing sandbox UI.
                        app.editor.isSandbox = false;
                    }

                    setOrientationPolicy(
                        app.scene?.userData?.game?.orientationPolicy ||
                            DEFAULT_ORIENTATION_POLICY,
                    );

                    await app.setMode(ApplicationMode.PLAY);
                } catch (error) {
                    console.error("Error loading scene:", error);

                    const details = getSceneLoadErrorDetails(error);

                    if (details.isNetwork) {
                        toast.error(
                            "Network error while loading the game. Please check your connection.",
                        );
                    } else if (details.isAccessDenied) {
                        toast.error(
                            "Access denied. You may not have permission to view this game.",
                        );
                    } else if (details.isNotFound) {
                        toast.error(
                            "Game not found. Please check the URL and try again.",
                        );
                    } else {
                        toast.error(
                            "The game could not be started. Please try again.",
                        );
                    }
                }
            } catch (error) {
                console.error(
                    "Unexpected error while loading the game:",
                    error,
                );
                toast.error(
                    "An unexpected error occurred while loading the game.",
                );
            } finally {
                // Always release the loader after success, failure, or early return.
                hideLoader();
            }
        }

        void loadSceneId();

        return () => {
            cancelled = true;

            if (redirectHandle) {
                clearTimeout(redirectHandle);
            }
        };
    }, [app, projectID, isInitializingAuth]);

    const onShowMask = (enabled: boolean, isAuto: boolean = true) => {
        setShowMask(enabled);
        setIsAutoLoadingMask(isAuto);
    };

    useEffect(() => {
        const container = document.getElementById("container");

        if (container) {
            container.style.overflow = "hidden";
        }

        app?.on("showMask.Player", onShowMask);

        return () => {
            if (app) {
                app.options.isPlayModeOnly = false;
                app.on("showMask.Player", null);
            }
        };
    }, []);

    useEffect(() => {
        if (!app?.container) return;

        const handleContextMenu = (event: MouseEvent) => {
            event.preventDefault();
            app?.call("contextmenu", null, event);
        };

        app.container.addEventListener("contextmenu", handleContextMenu);
        document.addEventListener("contextmenu", handleContextMenu);

        return () => {
            app?.container.removeEventListener(
                "contextmenu",
                handleContextMenu,
            );
            document.removeEventListener(
                "contextmenu",
                handleContextMenu,
            );
        };
    }, [app?.container, window.location.pathname]);

    return (
        <>
            <CSPMetaTag customPolicies={customCSPPolicies} />
            <AppUpdateManager />
            <OfflineIndicator />

            <StemStudioLoader
                show={showMask}
                isAutoLoading={isAutoLoadingMask}
            />

            <PlayerMobileOrientationOverlay policy={orientationPolicy} />

            <Toaster
                position="bottom-right"
                theme="dark"
            />

            <PlayerViewport />

            <PlayerTopNav
                scene={sceneSummary}
                viewerId={myId}
            />

            <PlayerWatermark />
        </>
    );
};
