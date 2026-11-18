import styled from "styled-components";

import {flexCenter} from "../../../../../assets/style";

/* ── Card container ── */

export const GameCardContainer = styled.div<{$defaultCursor?: boolean}>`
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: stretch;
    color: #e9e9e9;
    font-family: "Lexend", sans-serif;
    cursor: ${({$defaultCursor}) => ($defaultCursor ? "default" : "pointer")};
    transition: transform 0.2s ease, opacity 0.2s ease;

    &:not(:disabled):hover {
        transform: translateY(-1px);
    }
`;

/* ── Title row ── */

export const CardTitleRow = styled.div`
    width: 100%;
    min-height: 31px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    padding: 8px 0;
`;

export const CardTitle = styled.h4`
    margin: 0;
    flex: 1;
    min-width: 0;
    color: #b2b2b9;
    font-size: 16px;
    font-weight: 600;
    line-height: 20px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    span {
        display: inline-block;
        white-space: nowrap;
    }

    @keyframes marquee {
        0% { transform: translateX(0); }
        100% { transform: translateX(calc(-100% - 16px)); }
    }

    &.overflowing:hover span {
        animation: marquee 4s linear infinite;
    }
`;

export const CardVisibilityIcon = styled.img`
    width: 22px;
    height: 22px;
    object-fit: contain;
    flex-shrink: 0;
`;

/* ── Thumbnail ── */

export const CardThumbnail = styled.div<{$bgImage?: string; $prompt?: boolean}>`
    position: relative;
    width: 100%;
    aspect-ratio: 326 / 183;
    border-radius: 8px;
    overflow: hidden;
    background-color: ${({$prompt}) => ($prompt ? "#1e2238" : "#171d33")};
    background-image: ${({$bgImage}) => ($bgImage ? `url('${$bgImage}')` : "none")};
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
`;

/* ── Gradient + title overlay (new minimalist card) ── */

/*
 * CardGradientOverlay
 * Vertical gradient applied over the thumbnail so the white title remains
 * legible on any image. Based on the Figma design (node 18412:356916),
 * with the bottom extended to fully opaque shell-bg at 100% so that when
 * the thumbnail image zooms on hover it can't leak a sub-pixel seam past
 * the overlay into the info section below — the last pixel of the overlay
 * matches the CardInfoSection background, bridging the junction cleanly.
 *
 * The overlay transitions transform in sync with the thumbnail <img>; on
 * card hover DiscoverCardShell scales this overlay to 1.06 (slightly
 * larger than the image's 1.05) so the overlay always fully covers the
 * zoomed image — no edge can poke past it and create the hover flicker.
 *
 * The overlay is extended 10px past the thumbnail's bottom (parent has
 * overflow: hidden, so the extra strip is clipped). The gradient's fully
 * opaque 100% stop moves with it, pushing the near-opaque 92%→100% band
 * physically lower — the pixels at the visible clip line now sit deeper
 * inside the opaque zone, giving more margin against the scaled image's
 * sub-pixel bleed on screens where the 1.06/1.05 scale gap wasn't enough.
 */
export const CardGradientOverlay = styled.div`
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: -10px;
    pointer-events: none;
    transition: transform 0.35s ease;
    transform-origin: center;
    will-change: transform;
    background: linear-gradient(
        180deg,
        rgba(102, 102, 102, 0) 30%,
        rgba(51, 51, 51, 0.55) 65%,
        rgba(0, 0, 0, 0.95) 92%,
        var(--theme-container-main-dark, #141729) 100%
    );
`;

/*
 * CardTitleOverlay
 * Bottom-aligned flex row sitting on top of the thumbnail. Holds the title
 * text and (optionally) the publish-visibility icon.
 */
export const CardTitleOverlay = styled.div`
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 8px;
`;

