
import type {ProjectStore} from "./ProjectStore";
import {exportProjectArchive, importProjectArchive} from "./projectArchive";
import type {
    ListProjectsOptions,
    ListProjectsResult,
    ProjectBody,
    ProjectMeta,
    StoredAsset,
} from "./types";

/**
 * Chromium-only project store backed by the File System Access API.
 *
 * Each project is stored as a JSON file inside the selected directory.
 * Binary assets are stored in a sibling directory named after the project ID.
 */

type FsFileHandle = {
    kind: "file";
    name: string;
    getFile(): Promise<File>;
    createWritable(options?: {keepExistingData?: boolean}): Promise<{
        write(data: Blob | string | BufferSource): Promise<void>;
        close(): Promise<void>;
    }>;
};

type FsDirectoryHandle = {
    kind: "directory";
    name: string;
    getFileHandle(name: string, options?: {create?: boolean}): Promise<FsFileHandle>;
    getDirectoryHandle(name: string, options?: {create?: boolean}): Promise<FsDirectoryHandle>;
    removeEntry(name: string, options?: {recursive?: boolean}): Promise<void>;
    entries(): AsyncIterableIterator<[string, FsFileHandle | FsDirectoryHandle]>;
};

const SUFFIX = ".stemscript.json";
const ASSET_MANIFEST = "assets.json";

const isNotFoundError = (err: unknown): boolean =>
    err instanceof DOMException
        ? err.name === "NotFoundError"
        : (err as {name?: string})?.name === "NotFoundError";

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    const chunk = 0x8000;

    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }

    return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
};

type AssetManifestEntry = Omit<StoredAsset, "data"> & {file: string};

export const isFileSystemAccessSupported = (): boolean =>
    typeof window !== "undefined" &&
    typeof (window as unknown as {showDirectoryPicker?: unknown}).showDirectoryPicker ===
        "function";

const nowIso = (): string => new Date().toISOString();

