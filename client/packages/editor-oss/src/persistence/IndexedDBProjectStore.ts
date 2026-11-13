
import type {ProjectStore} from "./ProjectStore";
import {exportProjectArchive, importProjectArchive} from "./projectArchive";
import type {
    ListProjectsOptions,
    ListProjectsResult,
    ProjectBody,
    ProjectMeta,
    StoredAsset,
} from "./types";

const DB_NAME = "stemstudio-projects";
const STORE_NAME = "projects";
const ASSET_STORE_NAME = "assets";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | undefined;

const openDb = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === "undefined") {
                reject(new Error("IndexedDB is not available"));
                return;
            }

            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = () => {
                const db = req.result;

                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, {keyPath: "meta.id"});
                    store.createIndex("byUpdatedAt", "meta.updatedAt");
                }

                if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
                    const assetStore = db.createObjectStore(ASSET_STORE_NAME, {keyPath: "key"});
                    assetStore.createIndex("byProjectId", "projectId");
                }
            };

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error("Failed to open projects DB"));
        });
    }

    return dbPromise;
};

const txGet = <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> =>
    openDb().then(
        db =>
            new Promise<T>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, mode);
                const store = tx.objectStore(STORE_NAME);
                const req = fn(store);

                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error ?? new Error("IndexedDB error"));
            }),
    );

const assetTx = (
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => void,
): Promise<void> =>
    openDb().then(
        db =>
            new Promise<void>((resolve, reject) => {
                const tx = db.transaction(ASSET_STORE_NAME, mode);
                fn(tx.objectStore(ASSET_STORE_NAME));

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB asset error"));
                tx.onabort = () =>
                    reject(tx.error ?? new Error("IndexedDB asset transaction aborted"));
            }),
    );

type StoredAssetRow = {
    key: string;
    projectId: string;
    asset: StoredAsset;
};

const nowIso = (): string => new Date().toISOString();

const newId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `proj_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};

export class IndexedDBProjectStore implements ProjectStore {
    readonly kind = "indexeddb" as const;

    async list(options: ListProjectsOptions = {}): Promise<ListProjectsResult> {
        const page = Math.max(1, options.page ?? 1);
        const limit = Math.max(1, options.limit ?? 40);
        const search = options.search?.trim().toLowerCase() ?? "";

        const all = await txGet<ProjectBody[]>("readonly", store => store.getAll());

        const filtered = search
            ? all.filter(p => p.meta.name.toLowerCase().includes(search))
            : all;

        const sorted = filtered.sort(
            (a, b) =>
                new Date(b.meta.updatedAt).getTime() -
                new Date(a.meta.updatedAt).getTime(),
        );

        const start = (page - 1) * limit;
        const slice = sorted.slice(start, start + limit);

        return {
            projects: slice.map(p => p.meta),
            page,
            hasMore: start + slice.length < sorted.length,
            totalCount: sorted.length,
        };
    }

    async load(id: string): Promise<ProjectBody> {
        const result = await txGet<ProjectBody | undefined>(
            "readonly",
            store => store.get(id),
        );

        if (!result) {
            throw new Error(`Project ${id} not found`);
        }

        return result;
    }

    async save(body: ProjectBody): Promise<ProjectMeta> {
        const meta: ProjectMeta = {
            ...body.meta,
            id: body.meta.id || newId(),
            createdAt: body.meta.createdAt || nowIso(),
            updatedAt: nowIso(),
        };

        const toStore: ProjectBody = {...body, meta};

        await txGet("readwrite", store => store.put(toStore));

        return meta;
    }

    async delete(id: string): Promise<void> {
        await txGet("readwrite", store => store.delete(id));
        await this.clearAssets(id);
    }

    /**
     * Exports the project together with all its binary assets.
     */
    async exportToBlob(id: string): Promise<Blob> {
        const body = await this.load(id);
        const assets = await this.loadAssets(id);

        return exportProjectArchive(body, assets);
    }

    /**
     * Imports both new ZIP archives and older JSON project files.
     * A fresh ID prevents the imported project from overwriting another one.
     */
    async importFromBlob(blob: Blob): Promise<ProjectMeta> {
        const imported = await importProjectArchive(blob);
        const id = newId();

        const body: ProjectBody = {
            ...imported.project,
            meta: {
                ...imported.project.meta,
                id,
                createdAt: nowIso(),
                updatedAt: nowIso(),
            },
        };

        const savedMeta = await this.save(body);

        try {
            await this.saveAssets(id, imported.assets);
        } catch (error) {
            await this.delete(id).catch(() => undefined);

            throw new Error(
                `Project import failed while restoring its assets: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }

        return savedMeta;
    }

    private async clearAssets(projectId: string): Promise<void> {
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) =>
            openDb().then(db => {
                const tx = db.transaction(ASSET_STORE_NAME, "readonly");
                const req = tx
                    .objectStore(ASSET_STORE_NAME)
                    .index("byProjectId")
                    .getAllKeys(projectId);

                req.onsuccess = () => resolve(req.result);
                req.onerror = () =>
                    reject(req.error ?? new Error("IndexedDB asset error"));
            }),
        );

        if (keys.length === 0) return;

        await assetTx("readwrite", store => {
            for (const key of keys) {
                store.delete(key);
            }
        });
    }

    async saveAssets(projectId: string, assets: StoredAsset[]): Promise<void> {
        await this.clearAssets(projectId);

        if (assets.length === 0) return;

        await assetTx("readwrite", store => {
            for (const asset of assets) {
                const row: StoredAssetRow = {
                    key: `${projectId}::${asset.assetId}`,
                    projectId,
                    asset,
                };

                store.put(row);
            }
        });
    }

    async loadAssets(projectId: string): Promise<StoredAsset[]> {
        const rows = await new Promise<StoredAssetRow[]>((resolve, reject) =>
            openDb().then(db => {
                const tx = db.transaction(ASSET_STORE_NAME, "readonly");
                const req = tx
                    .objectStore(ASSET_STORE_NAME)
                    .index("byProjectId")
                    .getAll(projectId);

                req.onsuccess = () => resolve(req.result as StoredAssetRow[]);
                req.onerror = () =>
                    reject(req.error ?? new Error("IndexedDB asset error"));
            }),
        );

        return rows.map(row => row.asset);
    }
}