export const CardOverlayTitle = styled.h4`
    margin: 0;
    flex: 1;
    min-width: 0;
    color: #ffffff;
    font-family: "Lexend", sans-serif;
    font-size: 16px;
    font-weight: 600;
    line-height: 20px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    span {
        display: inline-block;
        white-space: nowrap;
    }

    @keyframes marquee {
        0% { transform: translateX(0); }
        100% { transform: translateX(calc(-100% - 16px)); }
    }

    &.overflowing:hover span {
        animation: marquee 4s linear infinite;
    }
`;

export const CardOverlayVisibilityIcon = styled.img`
    width: 20px;
    height: 20px;
    object-fit: contain;
    flex-shrink: 0;
    filter: brightness(0) invert(1);
    opacity: 0.9;
`;

/* ── Stats footer ── */

export const CardStatsRow = styled.div`
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 8px 0;
    color: #b2b2b9;
    font-size: 14px;
    font-family: "Lexend", sans-serif;
    line-height: 16px;
`;

/* ──────────────────────────────────────────────────────────────────
 * New game-card layout (Discover + Dashboard only)
 *
 * Information architecture:
 *
 *   ┌──────────────────────────────┐ ← DiscoverCardShell (dark bg)
 *   │ ╔═ Thumbnail ═══════════════╗ │
 *   │ ║                           ║ │
 *   │ ║              1 ⎇ · 3926 ▶ ⚑ │ ← stats overlay (bottom-right)
 *   │ ╚═══════════════════════════╝ │
 *   │   Title                     ⓘ │
 *   │   Based on: <source>          │
 *   │   By: <author>                │
 *   │   ┌────────┐   ┌────────────┐ │
 *   │   │ ⎇ FORK 1│   │   ▶  3.9K │ │
 *   │   └────────┘   └────────────┘ │
 *   └──────────────────────────────┘
 *
 * The existing CardStatsRow / CardStat components above are kept for
 * other consumers (MoreGamesByUser, GameCardStats). Only the styled
 * pieces below are used by the redesigned SceneListItem.
 * ──────────────────────────────────────────────────────────────────*/

/*
 * DiscoverCardShell
 * Dark rounded container used as the outer wrapper for Dashboard/Discover
 * cards. `overflow: hidden` clips the thumbnail corners to the shell's
 * radius so thumbnail + info read as one unit (matches the target).
 * Hover lift matches the original GameCardContainer behavior.
 */
export const DiscoverCardShell = styled.div`
    /* --sheen-x / --sheen-y are updated on mouse-move from SceneListItem.
       Defaulting to -200px keeps the sheen off-card until the cursor enters. */
    --sheen-x: -200px;
    --sheen-y: -200px;

    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    background: var(--theme-container-main-dark, #141729);
    border: 1px solid #333;
    border-radius: 12px;
    overflow: hidden;
    color: #e9e9e9;
    font-family: "Lexend", sans-serif;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;

    /* The thumbnail inside gets its own 8px radius by default; zero it out
       so the shell's 12px radius + overflow:hidden drives the visible corner
       curve. Avoids a thin crescent of shell bg showing at the top corners.
       The translateZ(0) + isolation: isolate force the thumbnail onto its
       own compositor layer — without it, transform: scale on the inner <img>
       produces a 1px sub-pixel seam at the bottom edge where the info
       section meets the thumbnail. */
    > :first-child {
        border-radius: 0;
        isolation: isolate;
        transform: translateZ(0);
    }

    /* Cursor-proximity border glow. Only the 2px ring around the card is
       painted; the radial gradient is centered at the cursor so the segment
       of the border closest to the cursor lights up and the rest stays dark.
       The mask-composite: exclude trick XORs a content-box-clipped layer
       with a border-box-clipped layer, leaving just the padding ring
       visible — this keeps the glow off the image (no flicker) while the
       cursor still drives *which part* of the border is highlighted. */
    &::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
        border-radius: inherit;
        padding: 2px;
        background: radial-gradient(
            circle 260px at var(--sheen-x) var(--sheen-y),
            rgba(255, 255, 255, 1),
            rgba(255, 255, 255, 0.55) 25%,
            rgba(255, 255, 255, 0.15) 60%,
            transparent 100%
        );
        /* Two identical mask layers — one clipped to content-box (inside the
           padding ring), one to border-box (the whole element). XOR'ing
           leaves only the 2px ring visible. Firefox uses the standard
           mask-composite: exclude; Safari/older Chromium uses
           -webkit-mask-composite: xor. */
        -webkit-mask:
            linear-gradient(#fff, #fff) content-box,
            linear-gradient(#fff, #fff);
        mask:
            linear-gradient(#fff, #fff) content-box,
            linear-gradient(#fff, #fff);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        opacity: 0;
        transition: opacity 0.2s ease;
    }

    /* Zoom the thumbnail image subtly on hover. The thumbnail wrapper is
       always the first direct child (CompactMedia); ProgressiveImage then
       renders an <img> under a styled wrapper. Target any descendant img
       in the first child so layout refactors inside ProgressiveImage don't
       quietly break the hover. backface-visibility + will-change keep the
       image on a stable GPU layer so scaling doesn't leak a sub-pixel seam
       at the thumbnail's bottom edge. */
    > :first-child img {
        transition: transform 0.35s ease;
        will-change: transform;
        backface-visibility: hidden;
    }

    &:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);

        &::before {
            opacity: 1;
        }

        > :first-child img {
            transform: scale(1.05);
        }

        /* Scale the overlay slightly larger (1.06) than the image (1.05)
           so the overlay always fully covers the zoomed image — this hides
           the sub-pixel seam that used to flicker at the thumbnail's
           bottom edge. */
        ${CardGradientOverlay} {
            transform: scale(1.06);
        }
    }
`;

