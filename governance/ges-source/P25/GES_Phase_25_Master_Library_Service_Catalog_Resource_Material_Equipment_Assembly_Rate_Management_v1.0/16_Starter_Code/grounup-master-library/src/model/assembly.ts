export type AssemblyComponentType = 'labor' | 'crew' | 'equipment' | 'truck' | 'material' | 'subcontract' | 'disposal' | 'assembly';
export interface AssemblyComponent {
  componentId: string;
  type: AssemblyComponentType;
  libraryRecordId: string;
  quantity: number;
  unit: string;
  wasteFactor?: number;
  conditionModifierIds?: string[];
}
export interface AssemblyDefinition {
  assemblyId: string;
  code: string;
  name: string;
  outputUnit: string;
  components: AssemblyComponent[];
}
