import type { ModelInfo } from "./types";
export const models: ModelInfo[] = [
  {
    id: "qwen-local",
    name: "Qwen2.5 0.5B",
    description: "Best for daily work reasoning and coding tasks",
    configured: true,
  },
  {
    id: "daemon-compact",
    name: "VIDUR AI Compact",
    description: "For complex tasks",
    configured: false,
  },
];
export const thinkingModes = ["Low", "Middle", "Extended"] as const;
export type ThinkingMode = (typeof thinkingModes)[number];