/*
 * CardThumbStatsOverlay
 * Flat text+icons sitting directly on the thumbnail (no pill background) —
 * legibility comes from the gradient overlay above + a subtle text shadow
 * on the stats themselves. Matches the target wireframe where the stats
 * float on the image instead of being boxed.
 */
export const CardThumbStatsOverlay = styled.div`
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #ffffff;
    font-family: "Lexend", sans-serif;
    font-size: 13px;
    line-height: 14px;
    pointer-events: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
`;

export const CardThumbStat = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 4px;

    img {
        width: 12px;
        height: 12px;
        object-fit: contain;
        filter: brightness(0) invert(1) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6));
    }
`;

export const CardThumbStatDot = styled.span`
    opacity: 0.75;
`;

export const CardThumbFlag = styled.img`
    width: 14px;
    height: 14px;
    object-fit: contain;
    filter: brightness(0) invert(1) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6));
    opacity: 0.95;
`;

export const CardInfoSection = styled.div`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 14px 7px;
`;

/*
 * Bottom-of-thumbnail overlay: holds the title + origin/author + stats
 * stack so the entire meta block sits over the image (under the gradient
 * overlay). Below this, CardInfoSection only renders the action row.
 */
export const CardThumbBottomOverlay = styled.div`
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    pointer-events: none;
    /* Reserve space at right so heart/eye stats and the long title can
       coexist without colliding with the ⋯ button (top-right). */
    padding-right: 12px;
`;

export const CardMetaBlock = styled.div`
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
`;

export const CardMetaText = styled.div`
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
    flex: 1 1 auto;
`;

export const CardMetaOrigin = styled.span`
    color: rgba(255, 255, 255, 0.65);
    font-family: "Lexend", sans-serif;
    font-size: 12px;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
`;

export const CardMetaAuthor = styled.span`
    color: rgba(255, 255, 255, 0.7);
    font-family: "Lexend", sans-serif;
    font-size: 13px;
    line-height: 18px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);

    strong {
        color: #ffffff;
        font-weight: 600;
    }
`;

export const CardMetaStats = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.85);
    font-family: "Lexend", sans-serif;
    font-size: 13px;
    line-height: 18px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
`;

export const CardMetaStatItem = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 4px;

    img {
        width: 14px;
        height: 14px;
        object-fit: contain;
        filter: brightness(0) invert(1) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6));
        opacity: 0.9;
    }
`;

export const CardTitleRowLarge = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
`;

