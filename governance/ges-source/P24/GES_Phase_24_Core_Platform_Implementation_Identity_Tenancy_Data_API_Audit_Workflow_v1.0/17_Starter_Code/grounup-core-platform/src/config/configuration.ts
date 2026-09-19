import { RequestContext } from '../context/request-context';
export interface EffectiveConfiguration { values: Record<string, unknown>; version: string; }
export interface ConfigurationProvider { resolve(ctx: RequestContext): Promise<EffectiveConfiguration>; }
