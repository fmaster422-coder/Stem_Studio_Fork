import React from "react";
import {createRoot} from "react-dom/client";
import * as THREE from "three";

import {GradientSpinner} from "./GradientSpinner.tsx";
import PlayerComponent from "./PlayerComponent";

class PlayerLoadMask extends PlayerComponent {
    constructor(app) {
        super(app);
        this.container = null;
        this.status = null;
    }

    show() {
        if (!this.container) {
            // load mask
            this.container = document.createElement("div");
            Object.assign(this.container.style, {
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: "rgba(0, 0, 0)",
                zIndex: 10000,
            });

            const loader = React.createElement(GradientSpinner, {
                height: 80,
                width: 80,
                color: "#ffffff",
                ariaLabel: "loading",
                secondaryColor: "#f3f3f3",
                strokeWidth: 2,
                strokeWidthSecondary: 2,
            });
            const root = createRoot(this.container);
            root.render(loader);

            this.app.container.appendChild(this.container);

            // load status
            this.status = document.createElement("div");
            Object.assign(this.status.style, {
                position: "absolute",
                left: 0,
                bottom: 0,
                fontSize: "12px",
                color: "white",
            });
            this.app.container.appendChild(this.status);

            THREE.DefaultLoadingManager.onProgress = url => {
                url = url.replaceAll(this.app.options.server, "");
                this.status.innerHTML = "Loading " + url;
            };
        }
        this.container.style.display = "flex";
        this.status.innerHTML = "";
        this.status.style.display = "inline-block";
    }

    hide() {
    if (this.container) {
        this.container.style.display = "none";
    }

    if (this.status) {
        this.status.style.display = "none";
        this.status.innerHTML = "";
    }
}

    dispose() {}
}

export default PlayerLoadMask;