export const CardTitleLarge = styled.h3`
    margin: 0;
    flex: 1;
    min-width: 0;
    color: #ffffff;
    font-family: "Lexend", sans-serif;
    font-size: 20px;
    font-weight: 700;
    line-height: 24px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
`;

/*
 * CardTitleOverlayLarge + CardOverlayTitleLarge
 * Large-title version of the CardTitleOverlay/CardOverlayTitle pair used on
 * the new card layout. Pinned bottom-left of the thumbnail (sibling of
 * CardThumbStatsOverlay which lives bottom-right); the stats overlay is
 * rendered on top so a long title gracefully ellipses before colliding.
 */
export const CardTitleOverlayLarge = styled.div`
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    /* Leave breathing room so the title ellipsis point sits clear of the
       stats overlay at the bottom-right (heart + share counts ≈ 100px). */
    padding-right: 110px;
    pointer-events: none;

    /* The info (ⓘ) button inside needs pointer events even though the
       overlay itself is click-through so the card's global onClick still
       fires when clicking elsewhere on the thumbnail. */
    button {
        pointer-events: auto;
    }
`;

export const CardOverlayTitleLarge = styled.h3`
    margin: 0;
    flex: 1;
    min-width: 0;
    color: #ffffff;
    font-family: "Lexend", sans-serif;
    font-size: 18px;
    font-weight: 700;
    line-height: 22px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
`;

/*
 * CardInfoIconButton
 * Circular ⓘ affordance that surfaces the scene description on hover.
 * Positioned as an absolute corner button on the thumbnail (top-right,
 * 10px inset) — sits on top of the gradient overlay so it's always
 * readable against any thumbnail. Uses an inline SVG so we don't have to
 * wire up a new asset.
 */
export const CardInfoIconButton = styled.button`
    all: unset;
    cursor: pointer;
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    z-index: 2;
    color: #ffffff;
    background: rgba(0, 0, 0, 0.45);
    border-radius: 50%;
    backdrop-filter: blur(4px);
    transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;

    svg {
        width: 14px;
        height: 14px;
        stroke: currentColor;
    }

    &:hover {
        color: #ffffff;
        background: rgba(0, 0, 0, 0.7);
        transform: scale(1.05);
    }
`;

export const CardMetaRow = styled.div`
    color: #8b93a7;
    font-family: "Lexend", sans-serif;
    font-size: 13px;
    line-height: 18px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    strong {
        color: #f4ead8;
        font-weight: 600;
    }
`;

/*
 * CardMetaRowFlex
 * "Based on" variant that hosts a tag strip on the right. The left label
 * can ellipsis if the title is long; the tag strip holds its width and is
 * pushed to the right edge via margin-left: auto.
 */
export const CardMetaRowFlex = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    color: #8b93a7;
    font-family: "Lexend", sans-serif;
    font-size: 13px;
    line-height: 18px;

    strong {
        color: #f4ead8;
        font-weight: 600;
    }
`;

export const CardMetaRowLabel = styled.span`
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
`;

export const CardTagList = styled.span`
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
`;

export const CardTag = styled.span`
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: #b9bdc7;
    font-size: 11px;
    line-height: 14px;
    font-weight: 500;
    white-space: nowrap;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
`;

export const CardActionRow = styled.div`
    display: flex;
    align-items: stretch;
    /* Tighter gap between action buttons; the 2×2=4px reclaimed here is
       redistributed to the outside as extra gutter against the card shell
       (see margin-left/right below). */
    gap: 6px;
    margin-top: 5px;
    /* Extend the row past part of CardInfoSection's 14px horizontal
       padding, leaving a 6px gutter between the card shell and the
       outermost buttons (Edit on the left, Play on the right). */
    margin-left: -8px;
    margin-right: -8px;
`;

const cardActionBase = `
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    font-family: "Lexend", sans-serif;
    font-size: 14px;
    font-weight: 600;
    line-height: 16px;
    cursor: pointer;
    border: none;
    min-width: 0;
    overflow: hidden;
    transition: filter 0.15s ease, background 0.15s ease;

    img {
        width: 16px;
        height: 16px;
        object-fit: contain;
        flex-shrink: 0;
    }

    &:hover {
        filter: brightness(1.15);
    }

    &:disabled {
        cursor: not-allowed;
        opacity: 0.5;
        filter: none;
    }

    &:disabled:hover {
        filter: none;
    }
