// Canonical brain metadata, filename suffixes and permitted outer-fence aliases.
const CODE_LANGUAGES = Object.freeze({
  python: { extension: ".py", fences: ["python", "py"] },
  javascript: { extension: ".js", fences: ["javascript", "js"] },
  typescript: { extension: ".ts", fences: ["typescript", "ts"] },
  c: { extension: ".c", fences: ["c"] },
  cpp: { extension: ".cpp", fences: ["cpp", "c++", "cxx"] },
  java: { extension: ".java", fences: ["java"] },
  html: { extension: ".html", fences: ["html"] },
  css: { extension: ".css", fences: ["css"] },
  rust: { extension: ".rs", fences: ["rust", "rs"] },
  go: { extension: ".go", fences: ["go", "golang"] },
  shell: { extension: ".sh", fences: ["shell", "bash", "sh"] },
});
const CODE_EXTENSIONS = new Set(
  Object.values(CODE_LANGUAGES).map((value) => value.extension),
);
function codeFormat(response) {
  const suffix = response.filename.match(/\.[a-z]+$/i)?.[0].toLowerCase();
  const inferred = Object.keys(CODE_LANGUAGES).find(
    (key) => CODE_LANGUAGES[key].extension === suffix,
  );
  const language = response.language ?? inferred;
  if (!Object.hasOwn(CODE_LANGUAGES, language) || !inferred)
    throw new Error(
      "Code response has an unsupported language or filename extension. No file was saved.",
    );
  const format = CODE_LANGUAGES[language];
  if (format.extension !== suffix)
    throw new Error(
      "Code language and filename extension disagree. No file was saved.",
    );
  return format;
}
module.exports = { CODE_LANGUAGES, CODE_EXTENSIONS, codeFormat };
