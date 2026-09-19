export interface ApiError {
  code: string;
  message: string;
  correlationId: string;
  details?: Record<string, unknown>;
}
