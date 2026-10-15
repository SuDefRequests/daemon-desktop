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
export type PresentationStatus = "complete" | "partial" | "unknown";
export interface InferenceRequest {
  prompt: string;
  task: Task;
}
export interface InferenceResult {
  reply: string;
  files?: NonNullable<InferenceResult["file"]>[];
  file?: {
    name: string;
    content: string;
    kind: Exclude<Task, "chat">;
    presentationStatus?: PresentationStatus;
  };
}
export interface BrainResult {
  reply: string;
  files?: NonNullable<BrainResult["file"]>[];
  file?: {
    presentationStatus?: PresentationStatus;
    content: string;
    kind: Exclude<Task, "chat">;
    extension:
      | ".py"
      | ".js"
      | ".ts"
      | ".c"
      | ".cpp"
      | ".java"
      | ".html"
      | ".css"
      | ".rs"
      | ".go"
      | ".sh"
      | ".txt"
      | ".csv"
      | ".pptx"
      | ".docx"
      | ".md";
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
  artifactIds?: string[];
  source?: ProviderMode;
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}
export interface Artifact {
  presentationStatus?: PresentationStatus;
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
export interface OpenResult {
  status: "requested" | "failed" | "already-saved";
  message: string;
}
export interface SavedArtifact extends Artifact {
  opening?: OpenResult;
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
  saveArtifact(artifact: Artifact): Promise<SavedArtifact>;
  readPresentation(id: string): Promise<ArrayBuffer>;
  readDocument(id: string): Promise<ArrayBuffer>;
  openArtifact(id: string): Promise<OpenResult>;
  revealArtifact(id: string): Promise<void>;
  getOutputDirectory(): Promise<string>;
  chooseOutputDirectory(): Promise<string | null>;
}
declare global {
  interface Window {
    daemon?: DesktopAPI;
  }
}