`;

export const CardActionForkButton = styled.button`
    ${cardActionBase};
    /* Remix sized 25% larger than the baseline — paired with Edit at 0.75,
       Play at 1.0 (total grow = 3, preserving card width). */
    flex: 1.25 1 0;
    background: rgba(255, 255, 255, 0.06);
    color: #b9bdc7;

    img {
        filter: brightness(0) invert(1);
        opacity: 0.75;
    }

    /* Override cardActionBase's brightness filter — brightening a
       translucent 6% white barely shifts the visible color. Swap the
       background tint instead so the hover state is clearly readable. */
    &:hover:not(:disabled) {
        filter: none;
        background: rgba(255, 255, 255, 0.14);
        color: #ffffff;

        img {
            opacity: 1;
        }
    }
`;

/*
 * CardActionEditButton
 * Owner-only edit button. Shares the Fork button's palette (translucent
 * white on dark) so it reads as a secondary action alongside the primary
 * purple Play button.
 */
export const CardActionEditButton = styled.button`
    ${cardActionBase};
    /* Edit is sized 25% smaller than the baseline (and Remix 25% larger) to
       bias emphasis toward Remix as the primary secondary action. Play keeps
       flex-grow: 1 so the three ratios sum to 3, preserving the card width. */
    flex: 0.75 1 0;
    background: rgba(255, 255, 255, 0.06);
    color: #b9bdc7;

    img {
        filter: brightness(0) invert(1);
        opacity: 0.75;
    }

    &:hover:not(:disabled) {
        filter: none;
        background: rgba(255, 255, 255, 0.14);
        color: #ffffff;

        img {
            opacity: 1;
        }
    }
`;

export const CardActionDeleteButton = styled.button`
    ${cardActionBase};

    flex: 0.75 1 0;
    background: rgba(239, 68, 68, 0.12);
    color: #fca5a5;

    svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
    }

    &:hover:not(:disabled) {
        filter: none;
        background: rgba(239, 68, 68, 0.28);
        color: #ffffff;
    }
`;

export const CardActionPlayButton = styled.button`
    ${cardActionBase};
    /* Play gets an extra 20% allocation vs the baseline — makes the
       primary action read as clearly larger than Edit/Remix while leaving
       their existing 0.75 / 1.25 ratio intact. */
    flex: 1.2 1 0;
    background: var(--theme-dialog-button-purple-light, #8b5cf6);
    color: #ffffff;

    /* Override cardActionBase's brightness filter on hover with an explicit
       background swap — brightening an already-light purple washes it out. */
    &:hover {
        filter: none;
        background: var(--theme-dialog-button-purple, #5b21b6);
    }

    img {
        filter: brightness(0) invert(1);
    }
`;

export const CardActionLabel = styled.span`
    text-transform: uppercase;
    letter-spacing: 0.04em;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`;

export const CardActionCount = styled.span`
    font-weight: 700;
    opacity: 0.95;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`;

export const CardStat = styled.div<{$disabled?: boolean; $noHover?: boolean}>`
    ${flexCenter};
    justify-content: flex-start;
    gap: 4px;
    min-width: 0;
    color: #b2b2b9;
    cursor: pointer;
    transition: color 0.2s ease;

    img {
        width: 16px;
        height: 16px;
        object-fit: contain;
        transition: filter 0.2s ease;
    }

    .zero-count {
        width: 9px;
        height: 11px;
    }

    ${({$noHover}) =>
        !$noHover &&
        `
        &:hover {
            color: white;

            img {
                filter: brightness(0) invert(1);
            }
        }
    `}

    ${({$disabled}) =>
        $disabled &&
        `
        opacity: 0.5;
        cursor: default;

        &:hover {
            color: #b2b2b9;

            img {
                filter: none;
            }
        }
    `}
`;
