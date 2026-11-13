import global from "@web-shared/global";
import {OSS_LOCAL_USER_ID} from "@web-shared/ossUser";
import {Asset, createAssetUpload, dataToBase64, getDataByteLength, gzipData, INLINE_DATA_MAX_BYTES, isConflictError, registerOssAsset, uploadAssetData} from "../asset";
import {getJobsApiClient, getScenesApiClient} from "../client";
import {DomainAssetType, HandlerCreateAssetTokenResponse, HandlerCreateRevisionRequest, HandlerCreateSceneRequest, DomainSceneDto, HandlerPublishSceneRequest, HandlerUpdateSceneRequest, JobsJobResponseStatusEnum} from "../client/api";
import Ajax from "@web-shared/utils/Ajax";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";
import {IS_OSS} from "../../../buildMode";
import type {SceneSettings} from "./index";
export type {DomainSceneDto as GetSceneResponse} from "../client/api";
export type {HandlerCreateAssetTokenResponse as AssetTokenResponse} from "../client/api";

export type GetSceneOptions = {
    includeDerivatives?: boolean;
    includeDerivativeDataUrl?: boolean;
    /**
     * Which revision to load: "head" or "published". Omit for the default
     * role-based selection (head for contributors, published pin for
     * viewers). Used by the play link to force the published
     * revision so owners see what players see.
     */
    revision?: "head" | "published";
    /** Load a specific revision by ID, bypassing the role-based selection. */
    revisionId?: string;
};

/**
 * Fetches scene metadata, dataUrl, and optionally derivatives from the v2 scene API.
 *
 * @param sceneId - ID of the scene to fetch
 * @param options - Controls which optional fields are included in the response
 * @param options.includeDerivatives - Include the scene's asset derivatives
 * @param options.includeDerivativeDataUrl - Include signed CDN URLs for each derivative
 * @param options.revision - Force "head" or "published" revision selection
 * @returns The scene response, including metadata and (if requested) derivatives and dataUrl
 * @throws Error with `.status` set if the API returns a non-200 status
 */
export const getScene = async (sceneId: string, options: GetSceneOptions = {}): Promise<DomainSceneDto> => {
    if (IS_OSS) {
        return loadSceneFromProjectStore(sceneId);
    }
    const includes: string[] = [];
    if (options.includeDerivatives) includes.push("derivatives");
    if (options.includeDerivativeDataUrl) includes.push("derivativeDataUrl");
    const includeParam = includes.length ? includes.join(",") : undefined;
    const axiosOptions = options.revisionId ? {params: {revisionId: options.revisionId}} : undefined;
    const response = await getScenesApiClient().getScene(sceneId, includeParam, options.revision, axiosOptions);
    if (response?.status !== 200) {
        const err = new Error("Failed to fetch scene") as Error & {status?: number};
        err.status = response?.status;
        throw err;
    }
    return response.data;
};

/**
 * OSS-mode scene load. Reads the project body from the local `ProjectStore`
 * (IndexedDB or File System Access) and synthesizes the `DomainSceneDto`
 * shape the editor expects, encoding the serialized scene as a `data:` URL
 * on `revision.dataUrl`. The downstream `fetchScenePayload` then fetches it
 * via `fetch(...)` exactly as it would a cloud-signed dataUrl, so the rest
 * of the load pipeline is unchanged.
 *
 * The cloud DTO carries dozens of fields used by integrated-only flows
 * (publish gallery, ownership checks, collaborator gating). We only
 * populate what `setUpScene` actually reads; the rest are stamped with safe
 * defaults. If a future change in `setUpScene` reads more fields, extend
 * the body here rather than re-introducing a `/api/scene/<id>` round-trip.
 */
