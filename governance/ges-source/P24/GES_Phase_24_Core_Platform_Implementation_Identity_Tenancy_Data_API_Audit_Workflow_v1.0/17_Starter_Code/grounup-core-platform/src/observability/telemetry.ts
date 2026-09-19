import { RequestContext } from '../context/request-context';
export interface Telemetry {
  info(ctx: RequestContext, message: string, fields?: Record<string, unknown>): void;
  error(ctx: RequestContext, message: string, fields?: Record<string, unknown>): void;
  metric(name: string, value: number, tags?: Record<string, string>): void;
}
