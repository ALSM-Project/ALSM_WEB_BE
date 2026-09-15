export interface ConversionResultFile {
  relativePath: string;
  content: string;
}

export interface ConversionResultBundle {
  conversionJobId: string;
  toolVersion?: string;
  files: ConversionResultFile[];
}