async function loadSceneFromProjectStore(sceneId: string): Promise<DomainSceneDto> {
    // Imported lazily to keep this network adapter free of editor-oss
    // direct dependencies; the persistence factory only resolves when the
    // OSS bootstrap has registered a backend.
    const {getProjectStore, ensureProjectStoreRehydrated} = await import("@stem/editor-oss/persistence");
    // Make sure the chosen backend (File System Access vs IndexedDB) is
    // resolved before reading. The Player route doesn't run the dashboard's
    // bootstrap effect, so without this it would read the lazy IndexedDB
    // fallback and report a filesystem project as "not found".
    await ensureProjectStoreRehydrated();
    const store = getProjectStore();
    let body;
    try {
        body = await store.load(sceneId);
    } catch (err) {
        // The store throws plain `Error("Project X not found...")`. The
        // editor's `isSceneInaccessibleError` detects missing scenes by
        // `status === 404`, so surface a stable shape here. Without this the
        // Create page treats the failure as a generic load error and
        // reattempts, leaving the user stuck on a half-loaded scene instead
        // of being routed back to the dashboard.
        const wrapped = new Error(
            err instanceof Error ? err.message : `Project ${sceneId} not found`,
        ) as Error & {status?: number; cause?: unknown};
        wrapped.status = 404;
        wrapped.cause = err;
        throw wrapped;
    }

    // Re-seed the in-memory OSS asset registry from the project's persisted
    // binary assets so model/image/audio references in the scene JSON
    // resolve. The registry is module-level and empty after a page reload;
    // this restores it before the scene is deserialized.
    

    // Restore all binary assets before deserializing the scene.
    // A missing or corrupted asset must stop the load instead of producing
    // a scene that appears successful but is missing models, images or audio.
    let assets;

    try {
        assets = await store.loadAssets(sceneId);
    } catch (err) {
        throw new Error(
            `Unable to restore the binary assets of project "${sceneId}": ${
                err instanceof Error ? err.message : String(err)
            }`,
            {cause: err},
        );
    }

    for (const a of assets) {
        const mime =
            a.contentType ||
            (a.format === "json"
                ? "application/json"
                : "application/octet-stream");

        const thumbMime = a.thumbnailContentType || "image/png";

        const thumbnailDataUrl = a.thumbnailData
            ? `data:${thumbMime};base64,${a.thumbnailData}`
            : undefined;

        registerOssAsset({
            assetId: a.assetId,
            revisionId: a.revisionId,
            type: a.type as DomainAssetType,
            format: a.format,
            name: a.name,
            contentType: a.contentType,
            metadata: a.metadata,
            dataUrl: `data:${mime};base64,${a.data}`,
            thumbnailDataUrl,
            projectId: sceneId,
        });
    }

    const sceneJsonBase64 = (() => {
        try {
            // btoa(unescape(encodeURIComponent(...))) handles non-ASCII content.
            return btoa(unescape(encodeURIComponent(body.sceneJson)));
        } catch {
            return btoa(body.sceneJson);
        }
    })();
    const dataUrl = `data:application/json;base64,${sceneJsonBase64}`;
    const now = body.meta.updatedAt || new Date().toISOString();

    // OSS persists the asset resolution context *inside* the scene JSON
    // (`scene.userData.assetResolutionContext`), not in separate metadata
    // fields like the cloud backend. The loader (`scene/util.ts loadScene`)
    // treats any truthy `dependencies` metadata as authoritative and
    // discards the scene's own `userData.assetResolutionContext`. Handing it
    // empty objects therefore wipes the real dependency map on every reload,
    // so model/behavior asset refs fail to resolve (untextured models).
    // Extract the persisted context here and surface it as metadata so the
    // loader rebuilds the correct map.
    let ossDependencies: Record<string, string> = {};
    let ossLogicalIdToAssetId: Record<string, string> = {};
    // `showHud` (and the other game flags) live in the persisted scene's
    // `userData.game`, not in separate metadata. Default to OFF — the HUD is
    // opt-in (see SceneConfig.showHUD = false). Hardcoding `true` here made the
    // HUD appear on every reload regardless of the project's actual setting.
    let ossShowHud = false;
    try {
        const parsed = JSON.parse(body.sceneJson) as Record<string, unknown>;
        for (const part of Object.values(parsed)) {
            const userData = (part as {userData?: {
                assetResolutionContext?: {
                    assetIdToRevisionId?: Record<string, string>;
                    logicalIdToAssetId?: Record<string, string>;
                };
                game?: {showHUD?: boolean};
            }})?.userData;
            const ctx = userData?.assetResolutionContext;
            if (ctx) {
                ossDependencies = ctx.assetIdToRevisionId ?? ossDependencies;
                ossLogicalIdToAssetId = ctx.logicalIdToAssetId ?? ossLogicalIdToAssetId;
            }
            if (typeof userData?.game?.showHUD === "boolean") {
                ossShowHud = userData.game.showHUD;
            }
            if (ctx) break;
        }
    } catch (err) {
        console.warn("[scene/v2] failed to extract asset resolution context from scene JSON", err);
    }
    return {
        id: sceneId,
        name: body.meta.name ?? "Untitled",
        alias: "",
        allowAnonymousFirebase: false,
        asset: {
            id: `oss-asset-${sceneId}`,
            revision: {
                id: `oss-rev-${sceneId}`,
                dataUrl,
                derivatives: [],
                expiresAt: undefined,
                metadata: {
                    dependencies: ossDependencies,
                    isMultiplayer: false,
                    lockedItems: "",
                    logicalIdToAssetId: ossLogicalIdToAssetId,
                    maxCollaboratorsInRoom: 0,
                    maxMultiplayerClientsPerRoom: 0,
                    multiplayerAutoJoin: false,
                    rendering: {} as never,
                    showHud: ossShowHud,
                    showMemoryStats: false,
                    showStats: false,
                    useAvatar: false,
                    useInstancing: false,
                    vfxOnMobile: false,
                    voiceChatEnabled: false,
                },
            },
        } as never,
        assetsCount: 0,
        contentRating: "",
        createTime: body.meta.createdAt ?? now,
        description: "",
        isAssetPack: false,
        isCloneable: false,
        isCollaborative: false,
        isPublic: false,
        isPublished: false,
        isSandbox: false,
        isTopPick: false,
        majorVersion: 0,
        minorVersion: 0,
        tags: "",
        thumbnail: body.meta.thumbnailUrl ?? "",
        updateTime: now,
        userId: OSS_LOCAL_USER_ID,
    };
}

