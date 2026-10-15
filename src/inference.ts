import type { DesktopAPI, InferenceProvider, ProviderMode } from "./types";
import { mockProvider } from "./mock";
import { artifactFilename, codeFilename } from "./filenames";

export function createProvider(
  mode: ProviderMode,
  desktop?: DesktopAPI,
): InferenceProvider {
  if (mode === "mock") return mockProvider;
  if (mode !== "android") throw new Error("Unsupported inference provider.");
  return {
    mode: "android",
    async generate({ prompt }) {
      if (!desktop)
        throw new Error(
          "Android inference requires Electron. Use mock mode in browser preview.",
        );
      // Only the prompt crosses IPC. Task, model and thinking preferences stay in the UI.
      const result = await desktop.generate(prompt);
      if (!result.file) return { reply: result.reply };
      return {
        ...result,
        file: result.file
          ? {
              content: result.file.content,
              kind: result.file.kind,
              name:
                result.file.kind === "code"
                  ? codeFilename(
                      prompt,
                      result.file.extension,
                      result.file.content,
                    )
                  : artifactFilename(prompt, result.file.kind).replace(
                      /\.[^.]+$/,
                      result.file.extension,
                    ),
            }
          : undefined,
      };
    },
  };
}
export async function configuredProvider(
  desktop = window.daemon,
): Promise<InferenceProvider> {
  return createProvider(
    desktop ? (await desktop.getInferenceConfig()).provider : "mock",
    desktop,
  );
}