const newId = (): string =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `proj_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const sanitizeName = (name: string): string =>
    name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "untitled";

const filenameFor = (meta: ProjectMeta): string =>
    `${sanitizeName(meta.name)}.${meta.id}${SUFFIX}`;

export class FileSystemProjectStore implements ProjectStore {
    readonly kind = "filesystem" as const;

    constructor(private readonly dir: FsDirectoryHandle) {}

    private writeChain: Promise<unknown> = Promise.resolve();

    private serializeWrite<T>(op: () => Promise<T>): Promise<T> {
        const run = this.writeChain.then(
            () => this.runWithRetry(op),
            () => this.runWithRetry(op),
        );

        this.writeChain = run.then(
            () => undefined,
            () => undefined,
        );

        return run;
    }

    private async runWithRetry<T>(op: () => Promise<T>, attempts = 3): Promise<T> {
        let lastErr: unknown;

        for (let i = 0; i < attempts; i++) {
            try {
                return await op();
            } catch (err) {
                lastErr = err;

                const name = (err as {name?: string})?.name ?? "";
                const transient =
                    name === "NotFoundError" ||
                    name === "InvalidStateError" ||
                    name === "NoModificationAllowedError";

                if (!transient || i === attempts - 1) {
                    throw err;
                }

                await new Promise(resolve => setTimeout(resolve, 150 * (i + 1)));
            }
        }

        throw lastErr;
    }

    getDirectoryName(): string {
        return this.dir.name;
    }

    async list(options: ListProjectsOptions = {}): Promise<ListProjectsResult> {
        const page = Math.max(1, options.page ?? 1);
        const limit = Math.max(1, options.limit ?? 40);
        const search = options.search?.trim().toLowerCase() ?? "";

        const all: ProjectMeta[] = [];

        for await (const [name, handle] of this.dir.entries()) {
            if (handle.kind !== "file" || !name.endsWith(SUFFIX)) {
                continue;
            }

            try {
                const file = await handle.getFile();
                const body = JSON.parse(await file.text()) as ProjectBody;

                if (body?.meta) {
                    all.push(body.meta);
                }
            } catch (err) {
                console.error(
                    `[FileSystemProjectStore] Skipping unreadable project file "${name}":`,
                    err,
                );
            }
        }

        const filtered = search
            ? all.filter(p => p.name.toLowerCase().includes(search))
            : all;

        const sorted = filtered.sort(
            (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
        );

        const start = (page - 1) * limit;
        const slice = sorted.slice(start, start + limit);

        return {
            projects: slice,
            page,
            hasMore: start + slice.length < sorted.length,
            totalCount: sorted.length,
        };
    }

    private async matchingNamesForId(id: string): Promise<string[]> {
        const matches: string[] = [];

        for await (const [name, handle] of this.dir.entries()) {
            if (
                handle.kind === "file" &&
                name.endsWith(SUFFIX) &&
                name.includes(`.${id}.`)
            ) {
                matches.push(name);
            }
        }

        return matches;
    }

    private async resolveHandleForId(id: string): Promise<FsFileHandle> {
        let best: {handle: FsFileHandle; updatedAt: number} | undefined;

        for await (const [name, handle] of this.dir.entries()) {
            if (
                handle.kind !== "file" ||
                !name.endsWith(SUFFIX) ||
                !name.includes(`.${id}.`)
            ) {
                continue;
            }

            let updatedAt = 0;

            try {
                const file = await handle.getFile();
                const body = JSON.parse(await file.text()) as ProjectBody;
                updatedAt = new Date(body.meta?.updatedAt ?? 0).getTime();
            } catch {
                // Keep malformed matches as a last-resort candidate.
            }

            if (!best || updatedAt > best.updatedAt) {
                best = {handle, updatedAt};
            }
        }

        if (best) {
            return best.handle;
        }

        throw new Error(`Project ${id} not found in folder`);
    }

    async load(id: string): Promise<ProjectBody> {
        const handle = await this.resolveHandleForId(id);
        const file = await handle.getFile();

        return JSON.parse(await file.text()) as ProjectBody;
    }

    save(body: ProjectBody): Promise<ProjectMeta> {
        return this.serializeWrite(() => this.saveLocked(body));
    }

    private async saveLocked(body: ProjectBody): Promise<ProjectMeta> {
        const meta: ProjectMeta = {
            ...body.meta,
            id: body.meta.id || newId(),
            createdAt: body.meta.createdAt || nowIso(),
            updatedAt: nowIso(),
        };

        const toStore: ProjectBody = {...body, meta};
        const targetName = filenameFor(meta);

        const staleNames = (await this.matchingNamesForId(meta.id)).filter(
            name => name !== targetName,
        );

        const handle = await this.dir.getFileHandle(targetName, {create: true});
        const writable = await handle.createWritable();

        try {
            await writable.write(JSON.stringify(toStore, null, 2));
        } finally {
            await writable.close();
        }

        for (const name of staleNames) {
            await this.dir.removeEntry(name);
        }

        return meta;
    }

    delete(id: string): Promise<void> {
        return this.serializeWrite(() => this.deleteLocked(id));
    }

    private async deleteLocked(id: string): Promise<void> {
        for (const name of await this.matchingNamesForId(id)) {
            await this.dir.removeEntry(name);
        }

        try {
            await this.dir.removeEntry(id, {recursive: true});
        } catch {
            // No asset directory exists.
        }
    }

    saveAssets(projectId: string, assets: StoredAsset[]): Promise<void> {
        return this.serializeWrite(() => this.saveAssetsLocked(projectId, assets));
    }

    private async saveAssetsLocked(
        projectId: string,
        assets: StoredAsset[],
    ): Promise<void> {
        try {
            await this.dir.removeEntry(projectId, {recursive: true});
        } catch {
            // First save for this project.
        }

        if (assets.length === 0) {
            return;
        }

        const projectDir = await this.dir.getDirectoryHandle(projectId, {
            create: true,
        });

        const writeAsset = async (
            asset: StoredAsset,
        ): Promise<AssetManifestEntry> => {
            const file = `${asset.assetId}.${asset.format || "bin"}`;
            const handle = await projectDir.getFileHandle(file, {create: true});
            const writable = await handle.createWritable();

            try {
                await writable.write(base64ToBytes(asset.data));
            } finally {
                await writable.close();
            }

            const {data: _omit, ...meta} = asset;

            return {...meta, file};
        };

        const manifest: AssetManifestEntry[] = await Promise.all(
            assets.map(writeAsset),
        );

        const manifestHandle = await projectDir.getFileHandle(ASSET_MANIFEST, {
            create: true,
        });

        const manifestWritable = await manifestHandle.createWritable();

        try {
            await manifestWritable.write(JSON.stringify(manifest, null, 2));
        } finally {
            await manifestWritable.close();
        }
    }

    async loadAssets(projectId: string): Promise<StoredAsset[]> {
        let projectDir: FsDirectoryHandle;

        try {
            projectDir = await this.dir.getDirectoryHandle(projectId);
        } catch (err) {
            if (isNotFoundError(err)) {
                return [];
            }

            throw err;
        }

        let manifest: AssetManifestEntry[];

        try {
            const manifestFile = await (
                await projectDir.getFileHandle(ASSET_MANIFEST)
            ).getFile();

            manifest = JSON.parse(await manifestFile.text()) as AssetManifestEntry[];
        } catch (err) {
            if (isNotFoundError(err)) {
                return [];
            }

            throw new Error(
                `Asset manifest for project "${projectId}" is unreadable or malformed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }

        if (!Array.isArray(manifest)) {
            throw new Error(
                `Asset manifest for project "${projectId}" is not an array`,
            );
        }

        const assets: StoredAsset[] = [];

        for (const entry of manifest) {
            const file = await (
                await projectDir.getFileHandle(entry.file)
            ).getFile();

            const bytes = new Uint8Array(await file.arrayBuffer());
            const {file: _file, ...meta} = entry;

            assets.push({
                ...meta,
                data: bytesToBase64(bytes),
            });
        }

        return assets;
    }

    /**
     * Creates a portable ZIP archive containing the project and its assets.
     */
    async exportToBlob(id: string): Promise<Blob> {
        const body = await this.load(id);
        const assets = await this.loadAssets(id);

        return exportProjectArchive(body, assets);
    }

    /**
     * Restores a ZIP archive or a legacy JSON project.
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
}
