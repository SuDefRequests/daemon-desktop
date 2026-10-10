import type { ModelInfo } from "./types";
export const models: ModelInfo[] = [
  {
    id: "qwen-local",
    name: "Qwen2.5 0.5B",
    description: "Local · demo selection; backend model unchanged",
    configured: true,
  },
  {
    id: "daemon-compact",
    name: "DAEMON Compact",
    description: "Demo option · no additional model installed",
    configured: false,
  },
];
export const thinkingModes = ["Low", "Middle", "Extended"] as const;
export type ThinkingMode = (typeof thinkingModes)[number];
