
export interface ServerConfig {
  name: string;
  version: string;
}

// Request tracking and cancellation types
export interface RequestContext {
  requestId: string;
  abortController: AbortController;
  progressToken?: string | number;
  startTime: number;
  toolName?: string;
}

// Progress notification types
export interface ProgressUpdate {
  progress: number;
  total?: number;
  message?: string;
}

export interface ProgressCallback {
  (update: ProgressUpdate): Promise<void>;
}

// Extended client options with cancellation and progress support
export interface RequestOptions {
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  progressInterval?: number;
}