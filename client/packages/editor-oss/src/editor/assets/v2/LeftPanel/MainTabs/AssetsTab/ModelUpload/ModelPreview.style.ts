
import styled from "styled-components";

import {flexCenter, regularFont} from "../../../../../../../assets/style";

export const Container = styled.div`
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1000;
    width: 264px;
    height: 618px;

    background: var(--theme-grey-bg-tertiary);
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 16px;
    color: var(--theme-font-main-selected-color);

    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    overflow: hidden;

    * {
        box-sizing: border-box;
    }

    @media screen and (max-height: 700px) and (orientation: landscape) {
        height: min(618px, calc(100dvh - 16px));
        width: min(264px, calc(100vw - 16px));
    }
`;

export const CloseBtn = styled.button`
    position: absolute;
    right: 16px;
    top: 8px;
    font-size: 20px;
`;

export const Content = styled.div`
    width: 100%;
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;

    .settings-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
    }

    .footer-fixed {
        flex: 0 0 auto;
        margin-top: auto;
    }
`;

export const ContentWrapper = styled.div`
    width: 100%;
    display: flex;
    align-items: center;
    flex-direction: column;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 8px;
    ${regularFont("s")};
    color: var(--theme-font-unselected-color);
`;

export const BottomBar = styled.div`
    margin-top: auto;
    padding: 0 20px 18px;
    ${flexCenter};
    ${regularFont("s")};
    color: var(--theme-font-input-color);
    text-align: center;
    flex-direction: column;
    gap: 12px;

    p {
        margin: 0;
    }

    @media screen and (max-height: 700px) and (orientation: landscape) {
        padding: 4px 12px 8px;
        gap: 5px;
    }
`;

export const Wrapper = styled.div`
    height: 264px;
    min-height: 264px;
    width: 100%;
    flex: 0 0 264px;
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
    box-sizing: border-box;
    overflow: hidden;
    position: relative;

    canvas {
        border-top-left-radius: 16px;
        border-top-right-radius: 16px;
    }

    @media screen and (max-height: 700px) and (orientation: landscape) {
        height: clamp(100px, 30dvh, 200px);
        min-height: 100px;
        flex: 0 0 clamp(100px, 30dvh, 200px);
    }
`;

export const LoadingOverlay = styled.div`
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    ${flexCenter};
    flex-direction: column;
    gap: 12px;
    z-index: 10;
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
`;

export const LoadingText = styled.div`
    ${regularFont("s")};
    color: var(--theme-font-main-selected-color);
`;
