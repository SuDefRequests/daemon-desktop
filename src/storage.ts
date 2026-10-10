import type { Artifact, Workspace } from "./types";
import { uniqueFilename } from "./filenames";
const key = "daemon-workspace-v1";
export const emptyWorkspace = (): Workspace => ({
  conversations: [],
  artifacts: [],
});
export async function loadWorkspace(): Promise<Workspace> {
  const data = window.daemon
    ? await window.daemon.load()
    : JSON.parse(localStorage.getItem(key) || "null");
  if (!data) return emptyWorkspace();
  if (!Array.isArray(data.conversations) || !Array.isArray(data.artifacts))
    throw new Error("Saved workspace is invalid.");
  for (const chat of data.conversations) {
    if (
      !chat ||
      typeof chat.id !== "string" ||
      typeof chat.title !== "string" ||
      typeof chat.updatedAt !== "string" ||
      !Array.isArray(chat.messages)
    )
      throw new Error("Saved conversation is invalid.");
    for (const message of chat.messages) {
      if (
        !message ||
        typeof message.id !== "string" ||
        typeof message.content !== "string" ||
        typeof message.createdAt !== "string" ||
        !["user", "assistant"].includes(message.role)
      )
        throw new Error("Saved message is invalid.");
    }
  }
  for (const artifact of data.artifacts) {
    if (
      !artifact ||
      typeof artifact.id !== "string" ||
      typeof artifact.name !== "string" ||
      typeof artifact.content !== "string" ||
      typeof artifact.createdAt !== "string"
    )
      throw new Error("Saved artifact is invalid.");
  }
  return data;
}
export async function saveWorkspace(data: Workspace) {
  if (window.daemon) await window.daemon.save(data);
  else localStorage.setItem(key, JSON.stringify(data));
}
export async function saveArtifact(
  artifact: Artifact,
  existing: Artifact[] = [],
) {
  return window.daemon
    ? window.daemon.saveArtifact(artifact)
    : {
        ...artifact,
        name: uniqueFilename(
          artifact.name,
          existing.map((a) => a.name),
        ),
      };
}
export function downloadArtifact(artifact: Artifact) {
  const url = URL.createObjectURL(
    new Blob([artifact.content], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = artifact.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
