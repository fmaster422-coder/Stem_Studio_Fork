import {HiOutlineTrash} from "react-icons/hi2";

import {
    getProjectStore,
    ensureProjectStoreRehydrated,
} from "@stem/editor-oss/persistence";

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {useState} from "react";
import {useLocation, useNavigate} from "react-router";

import {forkScene} from "@stem/network/api/scene/v2";
import {useAuthorizationContext} from "@stem/editor-oss/context";
import {IS_OSS} from "@stem/editor-oss/mode/buildMode";
import {ROUTES} from "@web-shared/routes";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {getThumbnail} from "@stem/editor-oss/services";
import {showToast} from "@stem/editor-oss/showToast";
import closedEyeIcon from "../../../../../ui/tree/v2/icons/closed-eye.svg";
import openEyeIcon from "../../../../../ui/tree/v2/icons/open-eye.svg";
import {openEditorRoute} from "../../../../../v2/pages/editorHandoff";
import {generateProjectLink, getGameUrl} from "../../../../../v2/pages/links";
import {redirectToLogin} from "@stem/editor-oss/utils/authRedirect";
import {PRODUCT_ANALYTICS_EVENTS, trackProductEvent} from "@stem/editor-oss/utils/productAnalytics";
import {prepareEditCurrentGameCopilotEntry, prepareRemixCopilotEntry} from "../../AiCopilot/copilotWorkspaceEntry";
import editIcon from "../icons/edit.svg";
import {ProgressiveImage} from "../../common/ProgressiveImage/ProgressiveImage";
import newGamePlaceholder from "../../icons/stem-studio-new-project.png";
import gamePlaceholder from "../../icons/stem-studio-project-placeholder.png";
import {FileData} from "../../types/file";
import {
    CardActionCount,
    CardActionDeleteButton,
    CardActionEditButton,
    CardActionForkButton,
    CardActionLabel,
    CardActionPlayButton,
    CardActionRow,
    CardGradientOverlay,
    CardInfoIconButton,
    CardInfoSection,
    CardMetaAuthor,
    CardMetaBlock,
    CardMetaOrigin,
    CardMetaStatItem,
    CardMetaStats,
    CardMetaText,
    CardThumbBottomOverlay,
    CardThumbnail as CompactMedia,
    CardTitleOverlayLarge,
    CardOverlayTitleLarge,
    DiscoverCardShell,
} from "../common/GameCard.style";
import heartOutlineIcon from "../icons/heart-outline.svg";
import playStatIcon from "../icons/play-stat.svg";
import remixStatIcon from "../icons/remix-stat.svg";

type BaseProps = {
    item: FileData;
    showVisibilityState?: boolean;
    /**
     * Tells the card which route it's rendering on. Drives Edit/Remix
     * visibility and a couple of "open in same vs. new tab" decisions.
     * Passed explicitly by the parent (which knows the active route via
     * `activePage`) instead of derived from `useLocation()` here so that
     * React.memo + the initial-render race can't strand the card on a
     * stale pathname (where `!isDashboardRoute` evaluates true and the
     * card briefly shows three action buttons before correcting).
     */
    routeKind?: "dashboard" | "discover" | "other";
};

type NewGameItemProps = BaseProps & {
    isNewGameItem: true;
};

type NormalItemProps = BaseProps & {
    isNewGameItem?: false;
};

type Props = NewGameItemProps | NormalItemProps;

const formatMetricValue = (value?: number) => {
    const safeValue = value ?? 0;
    if (safeValue >= 1_000_000) {
        const compact = Math.round((safeValue / 1_000_000) * 10) / 10;
        return `${compact}M`;
    }
    if (safeValue >= 1000) {
        const compact = Math.round((safeValue / 1000) * 10) / 10;
        return `${compact}K`;
    }
    return `${safeValue}`;
};

