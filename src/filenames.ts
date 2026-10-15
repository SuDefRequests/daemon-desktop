import type { Task } from "./types";

const extensions: Record<Exclude<Task, "chat">, string> = {
  code: ".py",
  document: ".md",
  presentation: ".md",
  spreadsheet: ".csv",
};

export function documentFilename(prompt: string): string {
  const title = prompt
    .trim()
    .replace(
      /^(?:please\s+)?(?:write|create|generate|make|draft|prepare|produce|save|export)\s+/i,
      "",
    )
    .replace(
      /^(?:(?:a|an|the|short|brief|detailed)\s+)*(?:(?:microsoft\s+)?word\s+(?:file|document)|docx(?:\s+file)?|essay|report|document)\b(?:\s+(?:as|in)\s+(?:a\s+)?(?:word\s+(?:document|file)|docx))?(?:\s+(?:on|about|for|regarding))?\s*/i,
      "",
    );
  return (
    artifactFilename(title, "document")
      .slice(0, -3)
      .split("_")
      .slice(0, 4)
      .join("_")
      .slice(0, 48)
      .replace(/_+$/, "") + ".docx"
  );
}

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

/** Code names describe the task, rather than repeating the request instructions. */
export function codeFilename(
  prompt: string,
  extension: string,
  content: string,
): string {
  if (extension === ".java") {
    // Ignore declarations mentioned in comments or string/character literals.
    const source = content.replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
      " ",
    );
    const declaration =
      /\bpublic\s+(?:(?:abstract|final|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record)\s+([\p{L}\p{N}_$]+)/gu;
    for (const match of source.matchAll(declaration)) {
      const prefix = source.slice(0, match.index);
      if (
        (prefix.match(/\{/g)?.length ?? 0) !==
        (prefix.match(/\}/g)?.length ?? 0)
      )
        continue;
      const name = match[1];
      if (
        !/^[A-Za-z_]\w*$/.test(name) ||
        name.length > 160 ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)
      )
        throw new Error(
          "The Java public type name cannot be saved as a portable filename.",
        );
      return name + extension;
    }
  }
  const named = prompt.match(
    /\bfile\s+(?:named|called)\s+["'`]?([A-Za-z_][\w.-]{0,150}\.[A-Za-z]+)(?=["'`\s.,!?]|$)/i,
  )?.[1];
  if (named?.toLowerCase().endsWith(extension)) {
    let stem = named.slice(0, -extension.length);
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem))
      stem = `daemon_${stem}`;
    return stem + extension;
  }
  const subject = prompt
    .replace(
      /\b(?:open\s+(?:vs\s*code|visual\s+studio\s+code)\s*(?:,|and|then)|(?:in|using)\s+(?:vs\s*code|visual\s+studio\s+code))\b/gi,
      " ",
    )
    .replace(/\bc\+\+/gi, " ")
    .replace(
      /\b(?:please|write|create|generate|make|build|implement|a|an|the|basic|simple|python|javascript|typescript|java|cpp|c|html|css|rust|golang|go|shell|bash|code|program|script|function|class|page|file|in|using|for|to|of|this|that|which|and|then)\b/gi,
      " ",
    )
    .replace(/\b(?:adding|add|summing)\b/gi, "sum")
    .replace(/\b\d+\b/g, " ");
  // Reuse the existing portable-name sanitization and Windows reserved-name guard.
  const words = artifactFilename(
    /[a-z]/i.test(subject) ? subject : "program",
    "code",
  )
    .slice(0, -3)
    .split("_")
    .slice(0, 3);
  const stem =
    extension === ".java" || extension === ".cpp"
      ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join("")
      : words.join("_");
  return stem + extension;
}
