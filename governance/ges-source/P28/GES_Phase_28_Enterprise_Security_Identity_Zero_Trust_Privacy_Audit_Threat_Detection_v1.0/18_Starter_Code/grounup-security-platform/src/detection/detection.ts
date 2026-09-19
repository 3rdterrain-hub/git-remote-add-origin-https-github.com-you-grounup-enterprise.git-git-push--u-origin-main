import { SecurityEvent } from '../telemetry/security-event';
export interface DetectionResult {
  matched:boolean; ruleId:string; severity:'low'|'medium'|'high'|'critical';
  reason?:string; evidenceEventIds:string[];
}
export interface DetectionRule {
  evaluate(event:SecurityEvent):Promise<DetectionResult>;
}