export const SceneListItem = React.memo(
    ({item, isNewGameItem, showVisibilityState, routeKind}: Props) => {
        const location = useLocation();
        const navigate = useNavigate();
        const {dbUser, isAuthorized} = useAuthorizationContext();
        const [isForking, setIsForking] = useState(false);
        const [isDeleting, setIsDeleting] = useState(false);
        const isPlayground = isPlaygroundMode();

        // Resolve the route from the explicit prop when supplied (the
        // dashboard + discover grids both pass it), otherwise fall back
        // to location.pathname for legacy callers.
        const resolvedRouteKind: "dashboard" | "discover" | "other" =
            routeKind
            ?? (location.pathname === ROUTES.DASHBOARD
                ? "dashboard"
                : location.pathname === ROUTES.DISCOVER || location.pathname === ROUTES.BROWSE
                    ? "discover"
                    : "other");

        const thumbnail = getThumbnail(item.Thumbnail);
        const visibilityIcon = !item.IsPublished ? null : item.IsPublic ? openEyeIcon : closedEyeIcon;

        const handleCreateNewProject = () => {
            trackProductEvent(PRODUCT_ANALYTICS_EVENTS.CREATE_BLANK_STARTED, {
                source: "new_project_card",
            });
            if (!isAuthorized) {
                redirectToLogin(navigate, ROUTES.DASHBOARD, "new_project_card");
                return;
            }
            openEditorRoute(ROUTES.CREATE_PROJECT, {autoCreate: true});
        };

        const openDetail = () => {
            const returnTo = resolvedRouteKind === "discover" ? ROUTES.BROWSE : ROUTES.DASHBOARD;
            trackProductEvent(PRODUCT_ANALYTICS_EVENTS.GAME_CARD_OPENED, {
                scene_id: item.ID,
                source: resolvedRouteKind,
            });
            void navigate(`/game/${item.ID}`, {state: {returnTo}});
        };

        const onSceneClick = isNewGameItem
            ? handleCreateNewProject
            : IS_OSS && item.ID
              ? () => {
                    // In OSS the viewer owns every scene; tapping a card
                    // should go straight into the editor instead of the
                    // (integrated-only) detail page.
                    openEditorRoute(generateProjectLink(item.ID));
                }
              : () => {
                  console.debug(`[Discover] Opening game: name="${item.Name}", id="${item.ID}"`);
                  openDetail();
              };

        // OSS has no auth and every local project is the user's, so treat
        // every card as owned by the viewer — this is what shows Edit on
        // the card and routes clicks straight into the editor.
        const isOwnedByViewer = IS_OSS || (!!dbUser?.id && item.UserID === dbUser.id);
        // Owners can always remix their own games. Non-owners require an
        // explicit opt-in; missing legacy values are treated as locked.
        const canRemix = isOwnedByViewer || item.IsCloneable === true;

        // Per-route action visibility:
        //   /dashboard → Edit + Play (no Remix; owner's own library)
        //   /discover  → Remix + Play (no Edit; community grid)
        // Any other surface keeps the legacy layout (Edit when owner, Remix,
        // Play) so detail pages and search results are unaffected.
        const isDashboardRoute = resolvedRouteKind === "dashboard";
        const showDeleteButton = IS_OSS && isDashboardRoute && !isNewGameItem;
        const isDiscoverRoute = resolvedRouteKind === "discover";
        const showEditButton = isOwnedByViewer && !isDiscoverRoute;
        // OSS hides Remix everywhere: every project is local and
        // directly editable, so the cloud-only "fork to own copy"
        // affordance doesn't apply.
        const showRemixButton = !IS_OSS && !isDashboardRoute;
        const showEngagementStats = !isPlayground;

        const handleFork = async (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isNewGameItem || isForking || !canRemix) return;
            trackProductEvent(PRODUCT_ANALYTICS_EVENTS.GAME_REMIX_CLICKED, {
                scene_id: item.ID,
                source: resolvedRouteKind,
                owner: isOwnedByViewer,
            });
            if (!isAuthorized) {
                redirectToLogin(navigate, undefined, "game_card_remix");
                return;
            }
            setIsForking(true);
            try {
                const result = await forkScene(item.ID);
                showToast({type: "success", title: "Starting a remix"});
                if (result?.newSceneId) {
                    prepareRemixCopilotEntry({
                        newSceneId: result.newSceneId,
                        sourceScene: item,
                    });
                    openEditorRoute(generateProjectLink(result.newSceneId));
                }
            } catch (error: unknown) {
                console.error("Fork failed:", error);
                showToast({
                    type: "error",
                    title: error instanceof Error ? error.message : "Failed to fork scene.",
                });
            } finally {
                setIsForking(false);
            }
        };

        // Play: open the game in a new tab.
        //   /dashboard → internal /play/:id on the current origin, so the
        //     owner's session cookie is available to the Player route.
        //     Required for launching unpublished drafts — getGameUrl points
        //     at the backend host and loses auth across subdomains.
        //   elsewhere → public published URL via getGameUrl (slug-based when
        //     available, /play/:id fallback).
        const handlePlay = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isNewGameItem || !item.ID) return;
            trackProductEvent(PRODUCT_ANALYTICS_EVENTS.GAME_PLAY_CLICKED, {
                scene_id: item.ID,
                source: resolvedRouteKind,
            });
            if (!isAuthorized) {
                redirectToLogin(navigate, `/play/${item.ID}`, "game_card_play");
                return;
            }
            const target = isDashboardRoute ? `/play/${item.ID}` : getGameUrl(item.ID, null);
            window.open(target, "_blank");
        };

        // Edit (owner only): take the owner directly into the editor for
        // their scene.
        const handleEdit = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isNewGameItem || !item.ID) return;
            if (!isAuthorized) {
                redirectToLogin(navigate, ROUTES.DASHBOARD, "game_card_edit");
                return;
            }
            // OSS opens projects straight into the advanced editor (the
            // Copilot is available as a panel there). The cloud-only
            // "edit via Copilot workspace" entry would otherwise force the
            // simplified workspace layout — wrong for a local project the
            // user explicitly chose to edit.
            if (!IS_OSS) {
                prepareEditCurrentGameCopilotEntry(item);
            }
            openEditorRoute(generateProjectLink(item.ID));
        };

