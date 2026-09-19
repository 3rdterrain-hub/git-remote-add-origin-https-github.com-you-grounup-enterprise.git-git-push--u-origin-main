import { RequestContext } from '../context/request-context';
export interface TenantScopedRepository<T> {
  findById(ctx: RequestContext, id: string): Promise<T | null>;
  save(ctx: RequestContext, record: T): Promise<T>;
}
// Implementations MUST scope all business queries/mutations by ctx.tenantId.
