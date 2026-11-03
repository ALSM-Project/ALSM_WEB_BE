import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ContractTemplateStatus } from '../domain/contract-template.types';

@Schema({ _id: false })
export class ContractTemplateSectionDocument {
  @Prop({ required: true, trim: true, maxlength: 120 }) heading!: string;
  @Prop({ required: true, trim: true, maxlength: 20000 }) body!: string;
}

@Schema({ collection: 'contract_template_versions', timestamps: true })
export class ContractTemplateVersionDocument {
  @Prop({ required: true, index: true }) templateId!: string;
  @Prop({ required: true, min: 1 }) versionNumber!: number;
  @Prop({ required: true, trim: true, maxlength: 160 }) title!: string;
  @Prop({ required: true, enum: ['vi', 'en', 'vi-en'] }) locale!: 'vi' | 'en' | 'vi-en';
  @Prop({ type: [ContractTemplateSectionDocument], required: true }) sections!: ContractTemplateSectionDocument[];
  @Prop({ required: true, enum: ['DRAFT', 'APPROVED', 'REJECTED'], default: 'DRAFT', index: true }) status!: ContractTemplateStatus;
  @Prop({ required: true, match: /^[a-f0-9]{64}$/i }) contentDigest!: string;
  @Prop({ required: true }) createdByUserId!: string;
  @Prop() approvedByUserId?: string;
  @Prop() approvedAt?: Date;
  @Prop() rejectedByUserId?: string;
  @Prop() rejectedAt?: Date;
  @Prop({ maxlength: 1000 }) rejectionReason?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export type ContractTemplateVersionMongoDocument = HydratedDocument<ContractTemplateVersionDocument>;
export const ContractTemplateVersionSchema = SchemaFactory.createForClass(ContractTemplateVersionDocument);
ContractTemplateVersionSchema.index(
  { templateId: 1, versionNumber: 1 },
  { unique: true, name: 'contract_template_version_unique' },
);
ContractTemplateVersionSchema.index({ status: 1, updatedAt: -1 }, { name: 'approved_contract_templates' });