const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!IS_OSS || isNewGameItem || !item.ID || isDeleting) {
        return;
    }

    const confirmed = window.confirm(
        `Are you sure you want to permanently delete "${item.Name}"?`,
    );

    if (!confirmed) return;

    setIsDeleting(true);

    try {
        // Make sure the correct storage backend is active.
        await ensureProjectStoreRehydrated();

        // Delete the project and its associated binary assets.
        await getProjectStore().delete(item.ID);

        showToast({
            type: "success",
            title: "Project deleted successfully.",
        });

        // Refresh the dashboard so the deleted card disappears.
        window.location.reload();
    } catch (error) {
        console.error("[SceneListItem] Project deletion failed:", error);

        showToast({
            type: "error",
            title: error instanceof Error
                ? error.message
                : "Failed to delete project.",
        });

        setIsDeleting(false);
    }
};

        const remixCount = item.RemixCount ?? 0;
        const playCount = item.PlayCount ?? 0;
        const shareCount = item.ShareCount ?? 0;
        const likeCount = item.Likes ?? 0;

        const basedOnName = (item as any).RemixedFromSceneName as string | undefined;
        const basedOnDisplay = item.RemixedFromSceneID ? (basedOnName ?? "Remix") : "Original";

        const authorInline = (item as any).AuthorName as string | undefined;
        const authorDisplay =
            authorInline
            ?? (isOwnedByViewer ? (dbUser?.username || dbUser?.name) : undefined)
            ?? "Creator";

        return (
            <DiscoverCardShell
                onClick={onSceneClick}
                data-testid={isNewGameItem ? "new-game-card" : "game-card"}
                data-scene-id={item.ID}
                onMouseMove={e => {
                    /* Drive the cursor-tracking sheen overlay. Writing CSS
                       custom properties directly on the DOM element is an
                       order of magnitude cheaper than React state here — the
                       component is memoized and the handler fires many times
                       per second on hover. */
                    const el = e.currentTarget;
                    const rect = el.getBoundingClientRect();
                    el.style.setProperty("--sheen-x", `${e.clientX - rect.left}px`);
                    el.style.setProperty("--sheen-y", `${e.clientY - rect.top}px`);
                }}
            >
                <CompactMedia>
                    <ProgressiveImage
                        src={thumbnail || (isNewGameItem ? newGamePlaceholder : gamePlaceholder)}
                        alt={item.Name}
                    />
                    <CardGradientOverlay />

                    {isNewGameItem && (
                        <CardTitleOverlayLarge>
                            <CardOverlayTitleLarge>{item.Name}</CardOverlayTitleLarge>
                        </CardTitleOverlayLarge>
                    )}

                    {!isNewGameItem && (
                        <>
                            <CardThumbBottomOverlay>
                                <CardOverlayTitleLarge>{item.Name}</CardOverlayTitleLarge>
                                <CardMetaBlock>
                                    <CardMetaText>
                                        <CardMetaOrigin>{basedOnDisplay}</CardMetaOrigin>
                                        <CardMetaAuthor>
                                            By: <strong>{authorDisplay}</strong>
                                        </CardMetaAuthor>
                                    </CardMetaText>
                                    {showEngagementStats && (
                                        <CardMetaStats>
                                            <CardMetaStatItem aria-label="likes">
                                                <img src={heartOutlineIcon} alt="" />
                                                <span>{formatMetricValue(likeCount)}</span>
                                            </CardMetaStatItem>
                                            {showVisibilityState && visibilityIcon ? (
                                                <CardMetaStatItem
                                                    aria-label={item.IsPublic ? "public" : "private"}
                                                >
                                                    <img
                                                        src={visibilityIcon}
                                                        alt=""
                                                    />
                                                    <span>{formatMetricValue(shareCount)}</span>
                                                </CardMetaStatItem>
                                            ) : (
                                                <CardMetaStatItem aria-label="views">
                                                    <img src={openEyeIcon} alt="" />
                                                    <span>{formatMetricValue(shareCount)}</span>
                                                </CardMetaStatItem>
                                            )}
                                        </CardMetaStats>
                                    )}
                                </CardMetaBlock>
                            </CardThumbBottomOverlay>
                            {/* The "More options" button opens the /game/:id
                                detail page (GameOverview). That page is
                                integrated-only: it relies on the hosted
                                publish workflow and shows "This game is not
                                published" for local OSS scenes. OSS already
                                routes card clicks straight into the editor, so
                                hide the button entirely here. */}
                            {!IS_OSS && (
                                <CardInfoIconButton
                                    title={item.Description || item.Name}
                                    aria-label={`More options for ${item.Name}`}
                                    onClick={e => {
                                        e.stopPropagation();
                                        openDetail();
                                    }}
                                >
                                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <circle cx="6" cy="12" r="1.6" />
                                        <circle cx="12" cy="12" r="1.6" />
                                        <circle cx="18" cy="12" r="1.6" />
                                    </svg>
                                </CardInfoIconButton>
                            )}
                        </>
                    )}
                </CompactMedia>

                {!isNewGameItem && (
                    <CardInfoSection>
                        <CardActionRow>
                            {showEditButton && (
                                <CardActionEditButton
                                    onClick={handleEdit}
                                    aria-label="Edit this game"
                                    data-testid="game-card-edit"
                                >
                                    <img src={editIcon} alt="" />
                                    <CardActionLabel>Edit</CardActionLabel>
                                </CardActionEditButton>
                            )}


{showDeleteButton && (
    <CardActionDeleteButton
        onClick={handleDelete}
        disabled={isDeleting}
        aria-label={`Delete ${item.Name}`}
        title="Delete project"
        data-testid="game-card-delete"
    >
        <HiOutlineTrash aria-hidden="true" />
        <CardActionLabel>
            {isDeleting ? "…" : "Delete"}
        </CardActionLabel>
    </CardActionDeleteButton>
)}
                            {showRemixButton && (
                                <CardActionForkButton
                                    onClick={handleFork}
                                    disabled={!canRemix || isForking}
                                    title={!canRemix ? "This game cannot be remixed" : undefined}
                                    aria-label={isOwnedByViewer ? "Duplicate this game" : "Remix this game"}
                                    data-testid="game-card-remix"
                                >
                                    <img src={remixStatIcon} alt="" />
                                    <CardActionLabel>{isForking ? "…" : "Remix"}</CardActionLabel>
                                    <CardActionCount>{formatMetricValue(remixCount)}</CardActionCount>
                                </CardActionForkButton>
                            )}
                            <CardActionPlayButton
                                onClick={handlePlay}
                                aria-label="Play this game"
                                data-testid="game-card-play"
                            >
                                <img src={playStatIcon} alt="" />
                                <CardActionLabel>Play</CardActionLabel>
                                <CardActionCount>{formatMetricValue(playCount)}</CardActionCount>
                            </CardActionPlayButton>
                        </CardActionRow>
                    </CardInfoSection>
                )}

            </DiscoverCardShell>
        );
    },
    (prevProps, nextProps) => {
        return (
            prevProps.routeKind === nextProps.routeKind &&
            prevProps.item.ID === nextProps.item.ID &&
            prevProps.item.Name === nextProps.item.Name &&
            prevProps.item.IsPublic === nextProps.item.IsPublic &&
            prevProps.item.IsCloneable === nextProps.item.IsCloneable &&
            prevProps.item.IsPublished === nextProps.item.IsPublished &&
            prevProps.item.UpdateTime === nextProps.item.UpdateTime &&
            prevProps.item.Thumbnail === nextProps.item.Thumbnail &&
            prevProps.item.Likes === nextProps.item.Likes &&
            prevProps.item.ShareCount === nextProps.item.ShareCount &&
            prevProps.item.PlayCount === nextProps.item.PlayCount &&
            prevProps.item.RemixCount === nextProps.item.RemixCount
        );
    },
);

SceneListItem.displayName = "SceneListItem";
