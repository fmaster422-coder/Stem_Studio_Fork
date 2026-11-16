
import JSZip from "jszip";

import type {ProjectBody, StoredAsset} from "./types";

const ARCHIVE_FORMAT = "stemstudio-project";
const ARCHIVE_VERSION = 1;
const PROJECT_FILE = "project.json";

type ArchiveAssetEntry = Omit<StoredAsset, "data" | "thumbnailData"> & {
    dataFile: string;
    thumbnailFile?: string;
};

type ProjectArchiveManifest = {
    format: typeof ARCHIVE_FORMAT;
    version: typeof ARCHIVE_VERSION;
    project: ProjectBody;
    assets: ArchiveAssetEntry[];
};

export type ImportedProjectArchive = {
    project: ProjectBody;
    assets: StoredAsset[];
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
};

const isValidProjectBody = (value: unknown): value is ProjectBody => {
    if (!value || typeof value !== "object") return false;

    const candidate = value as Partial<ProjectBody>;

    return (
        typeof candidate.sceneJson === "string" &&
        candidate.sceneJson.length > 0 &&
        typeof candidate.meta === "object" &&
        candidate.meta !== null &&
        typeof candidate.meta.name === "string"
    );
};

const isSafeArchivePath = (path: unknown): path is string =>
    typeof path === "string" &&
    path.startsWith("assets/") &&
    !path.includes("..") &&
    !path.startsWith("/") &&
    !path.includes("\\");

const importLegacyJson = async (blob: Blob): Promise<ImportedProjectArchive> => {
    let parsed: unknown;

    try {
        parsed = JSON.parse(await blob.text());
    } catch {
        throw new Error("The selected file is not a valid Stem Studio project.");
    }

    if (!isValidProjectBody(parsed)) {
        throw new Error("The selected file does not contain a valid Stem Studio project.");
    }

    return {
        project: parsed,
        assets: [],
    };
};

export const exportProjectArchive = async (
    project: ProjectBody,
    assets: StoredAsset[],
): Promise<Blob> => {
    const zip = new JSZip();

    const manifestAssets: ArchiveAssetEntry[] = [];

    for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index]!;
        const dataFile = `assets/${index}.bin`;
        const thumbnailFile = asset.thumbnailData
            ? `assets/${index}.thumb`
            : undefined;

        const {data, thumbnailData, ...metadata} = asset;

        if (typeof data !== "string") {
            throw new Error(`Asset "${asset.name}" has no valid binary data.`);
        }

        zip.file(dataFile, base64ToBytes(data), {
            binary: true,
            compression: "STORE",
        });

        if (thumbnailData && thumbnailFile) {
            zip.file(thumbnailFile, base64ToBytes(thumbnailData), {
                binary: true,
                compression: "STORE",
            });
        }

        manifestAssets.push({
            ...metadata,
            dataFile,
            ...(thumbnailFile ? {thumbnailFile} : {}),
        });
    }

    const manifest: ProjectArchiveManifest = {
        format: ARCHIVE_FORMAT,
        version: ARCHIVE_VERSION,
        project,
        assets: manifestAssets,
    };

    zip.file(PROJECT_FILE, JSON.stringify(manifest, null, 2), {
        compression: "DEFLATE",
        compressionOptions: {level: 1},
    });

    return zip.generateAsync({
        type: "blob",
        mimeType: "application/zip",
        compression: "DEFLATE",
        compressionOptions: {level: 1},
    });
};

export const importProjectArchive = async (
    blob: Blob,
): Promise<ImportedProjectArchive> => {
    const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());

    // Older exports were plain JSON files. Keep them importable.
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
        return importLegacyJson(blob);
    }

    let zip: JSZip;

    try {
        zip = await JSZip.loadAsync(blob);
    } catch {
        throw new Error("The project ZIP archive is damaged or unreadable.");
    }

    const manifestFile = zip.file(PROJECT_FILE);

    if (!manifestFile) {
        throw new Error("The ZIP archive does not contain project.json.");
    }

    let manifest: unknown;

    try {
        manifest = JSON.parse(await manifestFile.async("string"));
    } catch {
        throw new Error("The project archive manifest is invalid.");
    }

    if (!manifest || typeof manifest !== "object") {
        throw new Error("The project archive manifest is invalid.");
    }

    const candidate = manifest as Partial<ProjectArchiveManifest>;

    if (
        candidate.format !== ARCHIVE_FORMAT ||
        candidate.version !== ARCHIVE_VERSION ||
        !isValidProjectBody(candidate.project) ||
        !Array.isArray(candidate.assets)
    ) {
        throw new Error("Unsupported or invalid Stem Studio project archive.");
    }

    const restoredAssets: StoredAsset[] = [];

    for (const rawEntry of candidate.assets) {
        if (!rawEntry || typeof rawEntry !== "object") {
            throw new Error("The archive contains invalid asset metadata.");
        }

        const entry = rawEntry as ArchiveAssetEntry;

        if (!isSafeArchivePath(entry.dataFile)) {
            throw new Error("The archive contains an invalid asset path.");
        }

        const dataFile = zip.file(entry.dataFile);

        if (!dataFile) {
            throw new Error(`The archive is missing asset data: ${entry.name || entry.assetId}.`);
        }

        const data = bytesToBase64(await dataFile.async("uint8array"));

        let thumbnailData: string | undefined;

        if (entry.thumbnailFile) {
            if (!isSafeArchivePath(entry.thumbnailFile)) {
                throw new Error("The archive contains an invalid thumbnail path.");
            }

            const thumbnailFile = zip.file(entry.thumbnailFile);

            if (!thumbnailFile) {
                throw new Error(`The archive is missing a thumbnail for ${entry.name}.`);
            }

            thumbnailData = bytesToBase64(await thumbnailFile.async("uint8array"));
        }

        const {
            dataFile: _dataFile,
            thumbnailFile: _thumbnailFile,
            ...metadata
        } = entry;

        restoredAssets.push({
            ...metadata,
            data,
            ...(thumbnailData ? {thumbnailData} : {}),
        });
    }

    return {
        project: candidate.project,
        assets: restoredAssets,
    };
};
