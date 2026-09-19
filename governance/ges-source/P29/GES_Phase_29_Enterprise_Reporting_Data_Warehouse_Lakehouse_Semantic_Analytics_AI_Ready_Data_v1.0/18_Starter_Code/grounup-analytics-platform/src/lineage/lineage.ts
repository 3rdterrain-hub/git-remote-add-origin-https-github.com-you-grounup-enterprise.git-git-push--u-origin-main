export interface LineageEdge { fromAssetId:string; toAssetId:string; transformationVersionId?:string; fromColumn?:string; toColumn?:string; }
export interface LineageGraph { edges:LineageEdge[]; }
