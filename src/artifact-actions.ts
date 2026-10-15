const codeExtensions = new Set([
  "py",
  "js",
  "ts",
  "c",
  "cpp",
  "java",
  "html",
  "css",
  "rs",
  "go",
  "sh",
]);
export function artifactOpenAction(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase() || "";
  if (codeExtensions.has(extension))
    return {
      label: "Open in VS Code",
      title: "Open the saved source in VS Code without running it",
      enabled: true,
    };
  const labels: Record<string, string> = {
    docx: "Open document (default app)",
    pptx: "Open presentation (default app)",
    xlsx: "Open spreadsheet (default app)",
    csv: "Open CSV (default app)",
    pdf: "Open PDF",
    txt: "Open file",
    md: "Open file",
  };
  return {
    label: labels[extension] || "Open file",
    title: labels[extension]
      ? "Open with the system's default application"
      : "Opening this file type is not supported",
    enabled: Boolean(labels[extension]),
  };
}
