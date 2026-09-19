export interface EstimateSuggestion {
  suggestionId:string;
  type:'service-map'|'assumption'|'risk'|'crew-option'|'equipment-option'|'missing-input';
  evidenceIds:string[];
  confidence?:number;
  proposedValue?:unknown;
  requiresHumanReview:true;
}
// Suggestions never mutate/freeze/approve authoritative estimate state.
