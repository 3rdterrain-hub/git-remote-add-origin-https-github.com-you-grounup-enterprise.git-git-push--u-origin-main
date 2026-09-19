import { AnalyticsSecurityContext } from '../security/analytics-context';
export interface SemanticQuery { metricIds:string[]; dimensions:string[]; filters:Record<string,unknown>; timeRange?:{from:string;to:string}; }
export interface SemanticResult { metricVersions:Record<string,number>; data:unknown[]; freshness:Record<string,string>; lineageIds:string[]; warnings:string[]; }
export interface SemanticQueryEngine { execute(ctx:AnalyticsSecurityContext, query:SemanticQuery):Promise<SemanticResult>; }
