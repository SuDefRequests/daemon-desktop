import type { Artifact, Workspace, UserPreferences } from "./types";
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

const settingsKey = "daemon-settings-v1";
function browserSettings(): Record<string, unknown> {
  const settings = JSON.parse(localStorage.getItem(settingsKey) || "{}");
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error("Saved preferences are invalid.");
  return settings;
}
function preferredName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error(
      "Preferred name must be at most 80 characters without control characters.",
    );
  return value.trim();
}
const restartPreferences =
  "Close VIDUR AI completely and restart it to load the updated preferences service.";
function preferenceServiceError(error: unknown): never {
  if (/No handler registered.*preferences:/i.test((error as Error).message))
    throw new Error(restartPreferences);
  throw error;
}
export async function loadPreferences(): Promise<UserPreferences> {
  if (window.daemon) {
    if (typeof window.daemon.getPreferences !== "function")
      throw new Error(restartPreferences);
    try {
      return await window.daemon.getPreferences();
    } catch (error) {
      return preferenceServiceError(error);
    }
  }
  return {
    preferredName: preferredName(browserSettings().preferredName ?? ""),
  };
}
export async function savePreferredName(
  value: string,
): Promise<UserPreferences> {
  const name = preferredName(value);
  if (window.daemon) {
    if (typeof window.daemon.setPreferredName !== "function")
      throw new Error(restartPreferences);
    try {
      return await window.daemon.setPreferredName(name);
    } catch (error) {
      return preferenceServiceError(error);
    }
  }
  const next = { ...browserSettings(), preferredName: name };
  localStorage.setItem(settingsKey, JSON.stringify(next));
  return { preferredName: name };
}