export type CreateSceneAssetOptions = {
    description?: string;
    dependencies?: Record<string, string>;
    metadata?: Record<string, object>;
};
export type CreateSceneAssetParams = {
    sceneId: string;
    type: DomainAssetType;
    format: string;
    contentType: string;
    name: string;
    description?: string;
    revisionDescription?: string;
    uploadId?: string;
    data?: string; // base64-encoded (alternative to uploadId)
    options?: CreateSceneAssetOptions;
};

export const createSceneAsset = async ({
    sceneId,
    type,
    format,
    contentType,
    name,
    description,
    revisionDescription,
    uploadId,
    data,
    options = {},
}: CreateSceneAssetParams): Promise<Asset> => {
    if (IS_OSS) {
        // OSS has no integrated asset service. The scene JSON saved through
        // ProjectStore is self-contained; asset records are synthetic so
        // the rest of the editor's bookkeeping (assetAdded events, scene
        // userData asset refs) still has a stable id to reference.
        const synthetic = synthOSSAsset({type, format, name, description, data, sceneId, contentType, metadata: options.metadata});
        global.app?.call("assetAdded", null, {assetId: synthetic.id});
        return synthetic;
    }
    const response = await getScenesApiClient().createSceneAsset(sceneId, {
        type,
        format,
        contentType,
        name,
        description,
        revisionDescription,
        uploadId,
        data,
        dependencies: options.dependencies,
        metadata: options.metadata,
    });

    if (response?.status !== 201) {
        console.warn("Failed to create asset", response);
        throw new Error("Failed to create asset");
    }

    // Broadcast the change to legacy listeners
    global.app?.call("assetAdded", null, {assetId: response.data.id});

    return response.data;
};

