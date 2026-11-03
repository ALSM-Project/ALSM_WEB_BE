import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CONTRACT_TEMPLATE_REPOSITORY, ContractTemplateRepository, ContractTemplateSection } from '../domain/contract-template.types';
import { CONTRACT_TEMPLATE_UNIT_OF_WORK, ContractTemplateUnitOfWork } from './contract-template-unit-of-work.port';

@Injectable()
export class ContractTemplateService {
  constructor(
    @Inject(CONTRACT_TEMPLATE_REPOSITORY) private readonly templates: ContractTemplateRepository,
    @Inject(CONTRACT_TEMPLATE_UNIT_OF_WORK) private readonly unitOfWork: ContractTemplateUnitOfWork,
  ) {}

  async listApproved() {
    return this.templates.listApproved();
  }

  async listAllVersions() {
    return this.templates.listAllVersions();
  }

  async listVersions(templateId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(templateId)) throw new BadRequestException({ code: 'INVALID_TEMPLATE_ID', message: 'Enter a valid template identifier.' });
    return this.templates.listByTemplateId(templateId);
  }

  async createVersion(input: {
    templateId?: string;
    title: string;
    locale: 'vi' | 'en' | 'vi-en';
    sections: ContractTemplateSection[];
    allowCreate?: boolean;
    actor: AuthenticatedUser;
  }) {
    const title = input.title?.trim() ?? '';
    const sections = this.validateSections(input.sections);
    if (title.length < 3 || title.length > 160) throw new BadRequestException({ code: 'INVALID_TEMPLATE_TITLE', message: 'Enter a template title between 3 and 160 characters.' });
    if (!['vi', 'en', 'vi-en'].includes(input.locale)) throw new BadRequestException({ code: 'INVALID_TEMPLATE_LOCALE', message: 'Select Vietnamese, English, or bilingual content.' });
    const templateId = input.templateId ?? randomUUID();
    if (!/^[0-9a-f-]{36}$/i.test(templateId)) throw new BadRequestException({ code: 'INVALID_TEMPLATE_ID', message: 'Enter a valid template identifier.' });
    const contentDigest = this.digest(title, input.locale, sections);
    return this.unitOfWork.run(async ({ templates, audit }) => {
      const latest = await templates.latestVersion(templateId);
      if (input.templateId && !latest && !input.allowCreate) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: 'The template is unavailable.' });
      if (latest?.status === 'DRAFT') {
        if (latest.createdByUserId === input.actor.userId && latest.contentDigest === contentDigest) return latest;
        throw new ConflictException({ code: 'TEMPLATE_DRAFT_PENDING', message: 'Approve or reject the existing draft before creating another version.' });
      }
      const now = new Date();
      const created = await templates.createVersion({
        templateId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        title,
        locale: input.locale,
        sections,
        contentDigest,
        createdByUserId: input.actor.userId,
        now,
      });
      await audit.appendOnce(`contract-template-created:${created.id}`, {
        actorUserId: input.actor.userId,
        action: 'CONTRACT_TEMPLATE_VERSION_CREATED',
        resourceType: 'CONTRACT_TEMPLATE_VERSION',
        resourceId: created.id,
        metadata: { templateId, versionNumber: String(created.versionNumber), contentDigest },
      });
      return created;
    }, `contract-template:${templateId}`);
  }

  async approve(input: { versionId: string; actor: AuthenticatedUser }) {
    if (!/^[a-f\d]{24}$/i.test(input.versionId)) throw new BadRequestException({ code: 'INVALID_TEMPLATE_VERSION_ID', message: 'Enter a valid template version identifier.' });
    return this.unitOfWork.run(async ({ templates, audit }) => {
      const approved = await templates.approve({ id: input.versionId, reviewerUserId: input.actor.userId, now: new Date() });
      if (!approved) throw new ConflictException({ code: 'TEMPLATE_APPROVAL_CONFLICT', message: 'The template version is unavailable, already approved, or must be approved by a different user.' });
      await audit.appendOnce(`contract-template-approved:${approved.id}`, {
        actorUserId: input.actor.userId,
        action: 'CONTRACT_TEMPLATE_VERSION_APPROVED',
        resourceType: 'CONTRACT_TEMPLATE_VERSION',
        resourceId: approved.id,
        metadata: { templateId: approved.templateId, versionNumber: String(approved.versionNumber), contentDigest: approved.contentDigest },
      });
      return approved;
    }, `contract-template-approve:${input.versionId}`);
  }

  async reject(input: { versionId: string; reason: string; actor: AuthenticatedUser }) {
    if (!/^[a-f\d]{24}$/i.test(input.versionId)) throw new BadRequestException({ code: 'INVALID_TEMPLATE_VERSION_ID', message: 'Enter a valid template version identifier.' });
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 5 || reason.length > 1000) throw new BadRequestException({ code: 'TEMPLATE_REJECTION_REASON_REQUIRED', message: 'Provide a rejection reason between 5 and 1000 characters.' });
    return this.unitOfWork.run(async ({ templates, audit }) => {
      const rejected = await templates.reject({ id: input.versionId, reviewerUserId: input.actor.userId, reason, now: new Date() });
      if (!rejected) throw new ConflictException({ code: 'TEMPLATE_REJECTION_CONFLICT', message: 'The draft is unavailable or must be reviewed by a different user.' });
      await audit.appendOnce(`contract-template-rejected:${rejected.id}`, {
        actorUserId: input.actor.userId,
        action: 'CONTRACT_TEMPLATE_VERSION_REJECTED',
        resourceType: 'CONTRACT_TEMPLATE_VERSION',
        resourceId: rejected.id,
        metadata: { templateId: rejected.templateId, versionNumber: String(rejected.versionNumber), contentDigest: rejected.contentDigest, reason },
      });
      return rejected;
    }, `contract-template-reject:${input.versionId}`);
  }

  async requireApprovedVersion(versionId: string) {
    const version = await this.templates.findApprovedById(versionId);
    if (!version) throw new ConflictException({ code: 'APPROVED_TEMPLATE_REQUIRED', message: 'Select an approved legal contract template version.' });
    const contentDigest = this.digest(version.title, version.locale, version.sections);
    if (contentDigest !== version.contentDigest) {
      throw new ServiceUnavailableException({ code: 'CONTRACT_TEMPLATE_INTEGRITY_FAILURE', message: 'The approved contract template failed its integrity check.' });
    }
    return version;
  }

  private digest(title: string, locale: 'vi' | 'en' | 'vi-en', sections: ContractTemplateSection[]) {
    return createHash('sha256').update(JSON.stringify({ title, locale, sections })).digest('hex');
  }

  private validateSections(value: ContractTemplateSection[]): ContractTemplateSection[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 40) throw new BadRequestException({ code: 'INVALID_TEMPLATE_SECTIONS', message: 'A template must contain between 1 and 40 sections.' });
    let totalCharacters = 0;
    const sections = value.map((section) => {
      const heading = typeof section?.heading === 'string' ? section.heading.trim() : '';
      const body = typeof section?.body === 'string' ? section.body.trim() : '';
      if (!heading || heading.length > 120 || !body || body.length > 20000 || /<\/?[a-z][^>]*>/i.test(body)) {
        throw new BadRequestException({ code: 'INVALID_TEMPLATE_SECTION', message: 'Each section needs a heading and plain-text body within the allowed length.' });
      }
      totalCharacters += heading.length + body.length;
      return { heading, body };
    });
    if (totalCharacters > 100000) throw new BadRequestException({ code: 'TEMPLATE_TOO_LARGE', message: 'The template content exceeds the allowed size.' });
    return sections;
  }
}
