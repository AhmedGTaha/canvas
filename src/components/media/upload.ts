"use client";

/** One file's progress through an upload, in the words the user sees. */
export type UploadStatus = { name: string; state: "uploading" | "done" | "error"; error?: string };

/**
 * Uploads images to a project's media library.
 *
 * Shared by the Images panel and the Assets sidebar so the most common thing
 * anyone does with media — adding some — does not require opening a popup, and
 * does not require a second copy of this to make that true.
 */
export async function uploadMediaFiles(
  projectId: string,
  files: File[],
  folderId: string | null,
  onProgress: (update: (statuses: UploadStatus[]) => UploadStatus[]) => void,
) {
  onProgress(() => files.map((file) => ({ name: file.name, state: "uploading" })));
  await Promise.all(files.map(async (file, index) => {
    const data = new FormData();
    data.set("file", file);
    if (folderId) data.set("folderId", folderId);
    try {
      const response = await fetch(`/api/projects/${projectId}/media`, { method: "POST", body: data });
      const result = await response.json() as { error?: string };
      onProgress((statuses) => statuses.map((status, position) => position === index ? { ...status, state: response.ok ? "done" : "error", error: result.error } : status));
    } catch {
      onProgress((statuses) => statuses.map((status, position) => position === index ? { ...status, state: "error", error: "Network error." } : status));
    }
  }));
}