function synthOSSAsset(params: {type: DomainAssetType; format: string; name: string; description?: string; data?: string; sceneId?: string; contentType?: string; metadata?: Record<string, unknown>}): Asset {
    const id = `oss-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const revisionId = `oss-rev-${id}`;
    const now = new Date().toISOString();
    let dataUrl: string | undefined;
    if (typeof params.data === "string" && params.data.length > 0) {
        // params.data is already base64-encoded — wrap it as a data: URL so
        // downstream consumers that fetch revision.dataUrl can decode it.
        const mime = params.format === "json" ? "application/json" : (params.contentType || "application/octet-stream");
        dataUrl = `data:${mime};base64,${params.data}`;
    }
    registerOssAsset({
        assetId: id,
        revisionId,
        type: params.type,
        format: params.format,
        name: params.name,
        contentType: params.contentType,
        metadata: params.metadata,
        dataUrl,
        projectId: params.sceneId,
    });
    return {
        id,
        type: params.type,
        format: params.format,
        name: params.name,
        description: params.description,
        createTime: now,
        updateTime: now,
        userId: OSS_LOCAL_USER_ID,
        headRevisionId: revisionId,
        revision: {id: revisionId, dataUrl, derivatives: [], expiresAt: undefined},
    } as unknown as Asset;
}

export type CreateSceneAssetWithDataParams = {
    sceneId: string;
    type: DomainAssetType;
    name: string;
    data: string | ArrayBuffer | Blob | ReadableStream;
    format: string;
    contentType: string;
    options?: CreateSceneAssetOptions;
    contentEncoding?: string;
};

/**
 * Convenience function for creating an asset with the given data.
 * Uses inline data for small payloads (<=1 MB) to avoid 3 HTTP round-trips.
 *
 * @param params - Parameters for creating the asset
 * @param params.sceneId - ID of the scene
 * @param params.type - Type of the asset
 * @param params.name - Name of the asset
 * @param params.format - Format of the data (e.g., "glb")
 * @param params.contentType - Content type of the data
 * @param params.data - Data to upload
 * @param params.options - Additional options for asset creation
 * @param params.contentEncoding - Encoding of the data
 * @returns Promise resolving to the created asset
 */
export const createSceneAssetWithData = async ({
    sceneId,
    type,
    name,
    format,
    contentType,
    data,
    options = {},
    contentEncoding,
}: CreateSceneAssetWithDataParams) => {
    console.log("[createSceneAssetWithData] Starting:", {
        sceneId,
        type,
        name,
        format,
        contentType,
        contentEncoding,
        dataSize: data instanceof Blob ? data.size : data instanceof ArrayBuffer ? data.byteLength : "unknown",
    });

    // Inline path for small data — skip the upload roundtrip (no gzip for inline).
    // In OSS we always take the inline path: there is no asset-upload endpoint
    // and createSceneAsset has an IS_OSS branch that produces a synthetic
    // asset record from the inline base64 payload.
    const byteLength = getDataByteLength(data);
    let asset: Asset;
    if (IS_OSS || (byteLength !== null && byteLength <= INLINE_DATA_MAX_BYTES)) {
        const base64 = await dataToBase64(data as string | ArrayBuffer | Blob);
        console.log("[createSceneAssetWithData] Using inline data path");
        asset = await createSceneAsset({
            sceneId,
            type,
            format,
            contentType,
            name,
            description: options.description,
            data: base64,
            options,
        });
    } else {
        const uploadData = contentEncoding ? await gzipData(data) : data;
        const {upload, uploadUrl} = await createAssetUpload(contentType, contentEncoding);
        console.log("[createSceneAssetWithData] Got upload URL:", {uploadId: upload.id, uploadUrl});

        await uploadAssetData(uploadUrl, uploadData, contentType, contentEncoding);
        console.log("[createSceneAssetWithData] Upload complete, creating asset");

        asset = await createSceneAsset({
            sceneId,
            type,
            format,
            contentType,
            name,
            description: options.description,
            uploadId: upload.id,
            options,
        });
    }
    const app = global.app as any;
    if (app?.editor?.isAssetPack) {
        const data = [{assetId: asset.id, revisionId: asset.headRevisionId}];
        app.call("autoCreateAssetReleases", data, data);
    }

    return asset;
};

export const removeAssetsFromScene = async (sceneId: string, assetIds: string[]) => {
    if (IS_OSS) {
        // OSS scenes don't track asset memberships server-side; just fan
        // out the local event so the editor's bookkeeping reacts.
        assetIds.forEach(assetId => {
            global.app?.call("assetRemoved", null, {assetId});
        });
        return;
    }
    const response = await getScenesApiClient().removeAssetsFromScene(sceneId, {assetIds});

    if (response?.status !== 200) {
        console.warn("Failed to remove assets from scene", response);
        throw new Error("Failed to remove assets from scene");
    }
    assetIds.forEach(assetId => {
        global.app?.call("assetRemoved", null, {assetId});
    });
};

export const updateSceneDependencies = async (sceneId: string, dependencies: Record<string, string>) => {
    if (IS_OSS) {
        // OSS persistence is single-blob; dependency tracking lives in
        // scene.userData on save. No backend call required.
        return {dependencies} as never;
    }
    const response = await getScenesApiClient().updateSceneDependencies(sceneId, {dependencies});

    if (response?.status !== 200) {
        console.warn("Failed to update scene dependencies", response);
        throw new Error("Failed to update scene dependencies");
    }

    return response.data;
};

export type CloneSceneOptions = {
    /** Custom name for the cloned scene */
    name?: string;
    /** Initial polling interval in milliseconds (default: 500) */
    initialPollInterval?: number;
    /** Maximum polling interval in milliseconds (default: 5000) */
    maxPollInterval?: number;
    /** Timeout in milliseconds (default: 300000 = 5 minutes) */
    timeout?: number;
};

export type CloneSceneResult = {
    newSceneId: string;
    newSceneName: string;
};

export type ForkSceneOptions = {
    /** Custom name for the forked scene. Defaults to source name + " (Remix)". */
    name?: string;
};

export type ForkSceneResult = {
    newSceneId: string;
    newSceneName: string;
};

export type SceneRevisionChangedAssetCapture = {
    assetId: string;
    revisionId?: string;
    kind?: string;
};

export type SceneRevisionValidationCapture = {
    id: string;
    label: string;
    status: string;
    detail?: string;
};

export type SceneRevisionCapture = {
    id: string;
    sceneId: string;
    revisionId: string;
    name?: string;
    summary?: string;
    source?: string;
    baseRevisionId?: string;
    restoredFromRevisionId?: string;
    previewId?: string;
    affectedSystems?: string[];
    changedAssets?: SceneRevisionChangedAssetCapture[];
    validation?: SceneRevisionValidationCapture[];
    userId?: string;
    createTime: string;
    updateTime: string;
};

export type UpsertSceneRevisionCaptureRequest = {
    name?: string;
    summary?: string;
    source?: string;
    baseRevisionId?: string;
    restoredFromRevisionId?: string;
    previewId?: string;
    affectedSystems?: string[];
    changedAssets?: SceneRevisionChangedAssetCapture[];
    validation?: SceneRevisionValidationCapture[];
};

export const listSceneRevisionCaptures = async (sceneId: string): Promise<SceneRevisionCapture[]> => {
    if (IS_OSS) return [];

    const response = await Ajax.get({
        url: backendUrlFromPath(`/api/scene/${sceneId}/revision-captures`),
        msgBodyType: "json",
    });

    if (response?.status !== 200) {
        throw new Error("Failed to load scene revision captures.");
    }

    return response.data?.captures ?? [];
};

export const upsertSceneRevisionCapture = async (
    sceneId: string,
    revisionId: string,
    request: UpsertSceneRevisionCaptureRequest,
): Promise<SceneRevisionCapture> => {
    if (IS_OSS) {
        const timestamp = new Date().toISOString();
        return {
            id: `oss-capture-${revisionId}`,
            sceneId,
            revisionId,
            ...request,
            createTime: timestamp,
            updateTime: timestamp,
        };
    }

    const response = await Ajax.put({
        url: backendUrlFromPath(`/api/scene/${sceneId}/revision/${revisionId}/capture`),
        data: JSON.stringify(request),
        msgBodyType: "json",
    });

    if (response?.status !== 200) {
        throw new Error("Failed to save scene revision capture.");
    }

    return response.data;
};

/**
 * Fork a scene synchronously.
 *
 * Creates a new scene that references the same released asset revisions as
 * the source. The user must own the source scene OR the source must be
 * published with isCloneable=true and have all transitive dependencies
 * released.
 *
 * Replaces the legacy clone/duplicate flows for the "Remix" UI action. Unlike
 * cloneScene, this is synchronous (no job polling) because no asset
 * duplication is performed.
 *
 * @param sceneId - ID of the scene to fork
 * @param options - Optional fork options
 * @returns The new scene's id and name
 * @throws Error with .status=403 when the scene is not forkable for this user
 *         (e.g. non-owner, isCloneable=false, or unreleased dependencies)
 */
export const forkScene = async (
    sceneId: string,
    options: ForkSceneOptions = {},
): Promise<ForkSceneResult> => {
    let response;
    try {
        response = await getScenesApiClient().forkScene(sceneId, {name: options.name});
    } catch (err: unknown) {
        const errResponse = (err as {response?: {status?: number; data?: {Msg?: string; message?: string}}}).response;
        if (errResponse?.status === 403) {
            const notForkable = new Error("This scene doesn't allow remixing.") as Error & {status?: number};
            notForkable.status = 403;
            throw notForkable;
        }
        throw err;
    }

    if (response?.status !== 201) {
        console.warn("Failed to fork scene", response);
        throw new Error("Failed to fork scene");
    }

    const dto = response.data;
    if (!dto?.id) {
        throw new Error("Fork succeeded but no scene ID was returned");
    }

    return {
        newSceneId: dto.id,
        newSceneName: dto.name ?? "",
    };
};

/**
 * Clone a scene asynchronously.
 *
 * This function initiates an async clone operation and polls for completion.
 *
 * @param sceneId - ID of the scene to clone
 * @param options - Clone options
 * @returns Promise resolving to the clone result with new scene ID and name
 * @throws Error if clone fails or times out
 */
export const cloneScene = async (
    sceneId: string,
    options: CloneSceneOptions = {},
): Promise<CloneSceneResult> => {
    const {name, initialPollInterval = 500, maxPollInterval = 5000, timeout = 300000} = options;

    // Start the clone job. Axios throws for non-2xx — translate 403 into a
    // user-facing "not cloneable" error so call sites can surface a clear
    // toast (DOT-7545 Gap #4).
    let enqueueResponse;
    try {
        enqueueResponse = await getScenesApiClient().cloneScene(sceneId, {name});
    } catch (err: unknown) {
        const response = (err as {response?: {status?: number; data?: {Msg?: string; message?: string}}}).response;
        if (response?.status === 403) {
            const notCloneable = new Error("This scene doesn't allow remixing.") as Error & {status?: number};
            notCloneable.status = 403;
            throw notCloneable;
        }
        throw err;
    }

    if (enqueueResponse?.status !== 202) {
        console.warn("Failed to start clone job", enqueueResponse);
        throw new Error("Failed to start clone job");
    }

    const jobId = enqueueResponse.data.jobId;
    if (!jobId) {
        throw new Error("No job ID returned from clone request");
    }

    console.log("[cloneScene] Clone job started:", {sceneId, jobId});

    // Poll for completion with exponential backoff
    const startTime = Date.now();
    const jobsClient = getJobsApiClient();
    let currentInterval = initialPollInterval;

    while (true) {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeout) {
            throw new Error(`Clone operation timed out after ${timeout}ms`);
        }

        const jobResponse = await jobsClient.getJob(jobId);

        if (jobResponse?.status !== 200) {
            throw new Error("Failed to get job status");
        }

        const job = jobResponse.data;
        const status = job.status;

        if (status === JobsJobResponseStatusEnum.Completed) {
            const result = job.result as CloneSceneResult | undefined;
            if (!result?.newSceneId) {
                throw new Error("Clone completed but no scene ID in result");
            }
            console.log("[cloneScene] Clone completed:", result);
            return result;
        }

        if (status === JobsJobResponseStatusEnum.Failed) {
            const errorMsg = job.error || "Clone operation failed";
            console.error("[cloneScene] Clone failed:", errorMsg);
            throw new Error(errorMsg);
        }

        // Still pending or running - wait with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, currentInterval));
        currentInterval = Math.min(currentInterval * 2, maxPollInterval);
    }
};

/**
 * Update scene-level properties (name, description, flags, etc.).
 * Only provided fields are updated (partial update via PATCH).
 *
 * @param sceneId - ID of the scene to update
 * @param params - Fields to update (only non-undefined fields are sent)
 * @returns The updated scene response
 */
export const updateScene = async (
    sceneId: string,
    params: HandlerUpdateSceneRequest,
): Promise<DomainSceneDto> => {
    const response = await getScenesApiClient().updateScene(sceneId, params);
    if (response?.status !== 200) {
        throw new Error("Failed to update scene.");
    }
    return response.data;
};

/**
 * Publish a scene by pinning the asset revision id players will load.
 *
 * Optionally also lists the scene in the public gallery via `isPublic`. Omit
 * the option to leave the gallery listing state unchanged — useful for
 * re-publishing a scene that's already public without forcing the caller to
 * repeat the flag.
 *
 * @param sceneId - ID of the scene to publish
 * @param revisionId - The asset revision id to pin as the published revision
 * @param options
 * @param options.isPublic - Optional public-gallery listing toggle
 * @returns The updated scene DTO with the new publishRevisionId
 */
export const publishScene = async (
    sceneId: string,
    revisionId: string,
    options: {isPublic?: boolean} = {},
): Promise<DomainSceneDto> => {
    const request: HandlerPublishSceneRequest = {
        revisionId,
        ...(options.isPublic !== undefined ? {isPublic: options.isPublic} : {}),
    };
    const response = await getScenesApiClient().publishScene(sceneId, request);
    if (response?.status !== 200) {
        throw new Error("Failed to publish scene.");
    }
    return response.data;
};

/**
 * Unpublish a scene. Clears the pinned publish revision, the legacy
 * `isPublished` flag, and `isPublic` (because a scene without a playable
 * pinned revision cannot remain in the public gallery — the
 * Public ⇒ Published invariant).
 *
 * @param sceneId - ID of the scene to unpublish
 * @returns The updated scene DTO
 */
export const unpublishScene = async (sceneId: string): Promise<DomainSceneDto> => {
    const response = await getScenesApiClient().unpublishScene(sceneId);
    if (response?.status !== 200) {
        throw new Error("Failed to unpublish scene.");
    }
    return response.data;
};

// ---------------------------------------------------------------------------
// Scene save endpoints (v2): uploadId-based save flow
// ---------------------------------------------------------------------------

/**
 * Uploads scene JSON to blob storage via the asset upload flow and returns the uploadId.
 * @param data - Serialized scene JSON string
 * @returns The uploadId referencing the stored blob
 */
const uploadScenePayload = async (data: string): Promise<string> => {
    const {upload, uploadUrl} = await createAssetUpload("application/json");
    await uploadAssetData(uploadUrl, data, "application/json");
    return upload.id;
};

export type CreateSceneRequest = Omit<HandlerCreateSceneRequest, "uploadId"> & {name: string};

/**
 * Maps the legacy PascalCase {@link SceneSettings} shape onto the v2 createScene
 * request body. Pure shape conversion — no I/O, no publish directive.
 *
 * Drops fields that have no v2 equivalent or that belong to a different flow:
 * - `IsPublic` / `IsPublished` — handled separately via {@link publishScene}
 * - `ID` — new scenes don't carry an upstream id
 * - `MajorVersion` / `MinorVersion` — defaulted server-side
 * - `ProductionMode` / `CompartmentsEnabled` — live in scene userData, not scene-level
 * - `AssetsCount` — legacy type quirk (boolean vs the v2 number)
 *
 * @param settings - Legacy SceneSettings (typically embedded in an exported scene JSON)
 * @param name - Scene name (required by v2; passed separately so callers can provide a fallback)
 * @returns The v2 createScene request body, ready to pass to {@link createScene}
 */
export const sceneSettingsToCreateRequest = (
    settings: SceneSettings,
    name: string,
): CreateSceneRequest => {
    const tags = Array.isArray(settings.Tags) ? settings.Tags.join(", ") : undefined;
    return {
        name,
        alias: settings.Alias,
        allowAnonymousFirebase: settings.AllowAnonymousFirebase,
        dependencies: settings.Dependencies,
        description: settings.Description,
        isAssetPack: settings.IsAssetPack,
        isCloneable: settings.IsCloneable,
        isCollaborative: settings.IsCollaborative,
        isMultiplayer: settings.IsMultiplayer,
        isSandbox: settings.IsSandbox,
        isTopPick: settings.IsTopPick,
        lockedItems: settings.LockedItems,
        maxCollaboratorsInRoom: settings.MaxCollaboratorsInRoom,
        maxMultiplayerClientsPerRoom: settings.MaxMultiplayerClientsPerRoom,
        multiplayerAutoJoin: settings.MultiplayerAutoJoin,
        rendering: settings.Rendering,
        showHUD: settings.ShowHUD,
        showStats: settings.ShowStats,
        tags,
        thumbnail: settings.Thumbnail,
        useAvatar: settings.UseAvatar,
        useInstancing: settings.UseInstancing,
        vfxOnMobile: settings.VFXOnMobile,
        voiceChatEnabled: settings.VoiceChatEnabled,
    };
};

/**
 * Creates a new scene from a serialized JSON payload.
 * Uploads the payload first, then calls POST /api/scene via the generated client.
 * @param serializedPayload - Serialized scene JSON string
 * @param params - Scene metadata (name is required; uploadId is injected automatically)
 * @returns The created scene's id, alias, and publishedTime
 */
export const createScene = async (
    serializedPayload: string,
    params: Omit<HandlerCreateSceneRequest, "uploadId"> & {name: string},
) => {
    if (IS_OSS) {
        // OSS persistence flows through ProjectStore.save() (see
        // ossSceneSave.ts), not POST /api/scene. Return a synthetic
        // SceneCreate response so callers that rely on the shape don't
        // crash; the real persistence happens elsewhere.
        const id = `oss-scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return {id, alias: params.alias ?? "", publishedTime: undefined} as never;
    }
    const uploadId = await uploadScenePayload(serializedPayload);
    const response = await getScenesApiClient().createScene({...params, uploadId});

    if (response?.status !== 201) {
        throw new Error("Failed to create scene.");
    }

    return response.data;
};

