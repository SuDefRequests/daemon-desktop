import type { Task } from "./types";

const extensions: Record<Exclude<Task, "chat">, string> = {
  code: ".py",
  document: ".md",
  presentation: ".md",
  spreadsheet: ".csv",
};

/** Portable filenames: no paths, Windows device names, trailing dots or UUIDs. */
export function artifactFilename(
  title: string,
  kind: Exclude<Task, "chat">,
): string {
  const subject = title
    .trim()
    .replace(
      /^(?:please\s+)?(?:write|create|generate|make|draft|build)\s+/i,
      "",
    )
    .replace(/^(?:a|an)\s+/i, "")
    .replace(
      /^(?:python\s+)?(?:code|script|document|spreadsheet|presentation|notes)\s+(?:to|for|about|on)\s+/i,
      "",
    );
  let stem = subject
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72)
    .replace(/_+$/g, "");
  if (!stem)
    stem =
      kind === "code"
        ? "python_script"
        : kind === "spreadsheet"
          ? "spreadsheet"
          : kind === "presentation"
            ? "presentation_outline"
            : "document";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem))
    stem = `daemon_${stem}`;
  return stem + extensions[kind];
}

export function uniqueFilename(name: string, existing: string[]): string {
  const used = new Set(existing.map((value) => value.toLowerCase()));
  const dot = name.lastIndexOf("."),
    stem = name.slice(0, dot),
    extension = name.slice(dot);
  let candidate = name;
  for (let index = 2; used.has(candidate.toLowerCase()); index++)
    candidate = `${stem}_${index}${extension}`;
  return candidate;
}
