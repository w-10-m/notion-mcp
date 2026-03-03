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

// Tool response type
export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

// Pagination parameters shared across many tools
export interface PaginationParams {
  start_cursor?: string;
  page_size?: number;
}

// Database tool parameter types
export interface GetDatabaseParams {
  database_id: string;
}

export interface QueryDatabaseParams extends PaginationParams {
  database_id: string;
  filter?: Record<string, unknown>;
  sorts?: Array<Record<string, unknown>>;
}

export interface CreateDatabaseParams {
  parent: Record<string, unknown>;
  title: Array<Record<string, unknown>>;
  properties: Record<string, unknown>;
  icon?: Record<string, unknown>;
  cover?: Record<string, unknown>;
}

export interface UpdateDatabaseParams {
  database_id: string;
  title?: Array<Record<string, unknown>>;
  properties?: Record<string, unknown>;
  icon?: Record<string, unknown>;
  cover?: Record<string, unknown>;
}

// Page tool parameter types
export interface GetPageParams {
  page_id: string;
}

export interface CreatePageParams {
  parent: Record<string, unknown>;
  properties?: Record<string, unknown>;
  children?: Array<Record<string, unknown>>;
  icon?: Record<string, unknown>;
  cover?: Record<string, unknown>;
}

export interface UpdatePageParams {
  page_id: string;
  properties?: Record<string, unknown>;
  archived?: boolean;
  icon?: Record<string, unknown>;
  cover?: Record<string, unknown>;
}

export interface GetPagePropertyParams extends PaginationParams {
  page_id: string;
  property_id: string;
}

// Block tool parameter types
export interface GetBlockChildrenParams extends PaginationParams {
  block_id: string;
}

export interface AppendBlockChildrenParams {
  block_id: string;
  children: Array<Record<string, unknown>>;
}

export interface GetBlockParams {
  block_id: string;
}

export interface UpdateBlockParams {
  block_id: string;
  [key: string]: unknown;
}

export interface DeleteBlockParams {
  block_id: string;
}

// User tool parameter types
export interface ListUsersParams extends PaginationParams {}

export interface GetUserParams {
  user_id: string;
}

// Search and comment parameter types
export interface SearchParams extends PaginationParams {
  query?: string;
  sort?: Record<string, unknown>;
  filter?: Record<string, unknown>;
}

export interface CreateCommentParams {
  parent: Record<string, unknown>;
  rich_text: Array<Record<string, unknown>>;
}

export interface GetCommentsParams extends PaginationParams {
  block_id: string;
}

// Template tool parameter types
export interface CreatePageFromTemplateParams {
  template_page_id: string;
  parent: Record<string, unknown>;
  title?: string;
  properties?: Record<string, unknown>;
}

export interface CreateDatabaseFromTemplateParams {
  template_database_id: string;
  parent: Record<string, unknown>;
  title: string;
}

// Duplication tool parameter types
export interface DuplicatePageParams {
  page_id: string;
  parent?: Record<string, unknown>;
  title?: string;
}

export interface DuplicateDatabaseParams {
  database_id: string;
  parent?: Record<string, unknown>;
  title?: string;
}