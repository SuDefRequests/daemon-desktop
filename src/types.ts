export type Task =
  "code" | "document" | "presentation" | "spreadsheet" | "chat";
export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  configured: boolean;
}
export interface ConnectionStatus {
  state:
    | "unknown"
    | "mock"
    | "adb-missing"
    | "disconnected"
    | "unauthorized"
    | "device-unavailable"
    | "forward-error"
    | "brain-unavailable"
    | "connected";
  label: string;
  detail: string;
}
export type ProviderMode = "mock" | "android";
export interface InferenceRequest {
  prompt: string;
  task: Task;
}
export interface InferenceResult {
  reply: string;
  file?: { name: string; content: string; kind: Exclude<Task, "chat"> };
}
export interface BrainResult {
  reply: string;
  file?: {
    content: string;
    kind: Exclude<Task, "chat">;
    extension: ".py" | ".txt" | ".csv" | ".md";
  };
}
export interface InferenceProvider {
  mode: ProviderMode;
  generate(request: InferenceRequest): Promise<InferenceResult>;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  artifactId?: string;
  source?: ProviderMode;
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}
export interface Artifact {
  id: string;
  conversationId: string;
  name: string;
  kind: Task;
  content: string;
  createdAt: string;
  path?: string;
  source?: ProviderMode;
}
export interface Workspace {
  conversations: Conversation[];
  artifacts: Artifact[];
}
export interface UserPreferences {
  preferredName: string;
}
export interface DesktopAPI {
  getPreferences(): Promise<UserPreferences>;
  setPreferredName(name: string): Promise<UserPreferences>;
  getDeviceStatus(): Promise<ConnectionStatus>;
  refreshDeviceStatus(): Promise<ConnectionStatus>;
  onDeviceStatus(callback: (status: ConnectionStatus) => void): () => void;
  getInferenceConfig(): Promise<{ provider: ProviderMode }>;
  generate(prompt: string): Promise<BrainResult>;
  load(): Promise<Workspace>;
  save(data: Workspace): Promise<void>;
  saveArtifact(artifact: Artifact): Promise<Artifact>;
  openArtifact(id: string): Promise<void>;
  revealArtifact(id: string): Promise<void>;
  getOutputDirectory(): Promise<string>;
  chooseOutputDirectory(): Promise<string | null>;
}
declare global {
  interface Window {
    daemon?: DesktopAPI;
  }
}
