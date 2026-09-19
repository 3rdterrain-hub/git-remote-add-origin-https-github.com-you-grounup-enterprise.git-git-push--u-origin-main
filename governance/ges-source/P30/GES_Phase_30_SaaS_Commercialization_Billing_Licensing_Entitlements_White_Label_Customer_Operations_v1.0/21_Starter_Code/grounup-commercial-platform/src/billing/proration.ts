export interface ProrationInput { periodStart:string; periodEnd:string; changeAt:string; oldAmount:number; newAmount:number; currency:string; }
export interface ProrationResult { credit:number; charge:number; net:number; basis:string; }
export interface ProrationEngine { calculate(input:ProrationInput):ProrationResult; }