export type CreateSceneRevisionOptions = Omit<HandlerCreateRevisionRequest, "uploadId"> & {
    /**
     * If true, retry once with a fresh parent revision on 409 Conflict. Safe for
     * concurrent save races because the server re-reads the head revision on each
     * request, and the uploadId can be reused (the server copies the blob, doesn't
     * consume it).
     */
    retryOnConflict?: boolean;
};

/**
 * Creates a new revision for an existing asset-backed scene.
 * Uploads the payload first, then calls POST /api/scene/:sceneId/revision via the generated client.
 *
 * @param sceneId - ID of the scene to create a revision for
 * @param serializedPayload - Serialized scene JSON string
 * @param options - Scene metadata and optional retryOnConflict flag (uploadId is injected automatically)
 * @returns The new revisionId and publishedTime
 */
export const createSceneRevision = async (
    sceneId: string,
    serializedPayload: string,
    options: CreateSceneRevisionOptions,
) => {
    if (IS_OSS) {
        // OSS doesn't track revisions — the local ProjectStore overwrites
        // in place. Return a synthetic revisionId so callers that thread
        // the value through don't break.
        const revisionId = `oss-rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return {revisionId, publishedTime: undefined} as never;
    }
    const {retryOnConflict, ...params} = options;
    const uploadId = await uploadScenePayload(serializedPayload);

    const call = async () => {
        const response = await getScenesApiClient().createSceneRevision(sceneId, {...params, uploadId});
        if (response?.status !== 201) {
            throw new Error("Failed to create scene revision.");
        }
        return response.data;
    };

    try {
        return await call();
    } catch (err) {
        if (retryOnConflict && isConflictError(err)) {
            // Retry once — server re-reads fresh head revision on retry.
            // The uploadId is reusable because the server copies the blob, doesn't consume it.
            return await call();
        }
        throw err;
    }
};

/**
 * Mint a short-lived asset token granting scoped access to an asset and its
 * direct dependencies. The caller must be a scene contributor, and the asset
 * must be a direct dependency of the scene owned by the scene owner.
 *
 * @param sceneId - The scene that justifies the access grant
 * @param assetId - The root asset the token authorizes access to
 * @returns The signed token and its expiry
 */
export const createAssetToken = async (sceneId: string, assetId: string): Promise<HandlerCreateAssetTokenResponse> => {
    const response = await getScenesApiClient().createAssetToken(sceneId, assetId);
    return response.data;
};
