import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { buildContractDocumentData, FormattedDocumentData } from './enterprise-contract-document.helper';
import { Connection, Types } from 'mongoose';
import { ModuleRef } from '@nestjs/core';
import { PaymentService } from '../../billing/application/payment.service';
import { createHash, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../../../shared/mail/mail.service';
import { generateCleanBankQrDataUrl } from '../../../shared/utils/bank-qr.helper';
import {
  CreateEnterpriseContractDto,
  ReviewContractDto,
  CustomerDecisionDto,
  SignContractDto,
  AmendContractDto,
  TerminateContractDto,
  SubmitContractPaymentDto,
  ConfirmContractPaymentDto,
  GenerateContractFromPackageDto,
} from '../domain/enterprise-contract.dto';
import {
  STANDARD_LEGAL_ARTICLES,
  CONTRACT_TITLES,
  SERVICE_MODE_EXPLANATIONS,
  CONTRACT_APPENDICES,
} from '../domain/enterprise-contract-legal.constants';
import { EnterpriseContractValidator } from '../domain/enterprise-contract-validation';
import { numberToVietnameseWords } from './enterprise-contract-pdf.service';

export const DEFAULT_LEGAL_CLAUSES = STANDARD_LEGAL_ARTICLES.map((a) => ({
  articleNumber: a.articleNumber,
  category: a.category,
  title: a.titleEn || a.titleVi,
  titleVi: a.titleVi,
  titleEn: a.titleEn,
  description: a.contentEn || a.contentVi,
  descriptionVi: a.contentVi,
  descriptionEn: a.contentEn,
  legalReference: a.legalReference,
  isMandatory: a.isMandatory,
}));

@Injectable()
export class EnterpriseContractService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Optional() private readonly mailService?: MailService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private get contractsCol() {
    return this.connection.db!.collection('contracts');
  }

  private get orgsCol() {
    return this.connection.db!.collection('organizations');
  }

  private get leadsCol() {
    return this.connection.db!.collection('leads');
  }

  private get projectsCol() {
    return this.connection.db!.collection('projects');
  }

  private get invoicesCol() {
    return this.connection.db!.collection('invoices');
  }

  private get subscriptionsCol() {
    return this.connection.db!.collection('subscriptions');
  }

  private get paymentsCol() {
    return this.connection.db!.collection('payments');
  }

  private get usersCol() {
    return this.connection.db!.collection('users');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. DASHBOARD STATS
  // ─────────────────────────────────────────────────────────────────────────────
  async getDashboardStats(params?: {
    organizationId?: string;
    userId?: string;
    userEmail?: string;
    isPlatformAdmin?: boolean;
  }) {
    const filter = await this.buildTenancyFilter(params || {});
    const all = await this.contractsCol
      .find(filter, {
        projection: {
          lifecycleStatus: 1,
          reviewStatus: 1,
          status: 1,
          activationStatus: 1,
          endDate: 1,
          totalValue: 1,
        },
      })
      .toArray();
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const stats = {
      total: all.length,
      draft: all.filter((c) => c.lifecycleStatus === 'DRAFT').length,
      underReview: all.filter(
        (c) => c.lifecycleStatus === 'INTERNAL_REVIEW' || c.reviewStatus === 'PENDING',
      ).length,
      pendingSignature: all.filter((c) =>
        ['READY_FOR_SIGNATURE', 'SENT_TO_CUSTOMER', 'ALSM_SIGNED', 'CUSTOMER_VIEWED'].includes(
          c.lifecycleStatus,
        ),
      ).length,
      active: all.filter(
        (c) =>
          c.lifecycleStatus === 'COMPLETED' ||
          c.activationStatus === 'COMPLETED' ||
          c.status === 'ACTIVE',
      ).length,
      expiringSoon: all.filter((c) => {
        if (!c.endDate) return false;
        const end = new Date(c.endDate);
        return end >= now && end <= in30Days && c.status === 'ACTIVE';
      }).length,
      terminated: all.filter((c) =>
        ['TERMINATED', 'CANCELLED', 'REJECTED'].includes(c.lifecycleStatus || c.status),
      ).length,
      totalValueVnd: all
        .filter((c) => c.status === 'ACTIVE' || c.lifecycleStatus === 'COMPLETED')
        .reduce((sum, c) => sum + (c.totalValue || 0), 0),
    };

    return stats;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. LIST CONTRACTS WITH TABS & FILTERS
  // ─────────────────────────────────────────────────────────────────────────────
  async listContracts(params: {
    tab?: string;
    serviceMode?: string;
    search?: string;
    organizationId?: string;
    userId?: string;
    userEmail?: string;
    isPlatformAdmin?: boolean;
    page?: number;
    limit?: number;
  }) {
    const tenancyFilter = await this.buildTenancyFilter({
      organizationId: params.organizationId,
      userId: params.userId,
      userEmail: params.userEmail,
      isPlatformAdmin: params.isPlatformAdmin,
    });

    const andConditions: any[] = [];
    if (Object.keys(tenancyFilter).length > 0) {
      andConditions.push(tenancyFilter);
    }

    // Service Mode filter
    if (params.serviceMode && params.serviceMode !== 'ALL') {
      andConditions.push({ serviceMode: params.serviceMode });
    }

    // Status Tab filter
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const tabUpper = (params.tab || 'ALL').toUpperCase();

    if (tabUpper === 'DRAFT') {
      andConditions.push({ lifecycleStatus: 'DRAFT' });
    } else if (tabUpper === 'UNDER_REVIEW') {
      andConditions.push({
        $or: [{ lifecycleStatus: 'INTERNAL_REVIEW' }, { reviewStatus: 'PENDING' }],
      });
    } else if (tabUpper === 'PENDING_SIGNATURE') {
      andConditions.push({
        $or: [
          { 'signingProcess.customerSigningStatus': { $ne: 'SIGNED' } },
          { lifecycleStatus: { $in: ['READY_FOR_SIGNATURE', 'SENT_TO_CUSTOMER', 'ALSM_SIGNED', 'CUSTOMER_VIEWED', 'DRAFT'] } },
        ],
        status: { $ne: 'ACTIVE' },
      });
    } else if (tabUpper === 'SIGNED') {
      andConditions.push({
        $or: [
          { 'signingProcess.customerSigningStatus': 'SIGNED' },
          { status: 'SIGNED' },
        ],
      });
    } else if (tabUpper === 'PENDING_PAYMENT') {
      andConditions.push({
        $or: [
          { 'signingProcess.customerSigningStatus': 'SIGNED' },
          { status: 'SIGNED' },
          { lifecycleStatus: 'COMPLETED' },
        ],
        activationStatus: { $ne: 'COMPLETED' },
        status: { $ne: 'ACTIVE' },
      });
    } else if (tabUpper === 'COMPLETED' || tabUpper === 'ACTIVE') {
      andConditions.push({
        $or: [
          { lifecycleStatus: 'COMPLETED' },
          { activationStatus: 'COMPLETED' },
          { status: 'ACTIVE' },
        ],
      });
    } else if (tabUpper === 'EXPIRING_SOON') {
      andConditions.push({
        status: 'ACTIVE',
        endDate: { $gte: now.toISOString().slice(0, 10), $lte: in30Days.toISOString().slice(0, 10) },
      });
    } else if (tabUpper === 'TERMINATED') {
      andConditions.push({
        $or: [
          { lifecycleStatus: { $in: ['TERMINATED', 'CANCELLED', 'REJECTED'] } },
          { status: 'TERMINATED' },
        ],
      });
    }

    // Search query
    if (params.search && params.search.trim()) {
      const regex = new RegExp(params.search.trim(), 'i');
      andConditions.push({
        $or: [
          { contractNumber: regex },
          { title: regex },
          { organizationName: regex },
          { 'customer.companyName': regex },
          { 'customer.contactEmail': regex },
        ],
      });
    }

    const query = andConditions.length > 1 ? { $and: andConditions } : (andConditions[0] || {});

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 15));
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.contractsCol.countDocuments(query),
      this.contractsCol
        .find(query, {
          projection: {
            _id: 1,
            contractNumber: 1,
            title: 1,
            organizationId: 1,
            organizationName: 1,
            serviceMode: 1,
            contractType: 1,
            status: 1,
            lifecycleStatus: 1,
            reviewStatus: 1,
            activationStatus: 1,
            paymentStatus: 1,
            plan: 1,
            effectiveDate: 1,
            endDate: 1,
            signedDate: 1,
            totalValue: 1,
            currency: 1,
            'commercialTerms.totalValue': 1,
            'commercialTerms.currency': 1,
            'scope.screensQuota': 1,
            maxScreens: 1,
            remainingScreens: 1,
            customer: 1,
            'signingProcess.customerSigningStatus': 1,
            'signingProcess.providerSigningStatus': 1,
            'signingProcess.customerSigner': 1,
            createdAt: 1,
            updatedAt: 1,
          },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    // Attach invoices & payment statuses
    const contractIds = items.map((doc) => doc._id.toString());
    const contractNumbers = items.map((doc) => doc.contractNumber);
    const invoices = await this.invoicesCol
      .find({
        $or: [
          { contractId: { $in: contractIds } },
          { contractNumber: { $in: contractNumbers } },
        ],
      })
      .toArray();

    const invoiceMap = new Map<string, any>();
    invoices.forEach((inv) => {
      if (inv.contractId) invoiceMap.set(inv.contractId, inv);
      if (inv.contractNumber) invoiceMap.set(inv.contractNumber, inv);
    });

    const mappedItems = items.map((doc) => {
      const summary = this.mapContractSummary(doc);
      const isSigned =
        doc.signingProcess?.customerSigningStatus === 'SIGNED' ||
        doc.status === 'SIGNED' ||
        doc.status === 'ACTIVE' ||
        doc.lifecycleStatus === 'COMPLETED';

      const inv = invoiceMap.get(doc._id.toString()) || invoiceMap.get(doc.contractNumber);
      const isPaid = inv?.status === 'PAID' || doc.status === 'ACTIVE' || doc.activationStatus === 'COMPLETED';
      return {
        ...summary,
        signingProcess: doc.signingProcess,
        signingStatus: {
          alsm: doc.signingProcess?.providerSigningStatus === 'SIGNED' || doc.status === 'ACTIVE',
          customer: isSigned,
        },
        invoiceId: (isSigned && inv) ? inv._id.toString() : null,
        invoiceNumber: (isSigned && inv) ? (inv.invoiceNumber || inv.invoice_number) : null,
        paymentStatus: isPaid ? 'PAID' : (isSigned ? (inv?.status || 'PENDING') : 'NOT_ISSUED'),
        contractStatus: (doc.status === 'ACTIVE' || doc.activationStatus === 'COMPLETED') ? 'Active' : summary.contractStatus,
        customerSigningStatus:
          doc.signingProcess?.customerSigningStatus ||
          (summary.signingStatus?.customer ? 'SIGNED' : 'NOT_SIGNED'),
      };
    });

    return {
      items: mappedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. GET CONTRACT DETAIL (14 SECTIONS)
  // ─────────────────────────────────────────────────────────────────────────────
  async getContractDetail(
    contractIdOrNumber: string,
    user?: { userId?: string; email?: string; isPlatformAdmin?: boolean },
  ) {
    const query: any = {};
    if (Types.ObjectId.isValid(contractIdOrNumber)) {
      query.$or = [{ _id: new Types.ObjectId(contractIdOrNumber) }, { contractNumber: contractIdOrNumber }];
    } else {
      query.contractNumber = contractIdOrNumber;
    }

    const doc = await this.contractsCol.findOne(query);
    if (!doc) {
      throw new NotFoundException(`Contract "${contractIdOrNumber}" not found.`);
    }

    // Access control check for non-platform admin
    if (user && !user.isPlatformAdmin) {
      const emailLower = (user.email || '').toLowerCase().trim();
      const userObjIdStr = user.userId ? user.userId.toString() : '';
      const docCustomerEmail = (doc.customer?.contactEmail || '').toLowerCase().trim();
      const docSignerEmail = (doc.signingProcess?.customerSigner?.email || '').toLowerCase().trim();
      const docCustomerUserId = (doc.customerUserId || '').toString();
      const docCreatedByUserId = (doc.createdByUserId || '').toString();

      const docOrgId = (doc.organizationId || '').toString();
      const userOrgId = ((user as any).organizationId || '').toString();

      const hasAccess =
        (emailLower && (docCustomerEmail === emailLower || docSignerEmail === emailLower)) ||
        (userObjIdStr && (docCustomerUserId === userObjIdStr || docCreatedByUserId === userObjIdStr)) ||
        (userOrgId && docOrgId && userOrgId === docOrgId);

      if (!hasAccess) {
        throw new ForbiddenException('Bạn không có quyền truy cập thông tin hợp đồng này.');
      }
    }

    let invoice = await this.invoicesCol.findOne({
      $or: [
        { contractId: doc._id.toString() },
        { contractNumber: doc.contractNumber },
      ],
    });

    const isSigned =
      doc.signingProcess?.customerSigningStatus === 'SIGNED' ||
      doc.status === 'SIGNED' ||
      doc.status === 'Signed' ||
      doc.status === 'Pending Payment' ||
      doc.status === 'PENDING_PAYMENT' ||
      doc.status === 'Payment Verification' ||
      doc.status === 'PAYMENT_VERIFICATION' ||
      doc.status === 'Active' ||
      doc.status === 'ACTIVE' ||
      doc.lifecycleStatus === 'CUSTOMER_SIGNED' ||
      doc.lifecycleStatus === 'COMPLETED';

    if (isSigned && !invoice) {
      invoice = await this.getOrCreateContractInvoice(doc);
    }

    // Proactively poll Casso if contract/invoice is actively awaiting payment when user opens it
    if (invoice && invoice.status !== 'PAID' && ['Signed', 'Pending Payment', 'Payment Verification', 'PENDING_PAYMENT'].includes(doc.status)) {
      try {
        const paymentService = this.moduleRef?.get(PaymentService, { strict: false });
        if (paymentService) {
          const syncRes = await paymentService.syncCassoTransactions();
          if (syncRes?.matched && syncRes.matched > 0) {
            const reloadedInv = await this.invoicesCol.findOne({ _id: invoice._id });
            if (reloadedInv) invoice = reloadedInv;
            const reloadedCtr = await this.contractsCol.findOne({ _id: doc._id });
            if (reloadedCtr) Object.assign(doc, reloadedCtr);
          }
        }
      } catch (e) {
        // non-fatal
      }
    }

    return await this.mapFullContract(doc, invoice);
  }

  private async buildTenancyFilter(params: {
    organizationId?: string;
    userId?: string;
    userEmail?: string;
    isPlatformAdmin?: boolean;
  }): Promise<any> {
    const filter: any = {};

    // 1. Platform Admin has global visibility across all organizations
    if (params.isPlatformAdmin) {
      if (params.organizationId && Types.ObjectId.isValid(params.organizationId)) {
        filter.$or = [
          { organizationId: new Types.ObjectId(params.organizationId) },
          { organizationId: params.organizationId },
        ];
      }
      return filter;
    }

    // 2. Partner / Customer User: Strict Isolation to own contracts
    if (params.userId) {
      const userObjId = Types.ObjectId.isValid(params.userId) ? new Types.ObjectId(params.userId) : null;
      const emailLower = (params.userEmail || '').toLowerCase().trim();

      const accessConditions: any[] = [];
      if (emailLower) {
        accessConditions.push({ 'customer.contactEmail': emailLower });
        accessConditions.push({ 'signingProcess.customerSigner.email': emailLower });
      }
      if (userObjId) {
        accessConditions.push({ customerUserId: userObjId });
        accessConditions.push({ createdByUserId: userObjId });
        accessConditions.push({ customerUserId: params.userId });
        accessConditions.push({ createdByUserId: params.userId });
      }

      if (accessConditions.length > 0) {
        filter.$or = accessConditions;
      } else {
        filter._id = new Types.ObjectId('000000000000000000000000');
      }
      return filter;
    }

    if (params.organizationId && Types.ObjectId.isValid(params.organizationId)) {
      filter.$or = [
        { organizationId: new Types.ObjectId(params.organizationId) },
        { organizationId: params.organizationId },
      ];
      return filter;
    }

    // Unauthenticated: never expose any enterprise contracts
    filter._id = new Types.ObjectId('000000000000000000000000');
    return filter;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. MULTI-STEP CONTRACT CREATION (STEPS 1-6)
  // ─────────────────────────────────────────────────────────────────────────────
  async createContract(dto: CreateEnterpriseContractDto, actorUserId: string) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const randomSuffix = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
    const contractNumber = `ALSM-CTR-${year}-${randomSuffix}`;

    // Verify Organization exists
    let orgName = dto.customer.companyName;
    if (Types.ObjectId.isValid(dto.organizationId)) {
      const org = await this.orgsCol.findOne({ _id: new Types.ObjectId(dto.organizationId) });
      if (org && org.name) orgName = org.name;
    }

    // Compute Commercial Figures
    const subtotal = dto.commercialTerms.totalValue || 0;
    const discountRate = (dto.commercialTerms.discountPercent || 0) / 100;
    const discountAmount = Math.round(subtotal * discountRate);
    const afterDiscount = subtotal - discountAmount;
    const vatRate = (dto.commercialTerms.vatRate || 10) / 100;
    const vatAmount = Math.round(afterDiscount * vatRate);
    const finalTotal = afterDiscount + vatAmount;

    // Default Milestones if not provided
    const milestones =
      dto.milestones && dto.milestones.length > 0
        ? dto.milestones
        : this.generateDefaultMilestones(dto.serviceMode, dto.effectiveDate, dto.endDate);

    // Default Clauses: Map all 15 pre-approved legal articles if not explicitly provided
    const clauses =
      dto.clauses && dto.clauses.length > 0 ? dto.clauses : DEFAULT_LEGAL_CLAUSES;

    // Cryptographic Content Fingerprint
    const documentFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          contractNumber,
          customer: dto.customer,
          scope: dto.scope,
          finalTotal,
          effectiveDate: dto.effectiveDate,
          endDate: dto.endDate,
        }),
      )
      .digest('hex');

    // Resolve Provider Legal Information from DB Company Profile
    let providerProfile = await this.connection.db!.collection('provider_company_profiles').findOne({ isActive: true });
    if (!providerProfile) {
      providerProfile = await this.connection.db!.collection('provider_company_profiles').findOne({}, { sort: { version: -1 } });
    }

    const providerLegalName =
      providerProfile?.legalName || 'CÔNG TY CỔ PHẦN CÔNG NGHỆ HIỆN ĐẠI HÓA PHẦN MỀM ALSM';
    const providerTaxId = providerProfile?.taxId || '0110892345';
    const providerAddress =
      providerProfile?.registeredAddress ||
      'Tầng 12, Tòa nhà Keangnam Landmark 72, Đường Phạm Hùng, Phường Mễ Trì, Quận Nam Từ Liêm, TP. Hà Nội, Việt Nam';
    const providerRepName =
      providerProfile?.representativeName || providerProfile?.signatoryConfig?.signerName || 'Nguyễn Hữu Dũng';
    const providerRepTitle =
      providerProfile?.representativeTitle || providerProfile?.signatoryConfig?.signerTitle || 'Tổng Giám Đốc';
    const providerEmail =
      providerProfile?.contactEmail || providerProfile?.signatoryConfig?.signerEmail || 'contracts@alsm.io';
    const providerPhone = providerProfile?.contactPhone || '+84 24 7300 8899';
    const providerBankName = providerProfile?.bankName || 'Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)';
    const providerBankAccount = providerProfile?.bankAccountNumber || '1029384756';
    const providerBankHolder = providerProfile?.bankAccountHolder || 'CONG TY CP CONG NGHE HIEN DAI HOA PHAN MEM ALSM';
    const providerLogo = providerProfile?.companyLogo || '/assets/logo.png';
    const providerVersion = providerProfile?.version || 1;

    const sigConfig = providerProfile?.signatoryConfig;
    const providerSignerName = sigConfig?.signerName || providerRepName;
    const providerSignerTitle = sigConfig?.signerTitle || providerRepTitle;
    const providerSignerEmail = sigConfig?.signerEmail || providerEmail;
    const providerCertSerial = sigConfig?.certificateSerialNumber || 'VNPT-ECA-ALSM-01';
    const providerCaProvider = sigConfig?.digitalCertificateProvider || 'VNPT-CA';
    const providerSignatureImage = sigConfig?.signatureImageUrl || '';
    const providerCompanySeal = sigConfig?.companySealUrl || '';
    const providerStampPosition = sigConfig?.stampPosition || 'side_by_side';
    // ALSM company provider signature is always pre-signed upfront when creating contracts
    const alsmSignerObj = {
      name: providerSignerName || 'Nguyễn Gia Khánh',
      title: providerSignerTitle || 'Tổng Giám Đốc',
      email: providerSignerEmail || 'contracts@alsm.io',
      signedAt: now.toISOString(),
      signatureHash: createHash('sha256')
        .update(`${contractNumber}-ALSM-${providerSignerEmail || 'contracts@alsm.io'}-${now.toISOString()}`)
        .digest('hex'),
      certificateReference: providerCertSerial || 'VNPT-ECA-ALSM-01',
      certificateProvider: providerCaProvider || 'VNPT-CA',
      signatureImageUrl: providerSignatureImage,
      companySealUrl: providerCompanySeal,
      stampPosition: providerStampPosition || 'side_by_side',
      authMethod: 'VNPT Cloud CA HSM Hardware Token',
    };

    // Resolve Customer Organization Legal Profile if available
    let orgDoc: any = null;
    if (dto.organizationId && Types.ObjectId.isValid(dto.organizationId)) {
      orgDoc = await this.orgsCol.findOne({ _id: new Types.ObjectId(dto.organizationId) });
    }
    const orgLegal = orgDoc?.legalProfile;
    const customerLegalName = dto.customer.companyName || orgLegal?.legalCompanyName || orgDoc?.name;
    const customerTaxId = dto.customer.taxId || orgLegal?.taxId;
    const customerAddress = dto.customer.businessAddress || orgLegal?.registeredAddress;
    const customerRepName = dto.customer.representativeName || orgLegal?.legalRepresentative;
    const customerRepTitle = dto.customer.representativeTitle || orgLegal?.representativeTitle;
    const customerEmail = dto.customer.contactEmail || orgLegal?.contactEmail || orgDoc?.contactEmail;

    const defaultBank =
      (await this.connection.db!.collection('bank_accounts').findOne({ isDefault: true, status: 'active' })) ||
      (await this.connection.db!.collection('bank_accounts').findOne({ status: 'active' }));
    const defaultBankInfo = defaultBank
      ? `${defaultBank.bankName} — Số tài khoản: ${defaultBank.accountNumberLast4 ? `****${defaultBank.accountNumberLast4}` : providerBankAccount} (${defaultBank.accountHolderName})`
      : `${providerBankName} — Số tài khoản: ${providerBankAccount} (${providerBankHolder})`;

    // Validate Statutory & Commercial Data Completeness
    const validation = EnterpriseContractValidator.validate({
      customer: {
        ...dto.customer,
        companyName: customerLegalName,
        taxId: customerTaxId,
        businessAddress: customerAddress,
        representativeName: customerRepName,
        representativeTitle: customerRepTitle,
        contactEmail: customerEmail,
      },
      commercialTerms: { totalValue: finalTotal, vatRate: dto.commercialTerms.vatRate },
      effectiveDate: dto.effectiveDate,
      endDate: dto.endDate,
      scope: dto.scope,
    });

    const contractDoc: any = {
      _id: new Types.ObjectId(),
      contractNumber,
      title: dto.title,
      serviceMode: dto.serviceMode,
      contractType: dto.contractType,
      organizationId: Types.ObjectId.isValid(dto.organizationId)
        ? new Types.ObjectId(dto.organizationId)
        : dto.organizationId,
      organizationName: orgName,
      leadId: dto.leadId && Types.ObjectId.isValid(dto.leadId) ? new Types.ObjectId(dto.leadId) : undefined,
      plan: dto.planTier,
      effectiveDate: dto.effectiveDate,
      endDate: dto.endDate,
      lifecycleStatus: 'DRAFT',
      reviewStatus: validation.isValid ? 'NOT_SUBMITTED' : 'NEEDS_INFORMATION',
      activationStatus: 'NOT_ELIGIBLE',
      status: 'DRAFT',
      validationResult: {
        isValid: validation.isValid,
        canIssueOfficialContract: validation.canIssueOfficialContract,
        status: validation.status,
        errors: validation.errors,
        warnings: validation.warnings,
        summaryVi: validation.summaryVi,
      },
      customer: {
        companyName: dto.customer.companyName,
        taxId: dto.customer.taxId,
        businessAddress: dto.customer.businessAddress,
        representativeName: dto.customer.representativeName,
        representativeTitle: dto.customer.representativeTitle,
        contactEmail: dto.customer.contactEmail,
        contactPhone: dto.customer.contactPhone || '',
        powerOfAttorneyRef: dto.customer.powerOfAttorneyRef || '',
      },
      parties: {
        provider: {
          legalName: providerLegalName,
          brandName: 'ALSM Enterprise Platform',
          taxId: providerTaxId,
          headquarters: providerAddress,
          registeredAddress: providerAddress,
          signatoryName: providerSignerName,
          representativeName: providerRepName,
          signatoryTitle: providerSignerTitle,
          representativeTitle: providerRepTitle,
          contactEmail: providerEmail,
          contactPhone: providerPhone,
          bankName: providerBankName,
          bankAccountNumber: providerBankAccount,
          bankAccountHolder: providerBankHolder,
          companyLogo: providerLogo,
          profileVersion: providerVersion,
          signatureImageUrl: providerSignatureImage,
          signatureImage: providerSignatureImage,
          companySealUrl: providerCompanySeal,
          officialSealImage: providerCompanySeal,
          stampPosition: providerStampPosition,
          digitalCertificateProvider: providerCaProvider,
          certificateSerialNumber: providerCertSerial,
          snapshotTimestamp: new Date(),
        },
        customer: {
          legalName: customerLegalName,
          taxId: customerTaxId,
          businessAddress: customerAddress,
          registeredAddress: customerAddress,
          signatoryName: customerRepName,
          representativeName: customerRepName,
          signatoryTitle: customerRepTitle,
          representativeTitle: customerRepTitle,
          contactEmail: customerEmail,
          verificationStatus: orgLegal?.verificationStatus || 'UNVERIFIED',
          dataSource: orgLegal?.dataSource || 'MANUAL_ENTRY',
          snapshotTimestamp: new Date(),
        },
      },
      scope: {
        screensQuota: dto.scope.screensQuota || 100,
        programsQuota: dto.scope.programsQuota || 50,
        storageGb: dto.scope.storageGb || 20,
        targetTechnology: dto.scope.targetTechnology || 'React 19 + TypeScript + Spring Boot 3 Java 21',
        sourceCodeType: dto.scope.sourceCodeType || 'IBM 3270 BMS / AS400 DSPF & COBOL Logic',
        supportTier: dto.scope.supportTier || 'Enterprise Premium SLA (4h)',
        slaCommitment: dto.scope.slaCommitment || '99.9% Uptime with Deterministic AST Validation',
        deliverables: dto.scope.deliverables || [
          'Synthesized React 19 UI component repository with Tailwind styles',
          'Spring Boot 3 Java DTO contracts and JPA entities',
          'AST semantic equivalence & rule verification dossier',
          'Deployment architecture blueprint and migration runbook',
        ],
      },
      usedScreens: 0,
      maxScreens: dto.scope.screensQuota || 100,
      remainingScreens: dto.scope.screensQuota || 100,
      commercialTerms: {
        subtotal,
        discountPercent: dto.commercialTerms.discountPercent || 0,
        discountAmount,
        vatRate: dto.commercialTerms.vatRate || 10,
        vatAmount,
        totalValue: finalTotal,
        currency: dto.commercialTerms.currency || 'VND',
        paymentStructure: dto.commercialTerms.paymentStructure || 'MILESTONE_BASED',
        bankAccountInfo: dto.commercialTerms.bankAccountInfo || defaultBankInfo,
        paymentTermsDays: dto.commercialTerms.paymentTermsDays || 'Net 15 days upon milestone invoice',
      },
      totalValue: finalTotal,
      currency: dto.commercialTerms.currency || 'VND',
      clauses,
      milestones,
      paymentSchedule: this.generatePaymentSchedule(milestones, finalTotal, dto.commercialTerms.currency || 'VND'),
      signingProcess: {
        providerSigningStatus: 'SIGNED',
        customerSigningStatus: 'NOT_SIGNED',
        providerName: providerCaProvider,
        documentSha256: documentFingerprint,
        alsmSigner: alsmSignerObj,
        alsmSignatureImage: providerSignatureImage,
        alsmOfficialSealImage: providerCompanySeal,
        alsmStampPosition: providerStampPosition,
        customerSigner: null,
      },
      amendments: [],
      renewals: [],
      auditTrail: [
        {
          id: randomUUID(),
          action: 'CONTRACT_DRAFT_CREATED',
          actorUserId,
          actorName: 'Enterprise Sales Architect',
          timestamp: now.toISOString(),
          details: `Contract draft ${contractNumber} initialized for ${dto.customer.companyName}.${validation.isValid ? '' : ' Marked NEEDS_INFORMATION pending statutory validation.'}`,
        },
      ],
      createdByUserId: Types.ObjectId.isValid(actorUserId) ? new Types.ObjectId(actorUserId) : actorUserId,
      createRequestId: (dto as any).createRequestId || (dto as any).requestId || randomUUID(),
      createRequestFingerprint: documentFingerprint,
      revision: 1,
      currentVersionId: new Types.ObjectId(),
      providerCompletionStatus: 'NOT_STARTED',
      archiveStatus: 'NOT_STARTED',
      customerDecision: 'NONE',
      createdAt: now,
      updatedAt: now,
    };

    await this.contractsCol.insertOne(contractDoc);
    return await this.mapFullContract(contractDoc);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. UPDATE CONTRACT DRAFT
  // ─────────────────────────────────────────────────────────────────────────────
  async updateContract(contractId: string, updates: Partial<CreateEnterpriseContractDto>, actorUserId: string) {
    const contract = await this.contractsCol.findOne({
      _id: new Types.ObjectId(contractId),
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    if (!['DRAFT', 'CHANGES_REQUESTED'].includes(contract.lifecycleStatus)) {
      throw new BadRequestException('Only drafts or contracts with requested changes can be edited.');
    }

    const now = new Date();
    const setFields: any = { updatedAt: now };

    if (updates.title) setFields.title = updates.title;
    if (updates.effectiveDate) setFields.effectiveDate = updates.effectiveDate;
    if (updates.endDate) setFields.endDate = updates.endDate;
    if (updates.scope) setFields.scope = { ...contract.scope, ...updates.scope };
    if (updates.clauses) setFields.clauses = updates.clauses;
    if (updates.milestones) setFields.milestones = updates.milestones;
    if (updates.commercialTerms) {
      const subtotal = updates.commercialTerms.totalValue ?? contract.commercialTerms.subtotal;
      const discountRate = (updates.commercialTerms.discountPercent ?? contract.commercialTerms.discountPercent) / 100;
      const discountAmount = Math.round(subtotal * discountRate);
      const afterDiscount = subtotal - discountAmount;
      const vatRate = (updates.commercialTerms.vatRate ?? contract.commercialTerms.vatRate) / 100;
      const vatAmount = Math.round(afterDiscount * vatRate);
      const finalTotal = afterDiscount + vatAmount;

      setFields.commercialTerms = {
        ...contract.commercialTerms,
        ...updates.commercialTerms,
        subtotal,
        discountAmount,
        vatAmount,
        totalValue: finalTotal,
      };
      setFields.totalValue = finalTotal;
    }

    const auditEntry = {
      id: randomUUID(),
      action: 'CONTRACT_DRAFT_UPDATED',
      actorUserId,
      actorName: 'Authorized Editor',
      timestamp: now.toISOString(),
      details: 'Draft details, scope, or commercial terms updated.',
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: setFields,
        $push: { auditTrail: auditEntry } as any,
      },
    );

    return this.getContractDetail(contractId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. SUBMIT DRAFT FOR INTERNAL REVIEW (STEP 7)
  // ─────────────────────────────────────────────────────────────────────────────
  async submitForReview(contractId: string, actorUserId: string) {
    const contract = await this.contractsCol.findOne({
      _id: new Types.ObjectId(contractId),
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    if (contract.lifecycleStatus !== 'DRAFT' && contract.lifecycleStatus !== 'CHANGES_REQUESTED') {
      throw new BadRequestException('Contract is not in a submittable draft state.');
    }

    const now = new Date();
    const auditEntry = {
      id: randomUUID(),
      action: 'CONTRACT_SUBMITTED_FOR_REVIEW',
      actorUserId,
      actorName: 'Account Executive',
      timestamp: now.toISOString(),
      details: 'Draft submitted to Legal & Management review queue.',
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          lifecycleStatus: 'INTERNAL_REVIEW',
          reviewStatus: 'PENDING',
          updatedAt: now,
        },
        $push: { auditTrail: auditEntry } as any,
      },
    );

    return this.getContractDetail(contractId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. INTERNAL & LEGAL REVIEW DECISION (STEP 7)
  // ─────────────────────────────────────────────────────────────────────────────
  async reviewContract(contractId: string, dto: ReviewContractDto, actorUserId: string) {
    const contract = await this.contractsCol.findOne({
      _id: new Types.ObjectId(contractId),
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    const now = new Date();
    let newLifecycle = contract.lifecycleStatus;
    let newReviewStatus = contract.reviewStatus;

    if (dto.action === 'APPROVE') {
      newLifecycle = 'READY_FOR_SIGNATURE';
      newReviewStatus = 'APPROVED';
    } else if (dto.action === 'REQUEST_CHANGES') {
      newLifecycle = 'CHANGES_REQUESTED';
      newReviewStatus = 'CHANGES_REQUESTED';
    } else if (dto.action === 'REJECT') {
      newLifecycle = 'REJECTED';
      newReviewStatus = 'REJECTED';
    }

    const auditEntry = {
      id: randomUUID(),
      action: `CONTRACT_REVIEW_${dto.action}`,
      actorUserId,
      actorName: 'Legal Counsel / Management Approver',
      timestamp: now.toISOString(),
      details: `Review decision: ${dto.action}. Notes: ${dto.reason || 'None provided'}.`,
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          lifecycleStatus: newLifecycle,
          reviewStatus: newReviewStatus,
          reviewReason: dto.reason || '',
          reviewedAt: now,
          updatedAt: now,
        },
        $push: { auditTrail: auditEntry } as any,
      },
    );

    return this.getContractDetail(contractId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. SEND CONTRACT TO CUSTOMER (STEP 8)
  // ─────────────────────────────────────────────────────────────────────────────
  async sendToCustomer(contractId: string, actorUserId: string) {
    const contract = await this.contractsCol.findOne({
      _id: new Types.ObjectId(contractId),
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    if (contract.lifecycleStatus !== 'READY_FOR_SIGNATURE' && contract.lifecycleStatus !== 'ALSM_SIGNED') {
      throw new BadRequestException('Contract must be Approved before sending to customer.');
    }

    const now = new Date();
    const token = randomUUID();
    const auditEntry = {
      id: randomUUID(),
      action: 'CONTRACT_SENT_TO_CUSTOMER',
      actorUserId,
      actorName: 'Enterprise Operations',
      timestamp: now.toISOString(),
      details: `Contract dispatched to customer (${contract.customer?.contactEmail || 'partner email'}). Signing invitation generated.`,
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          lifecycleStatus: 'SENT_TO_CUSTOMER',
          invitationToken: token,
          sentAt: now,
          updatedAt: now,
        },
        $push: { auditTrail: auditEntry } as any,
      },
    );

    return {
      success: true,
      contractId,
      signingLink: `/contracts/${contractId}?invitationToken=${token}`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. CUSTOMER DECISION (STEP 8)
  // ─────────────────────────────────────────────────────────────────────────────
  async customerDecision(contractId: string, dto: CustomerDecisionDto, actorUserId: string) {
    const contract = await this.contractsCol.findOne({
      _id: new Types.ObjectId(contractId),
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    const now = new Date();
    let newLifecycle = contract.lifecycleStatus;

    if (dto.action === 'ACCEPT') {
      newLifecycle = 'CUSTOMER_VIEWED';
    } else if (dto.action === 'REQUEST_CHANGES') {
      newLifecycle = 'CHANGES_REQUESTED';
    } else if (dto.action === 'DECLINE') {
      newLifecycle = 'REJECTED';
    }

    const auditEntry = {
      id: randomUUID(),
      action: `CUSTOMER_DECISION_${dto.action}`,
      actorUserId,
      actorName: contract.customer?.representativeName || 'Customer Signer',
      timestamp: now.toISOString(),
      details: `Customer decision: ${dto.action}. Comments: ${dto.comments || 'No comment'}`,
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          lifecycleStatus: newLifecycle,
          customerDecision: dto.action,
          customerDecisionReason: dto.comments || '',
          customerDecisionAt: now,
          updatedAt: now,
        },
        $push: { auditTrail: auditEntry } as any,
      },
    );

    return this.getContractDetail(contractId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. ELECTRONIC SIGNING (STEP 9)
  // ─────────────────────────────────────────────────────────────────────────────
  async signContract(contractId: string, dto: SignContractDto, ipAddress: string = '127.0.0.1') {
    const contract = await this.contractsCol.findOne({
      _id: new Types.ObjectId(contractId),
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    const isAlsm = dto.signerRole === 'ALSM_PROVIDER';

    // Synchronize latest authorized signatory credentials before validation
    if (!isAlsm && dto.signerName) {
      if (!contract.customer) contract.customer = {};
      contract.customer.representativeName = dto.signerName.trim();
      if (dto.signerTitle) contract.customer.representativeTitle = dto.signerTitle.trim();
      if (dto.signerEmail) contract.customer.contactEmail = dto.signerEmail.trim();

      if (!contract.parties) contract.parties = {};
      if (!contract.parties.customer) contract.parties.customer = {};
      contract.parties.customer.signatoryName = dto.signerName.trim();
      contract.parties.customer.representativeName = dto.signerName.trim();
      if (dto.signerTitle) {
        contract.parties.customer.signatoryTitle = dto.signerTitle.trim();
        contract.parties.customer.representativeTitle = dto.signerTitle.trim();
      }
      if (dto.signerEmail) contract.parties.customer.contactEmail = dto.signerEmail.trim();
    }

    // Statutory Legal Data Validation before allowing electronic signature
    const validation = EnterpriseContractValidator.validate(contract);
    if (!validation.canIssueOfficialContract) {
      throw new BadRequestException({
        code: 'CONTRACT_LEGAL_INFO_INCOMPLETE',
        message: 'Hợp đồng chưa đủ thông tin pháp lý hợp lệ của khách hàng hoặc người đại diện để ký chính thức.',
        errors: validation.errors,
      });
    }

    const now = new Date();
    const signatureHash = createHash('sha256')
      .update(`${contract.contractNumber}-${dto.signerRole}-${dto.signerEmail}-${now.toISOString()}`)
      .digest('hex');

    const signerRecord: any = {
      name: dto.signerName,
      title: dto.signerTitle,
      email: dto.signerEmail,
      signedAt: now.toISOString(),
      signatureHash,
      ipAddress,
      certificateReference: `VNPT-ECA-${randomUUID().slice(0, 8).toUpperCase()}`,
      authMethod: dto.authMethod || 'Enterprise Multi-Factor + OTP',
      signatureImageUrl: (dto as any).signatureImageUrl,
    };

    const updatedSigningProcess = {
      ...contract.signingProcess,
      [isAlsm ? 'providerSigningStatus' : 'customerSigningStatus']: 'SIGNED',
      [isAlsm ? 'alsmSigner' : 'customerSigner']: signerRecord,
      ...((dto as any).signatureImageUrl ? { [isAlsm ? 'alsmSignatureImage' : 'customerSignatureImage']: (dto as any).signatureImageUrl } : {}),
    };

    // If customer signed and ALSM auto counter-signature is enabled, counter-sign automatically
    if (!isAlsm && updatedSigningProcess.providerSigningStatus !== 'SIGNED') {
      const activeProvider = await this.connection.db!.collection('provider_company_profiles').findOne({ isActive: true });
      const sigCfg = activeProvider?.signatoryConfig;
      if (sigCfg?.autoCounterSignEnabled ?? true) {
        const alsmHash = createHash('sha256')
          .update(`${contract.contractNumber}-ALSM-${sigCfg?.signerEmail || 'contracts@alsm.io'}-${now.toISOString()}`)
          .digest('hex');
        updatedSigningProcess.providerSigningStatus = 'SIGNED';
        updatedSigningProcess.alsmSigner = {
          name: sigCfg?.signerName || activeProvider?.representativeName || 'Nguyễn Gia Khánh',
          title: sigCfg?.signerTitle || activeProvider?.representativeTitle || 'Tổng Giám Đốc',
          email: sigCfg?.signerEmail || activeProvider?.contactEmail || 'contracts@alsm.io',
          signedAt: now.toISOString(),
          signatureHash: alsmHash,
          ipAddress: '127.0.0.1',
          certificateReference: sigCfg?.certificateSerialNumber || 'VNPT-ECA-ALSM-01',
          certificateProvider: sigCfg?.digitalCertificateProvider || 'VNPT-CA',
          signatureImageUrl: sigCfg?.signatureImageUrl || '',
          companySealUrl: sigCfg?.companySealUrl || '',
          stampPosition: sigCfg?.stampPosition || 'side_by_side',
          authMethod: 'VNPT Cloud CA HSM Hardware Token',
        };
        updatedSigningProcess.alsmSignatureImage = sigCfg?.signatureImageUrl || '';
        updatedSigningProcess.alsmOfficialSealImage = sigCfg?.companySealUrl || '';
        updatedSigningProcess.alsmStampPosition = sigCfg?.stampPosition || 'side_by_side';
      }
    }

    // Determine new lifecycle status
    const bothSigned =
      updatedSigningProcess.providerSigningStatus === 'SIGNED' &&
      updatedSigningProcess.customerSigningStatus === 'SIGNED';

    let nextLifecycle = contract.lifecycleStatus;
    let nextActivation = contract.activationStatus;
    let nextStatus = contract.status;

    if (bothSigned) {
      nextLifecycle = 'COMPLETED';
      nextActivation = 'ELIGIBLE';
      nextStatus = 'SIGNED';
    } else if (isAlsm) {
      nextLifecycle = 'ALSM_SIGNED';
      nextStatus = 'WAITING_FOR_CUSTOMER_SIGN';
    } else {
      nextLifecycle = 'CUSTOMER_SIGNED';
      nextStatus = 'WAITING_FOR_ALSM_SIGN';
    }

    const auditEntry = {
      id: randomUUID(),
      action: `CONTRACT_SIGNED_${dto.signerRole}`,
      actorUserId: signerRecord.email,
      actorName: signerRecord.name,
      timestamp: now.toISOString(),
      details: `Digitally signed by ${signerRecord.name} (${signerRecord.title}). Signature Hash: ${signatureHash.slice(0, 16)}... Certificate: ${signerRecord.certificateReference}`,
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          customer: contract.customer,
          parties: contract.parties,
          signingProcess: updatedSigningProcess,
          lifecycleStatus: nextLifecycle,
          activationStatus: nextActivation,
          status: nextStatus,
          signedDate: now.toISOString().slice(0, 10),
          updatedAt: now,
        },
        $push: { auditTrail: auditEntry } as any,
      },
    );

    // Auto-generate invoice ONLY when both parties have signed fully
    let invoiceNumber = `INV-${contract.contractNumber.replace('ALSM-CTR-', '')}`;
    if (bothSigned) {
      try {
        const existingInvoice = await this.invoicesCol.findOne({
          $or: [
            { contractId: contract._id.toString() },
            { contractNumber: contract.contractNumber },
          ],
        });

        if (!existingInvoice) {
          const subtotal = contract.commercialTerms?.subtotal || Math.round((contract.totalValue || 0) / 1.1);
          const vatRate = contract.commercialTerms?.vatRate || 10;
          const taxAmount = contract.commercialTerms?.vatAmount || Math.round((contract.totalValue || 0) - subtotal);
          const total = contract.commercialTerms?.totalValue || contract.totalValue || 0;

          // Default payment deadline: 72 hours
          const PAYMENT_DUE_HOURS = 72;
          const dueDate = new Date(Date.now() + PAYMENT_DUE_HOURS * 60 * 60 * 1000);

          const newInvoice = {
            _id: new Types.ObjectId(),
            invoiceNumber,
            invoice_number: invoiceNumber,
            contractId: contract._id.toString(),
            contractNumber: contract.contractNumber,
            organizationId: contract.organizationId,
            organizationName: contract.customer?.companyName || contract.organizationName,
            customerName: contract.customer?.representativeName || signerRecord.name,
            customerEmail: contract.customer?.contactEmail || signerRecord.email,
            amount: total,
            amountVnd: total,
            subtotalVnd: subtotal,
            vatRate,
            taxAmountVnd: taxAmount,
            currency: contract.currency || 'VND',
            status: 'ISSUED',
            dueDate,
            dueAt: dueDate,
            paymentDueHours: PAYMENT_DUE_HOURS,
            referenceCode: `ALSM ${invoiceNumber}`,
          items: [
            {
              description: `Enterprise Modernization Program (${contract.serviceMode}) - ${contract.scope?.screensQuota || 100} screens`,
              quantity: 1,
              unitPrice: subtotal,
              amount: subtotal,
            },
          ],
          paymentMethod: 'VIETQR_BANK_TRANSFER',
          createdAt: now,
          updatedAt: now,
        };

        await this.invoicesCol.insertOne(newInvoice);

        // Send Email Notification
        if (this.mailService && signerRecord.email) {
          const web1Url = process.env.WEB1_URL || 'http://localhost:5173';
          this.mailService
            .sendContractSignedNotification({
              to: signerRecord.email,
              customerName: signerRecord.name || 'Quý khách hàng',
              contractNumber: contract.contractNumber,
              totalValueVnd: total,
              invoiceNumber,
              paymentUrl: `${web1Url}/billing/invoices/${newInvoice._id.toString()}/pay`,
            })
            .catch((e) => console.warn('Failed to send contract signed email notification:', e));
        }
      } else {
        invoiceNumber = existingInvoice.invoiceNumber || invoiceNumber;
      }
    } catch (invErr) {
      console.warn('Auto invoice creation non-fatal error:', invErr);
    }
  }

  return this.getContractDetail(contractId);
}

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. CONTRACT ACTIVATION & AUTOMATIC WEB 3 PROVISIONING (IDEMPOTENT)
  // ─────────────────────────────────────────────────────────────────────────────
  async activateContract(contractId: string, actorUserId: string) {
    return this.activateContractAndProvisionWeb3(contractId, actorUserId, { force: true });
  }

  async activateContractAndProvisionWeb3(
    contractId: string,
    actorUserId: string,
    options?: { force?: boolean; reason?: string },
  ) {
    const query: any = {};
    if (Types.ObjectId.isValid(contractId)) {
      query.$or = [{ _id: new Types.ObjectId(contractId) }, { contractNumber: contractId }];
    } else {
      query.contractNumber = contractId;
    }

    let contract = await this.contractsCol.findOne(query);
    if (!contract) {
      let inv = await this.invoicesCol.findOne({
        $or: [
          { invoiceNumber: contractId },
          { invoice_number: contractId },
        ],
      });

      // Normalized fallback if hyphens or prefixes (DEMO, ALSM) were omitted by bank
      if (!inv) {
        const cleanInput = contractId.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const allInvoices = await this.invoicesCol.find({}).toArray();
        inv = allInvoices.find((candidate: any) => {
          const cleanInv = (candidate.invoiceNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const cleanCtr = (candidate.contractNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const strippedInv = cleanInv.replace(/^(DEMO|ALSM)/, '');
          const strippedCtr = cleanCtr.replace(/^(ALSM)/, '');
          return (
            cleanInv === cleanInput ||
            cleanCtr === cleanInput ||
            cleanInv.includes(cleanInput) ||
            cleanInput.includes(cleanInv) ||
            (cleanInput.length >= 6 && cleanInv.endsWith(cleanInput.slice(-6))) ||
            (strippedInv.length >= 6 && cleanInput.includes(strippedInv))
          );
        }) || null;
        if (inv) {
        }
      }

      if (inv) {
        if (inv.contractId && Types.ObjectId.isValid(inv.contractId)) {
          contract = await this.contractsCol.findOne({ _id: new Types.ObjectId(inv.contractId) });
        } else if (inv.contractNumber) {
          contract = await this.contractsCol.findOne({ contractNumber: inv.contractNumber });
        }
      }
    }
    if (!contract) throw new NotFoundException('Contract not found.');

    // Enforce condition: must be signed or forced by admin
    const isSigned =
      contract.lifecycleStatus === 'COMPLETED' ||
      contract.status === 'SIGNED' ||
      contract.status === 'ACTIVE' ||
      contract.signingProcess?.customerSigningStatus === 'SIGNED';

    if (!isSigned && !options?.force) {
      throw new BadRequestException('Contract must be digitally signed before activation.');
    }

    // Check payment status unless forced
    const invoice = await this.invoicesCol.findOne({
      $or: [
        { contractId: contract._id.toString() },
        { contractNumber: contract.contractNumber },
      ],
    });

    const isPaid = invoice && invoice.status === 'PAID';
    if (!isPaid && !options?.force) {
      throw new BadRequestException('Contract invoice must be PAID before Web 3 activation.');
    }

    // Idempotency: If already active & completed, return cleanly without duplicating
    if (
      contract.status === 'ACTIVE' &&
      contract.activationStatus === 'COMPLETED' &&
      !options?.force
    ) {
      return {
        success: true,
        alreadyActive: true,
        contractId: contract._id.toString(),
        contractNumber: contract.contractNumber,
        organizationId: contract.organizationId ? contract.organizationId.toString() : null,
        serviceMode: contract.serviceMode,
        message: 'Contract and Web 3 workspace are already active and provisioned.',
      };
    }

    const now = new Date();
    const screensQuota = contract.scope?.screensQuota || 1000;
    const programsQuota = contract.scope?.programsQuota || 500;
    const storageGb = contract.scope?.storageGb || 50;
    const concurrentJobs = contract.serviceMode === 'WE_CONVERT_FOR_YOU' ? 5 : 2;
    const teamMembers = 30;

    // 1. Provision / Update Organization in Web 3
    let orgId = contract.organizationId;
    const customerEmail = contract.customer?.contactEmail || contract.signingProcess?.customerSigner?.email;

    // Find customer user to assign ORGANIZATION_OWNER
    const customerUser = customerEmail
      ? await this.usersCol.findOne({ email: customerEmail.toLowerCase().trim() })
      : null;

    if (orgId && Types.ObjectId.isValid(orgId)) {
      const orgUpdate: any = {
        $set: {
          tier: 'ENTERPRISE',
          serviceMode: contract.serviceMode,
          status: 'ACTIVE',
          screensQuota,
          programsQuota,
          storageQuotaGb: storageGb,
          concurrentJobsLimit: concurrentJobs,
          teamMembersLimit: teamMembers,
          activeContractNumber: contract.contractNumber,
          activeContractId: contract._id.toString(),
          modernizationStatus: 'PROVISIONED',
          updatedAt: now,
        },
      };

      if (customerUser) {
        const org = await this.orgsCol.findOne({ _id: new Types.ObjectId(orgId) });
        if (org) {
          const members = org.members || [];
          const existingMemberIndex = members.findIndex(
            (m: any) => String(m.userId) === String(customerUser._id),
          );
          if (existingMemberIndex >= 0) {
            members[existingMemberIndex].role = 'ORGANIZATION_OWNER';
          } else {
            members.push({
              userId: customerUser._id,
              role: 'ORGANIZATION_OWNER',
              joinedAt: now,
            });
          }
          orgUpdate.$set.members = members;
        }
      }

      await this.orgsCol.updateOne({ _id: new Types.ObjectId(orgId) }, orgUpdate);

      if (customerUser) {
        await this.usersCol.updateOne(
          { _id: customerUser._id },
          {
            $set: {
              organizationId: new Types.ObjectId(orgId),
              role: 'PARTNER',
              updatedAt: now,
            },
            $addToSet: {
              roles: 'PARTNER',
            },
          },
        );
      }
    } else {
      // Create Organization if none was linked
      const newOrgId = new Types.ObjectId();
      orgId = newOrgId;
      await this.orgsCol.insertOne({
        _id: newOrgId,
        name: contract.customer?.companyName || contract.organizationName || 'Enterprise Partner',
        status: 'ACTIVE',
        tier: 'ENTERPRISE',
        serviceMode: contract.serviceMode,
        screensQuota,
        programsQuota,
        storageQuotaGb: storageGb,
        concurrentJobsLimit: concurrentJobs,
        teamMembersLimit: teamMembers,
        activeContractNumber: contract.contractNumber,
        activeContractId: contract._id.toString(),
        modernizationStatus: 'PROVISIONED',
        members: customerUser
          ? [{ userId: customerUser._id, role: 'ORGANIZATION_OWNER', joinedAt: now }]
          : [],
        createdAt: now,
        updatedAt: now,
      });

      if (customerUser) {
        await this.usersCol.updateOne(
          { _id: customerUser._id },
          {
            $set: {
              organizationId: newOrgId,
              role: 'PARTNER',
              updatedAt: now,
            },
            $addToSet: {
              roles: 'PARTNER',
            },
          },
        );
      }
    }

    // 2. Provision / Update Subscription (ACTIVE)
    const inOneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const endDate = contract.endDate ? new Date(contract.endDate) : inOneYear;

    await this.subscriptionsCol.updateOne(
      {
        $or: [
          { contractId: contract._id.toString() },
          { organizationId: orgId },
        ],
      },
      {
        $set: {
          organizationId: orgId,
          contractId: contract._id.toString(),
          contractNumber: contract.contractNumber,
          tier: 'ENTERPRISE',
          status: 'ACTIVE',
          screensLimit: screensQuota,
          projectsLimit: 20,
          storageLimitGb: storageGb,
          startDate: now,
          currentPeriodEnd: endDate,
          serviceMode: contract.serviceMode,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new Types.ObjectId(),
          createdAt: now,
        },
      },
      { upsert: true },
    );

    // 3. If WE_CONVERT_FOR_YOU or HYBRID, provision Managed Modernization Project in Web 2
    let createdProjectId: string | null = null;
    if (contract.serviceMode === 'WE_CONVERT_FOR_YOU' || contract.serviceMode === 'HYBRID') {
      const existingProject = await this.projectsCol.findOne({
        contractNumber: contract.contractNumber,
      });

      if (!existingProject) {
        const newProjId = new Types.ObjectId();
        createdProjectId = newProjId.toString();

        await this.projectsCol.insertOne({
          _id: newProjId,
          name: `${contract.customer?.companyName || contract.organizationName || 'Enterprise'} — Modernization Program`,
          description: `Turnkey enterprise modernization program governed by contract ${contract.contractNumber}.`,
          organizationId: orgId,
          contractNumber: contract.contractNumber,
          contractId: contract._id.toString(),
          serviceMode: contract.serviceMode,
          conversionType: 'BMS_DSPF_TO_FRONTEND',
          status: 'ACTIVE',
          screensCount: screensQuota,
          milestones: contract.milestones || [],
          createdBy: contract.createdByUserId || (Types.ObjectId.isValid(actorUserId) ? new Types.ObjectId(actorUserId) : actorUserId),
          createdAt: now,
          updatedAt: now,
        });
      } else {
        createdProjectId = existingProject._id.toString();
      }
    }

    // 4. Update Contract status to ACTIVE / COMPLETED
    const auditEntry = {
      id: randomUUID(),
      action: 'AUTOMATIC_WEB3_ACTIVATION_COMPLETED',
      actorUserId,
      actorName: 'ALSM Web 3 Activation Engine',
      timestamp: now.toISOString(),
      details: `Electronic Contract fulfilled. Web 3 Partner Portal activated for ${
        contract.customer?.companyName || contract.organizationName
      }. Service Mode: ${contract.serviceMode}. Screen Quota: ${screensQuota}. ${
        options?.reason ? `Reason: ${options.reason}.` : ''
      }`,
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          organizationId: orgId,
          status: 'ACTIVE',
          lifecycleStatus: 'COMPLETED',
          activationStatus: 'COMPLETED',
          activatedAt: now,
          updatedAt: now,
        },
        $push: { auditTrail: auditEntry } as any,
      },
    );

    // 5. Send Web 3 Activation Email
    if (this.mailService && customerEmail) {
      const web3Url = process.env.WEB3_URL || 'http://localhost:3003';
      this.mailService
        .sendWeb3ActivationNotification({
          to: customerEmail,
          companyName: contract.customer?.companyName || contract.organizationName || 'Doanh nghiệp',
          contractNumber: contract.contractNumber,
          serviceMode: contract.serviceMode,
          screensQuota,
          portalUrl: web3Url,
        })
        .catch((e) => console.warn('Failed to send Web 3 activation email:', e));
    }

    return {
      success: true,
      contractId: contract._id.toString(),
      contractNumber: contract.contractNumber,
      organizationId: orgId.toString(),
      serviceMode: contract.serviceMode,
      screensQuota,
      programsQuota,
      storageGb,
      roleAssigned: 'ORGANIZATION_OWNER',
      managedProjectId: createdProjectId,
      web3PortalUrl: process.env.WEB3_URL || 'http://localhost:3003',
      message: 'Automatic Web 3 activation completed successfully.',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. GET CONTRACT INVOICE & PAYMENT DETAILS (VIETQR)
  // ─────────────────────────────────────────────────────────────────────────────
  async getContractInvoice(contractIdOrNumber: string) {
    let contract: any = null;
    let invoice: any = null;

    // 1. Try finding contract by _id or contractNumber
    const contractQuery: any = {};
    if (Types.ObjectId.isValid(contractIdOrNumber)) {
      contractQuery.$or = [{ _id: new Types.ObjectId(contractIdOrNumber) }, { contractNumber: contractIdOrNumber }];
    } else {
      contractQuery.contractNumber = contractIdOrNumber;
    }
    contract = await this.contractsCol.findOne(contractQuery);

    // 2. If not found by contract, check if contractIdOrNumber is an invoice _id or invoiceNumber
    if (!contract) {
      const invQuery: any = {};
      if (Types.ObjectId.isValid(contractIdOrNumber)) {
        invQuery.$or = [
          { _id: new Types.ObjectId(contractIdOrNumber) },
          { invoiceNumber: contractIdOrNumber },
          { invoice_number: contractIdOrNumber },
        ];
      } else {
        invQuery.$or = [
          { invoiceNumber: contractIdOrNumber },
          { invoice_number: contractIdOrNumber },
        ];
      }
      invoice = await this.invoicesCol.findOne(invQuery);
      if (invoice) {
        if (invoice.contractId && Types.ObjectId.isValid(invoice.contractId)) {
          contract = await this.contractsCol.findOne({ _id: new Types.ObjectId(invoice.contractId) });
        } else if (invoice.contractNumber) {
          contract = await this.contractsCol.findOne({ contractNumber: invoice.contractNumber });
        }
      }
    }

    if (!contract && !invoice) {
      throw new NotFoundException('Hợp đồng hoặc hóa đơn không tồn tại.');
    }

    // Allow invoice generation and QR payment anytime during contract lifecycle
    const isBothSigned =
      contract &&
      contract.signingProcess?.customerSigningStatus === 'SIGNED' &&
      contract.signingProcess?.providerSigningStatus === 'SIGNED';

    // Find invoice if not already loaded
    if (!invoice && contract) {
      invoice = await this.invoicesCol.findOne({
        $or: [
          { contractId: contract._id.toString() },
          { contractNumber: contract.contractNumber },
        ],
      });
    }

    if (!invoice && contract) {
      const now = new Date();
      const invoiceNumber = `INV-${contract.contractNumber.replace('ALSM-CTR-', '')}`;
      const subtotal = contract.commercialTerms?.subtotal || Math.round((contract.totalValue || 0) / 1.1);
      const vatRate = contract.commercialTerms?.vatRate || 10;
      const taxAmount = contract.commercialTerms?.vatAmount || Math.round((contract.totalValue || 0) - subtotal);
      const total = contract.commercialTerms?.totalValue || contract.totalValue || 0;

      const newInvoice = {
        _id: new Types.ObjectId(),
        invoiceNumber,
        invoice_number: invoiceNumber,
        contractId: contract._id.toString(),
        contractNumber: contract.contractNumber,
        organizationId: contract.organizationId,
        organizationName: contract.customer?.companyName || contract.organizationName,
        customerName: contract.customer?.representativeName || 'Customer Signatory',
        customerEmail: contract.customer?.contactEmail || '',
        amount: total,
            amountVnd: total,
            subtotalVnd: subtotal,
        vatRate,
        taxAmountVnd: taxAmount,
        currency: contract.currency || 'VND',
        status: 'ISSUED',
        dueDate: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72 hours payment deadline
        items: [
          {
            description: `Enterprise Modernization Program (${contract.serviceMode}) - ${contract.scope?.screensQuota || 100} screens`,
            quantity: 1,
            unitPrice: subtotal,
            amount: subtotal,
          },
        ],
        paymentMethod: 'VIETQR_BANK_TRANSFER',
        createdAt: now,
        updatedAt: now,
      };

      await this.invoicesCol.insertOne(newInvoice);
      invoice = newInvoice;
    }

    // Proactively check Casso transactions if invoice is not yet marked as PAID
    if (invoice && invoice.status !== 'PAID') {
      try {
        const paymentService = this.moduleRef?.get(PaymentService, { strict: false });
        if (paymentService) {
          const syncRes = await paymentService.syncCassoTransactions();
          if (syncRes?.matched && syncRes.matched > 0) {
            const reloadedInv = await this.invoicesCol.findOne({ _id: invoice._id });
            if (reloadedInv) invoice = reloadedInv;
            const reloadedCtr = await this.contractsCol.findOne({ _id: contract._id });
            if (reloadedCtr) contract = reloadedCtr;
          }
        }
      } catch (e: any) {
        // non-fatal Casso sync error
      }
    }

    const bankId = '970422'; // MB Bank BIN
    const accountNumber = '0899886249';
    const accountName = 'ALSM TECHNOLOGY SOLUTIONS';
    const refCode = `ALSM ${invoice.invoiceNumber}`;
    const amount = invoice.amount || 0;
    const qrDataUrl = await generateCleanBankQrDataUrl({
      bankBin: bankId,
      accountNumber,
      accountName,
      amount,
      message: refCode,
    });

    // ─── DEBUG LOGGING: getContractInvoice response ───────────────
    const responsePayload = {
      invoiceId: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      contractId: contract._id.toString(),
      contractNumber: contract.contractNumber,
      organizationName: invoice.organizationName || contract.customer?.companyName || contract.organizationName,
      customerName: invoice.customerName,
      customerEmail: invoice.customerEmail,
      amountVnd: invoice.amount,
      subtotalVnd: invoice.subtotalVnd || Math.round(invoice.amount / 1.1),
      taxAmountVnd: invoice.taxAmountVnd || Math.round(invoice.amount - (invoice.subtotalVnd || invoice.amount / 1.1)),
      vatRate: invoice.vatRate || 10,
      currency: invoice.currency || 'VND',
      status: invoice.status,
      dueDate: invoice.dueDate,
      items: invoice.items || [],
      paymentMethod: invoice.paymentMethod,
      qrDataUrl,
      bankName: 'MB Bank (Military Commercial Joint Stock Bank)',
      accountNumber,
      accountName,
      referenceCode: refCode,
      paidAt: invoice.paidAt || null,
      serviceMode: contract.serviceMode,
      screensQuota: contract.scope?.screensQuota || 1000,
      web3PortalUrl: process.env.WEB3_URL || 'http://localhost:3003',
    };


    return responsePayload;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. SUBMIT & CONFIRM PAYMENT & SIMULATION WORKFLOW
  // ─────────────────────────────────────────────────────────────────────────────
  async submitContractPayment(
    contractId: string,
    dto: SubmitContractPaymentDto,
    actorUserId: string,
    userEmail?: string,
  ) {
    const query: any = {};
    if (Types.ObjectId.isValid(contractId)) {
      query.$or = [{ _id: new Types.ObjectId(contractId) }, { contractNumber: contractId }];
    } else {
      query.contractNumber = contractId;
    }

    let contract = await this.contractsCol.findOne(query);
    if (!contract) {
      let inv = await this.invoicesCol.findOne({
        $or: [
          { invoiceNumber: contractId },
          { invoice_number: contractId },
        ],
      });

      // Normalized fallback if hyphens or prefixes (DEMO, ALSM) were omitted by bank
      if (!inv) {
        const cleanInput = contractId.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const allInvoices = await this.invoicesCol.find({}).toArray();
        inv = allInvoices.find((candidate: any) => {
          const cleanInv = (candidate.invoiceNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const cleanCtr = (candidate.contractNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const strippedInv = cleanInv.replace(/^(DEMO|ALSM)/, '');
          const strippedCtr = cleanCtr.replace(/^(ALSM)/, '');
          return (
            cleanInv === cleanInput ||
            cleanCtr === cleanInput ||
            cleanInv.includes(cleanInput) ||
            cleanInput.includes(cleanInv) ||
            (cleanInput.length >= 6 && cleanInv.endsWith(cleanInput.slice(-6))) ||
            (strippedInv.length >= 6 && cleanInput.includes(strippedInv))
          );
        }) || null;
        if (inv) {
        }
      }

      if (inv) {
        if (inv.contractId && Types.ObjectId.isValid(inv.contractId)) {
          contract = await this.contractsCol.findOne({ _id: new Types.ObjectId(inv.contractId) });
        } else if (inv.contractNumber) {
          contract = await this.contractsCol.findOne({ contractNumber: inv.contractNumber });
        }
      }
    }
    if (!contract) throw new NotFoundException('Contract not found.');

    const isCustomerSigned =
      contract.signingProcess?.customerSigningStatus === 'SIGNED' ||
      contract.status === 'SIGNED' ||
      contract.status === 'Signed' ||
      contract.status === 'Pending Payment' ||
      contract.status === 'PENDING_PAYMENT' ||
      contract.status === 'ACTIVE' ||
      contract.status === 'Active' ||
      contract.lifecycleStatus === 'COMPLETED' ||
      contract.lifecycleStatus === 'CUSTOMER_SIGNED';

    if (!isCustomerSigned) {
      throw new BadRequestException('The contract must be digitally signed before submitting payment.');
    }

    const now = new Date();
    const auditEntry = {
      id: randomUUID(),
      action: 'PAYMENT_SUBMITTED',
      actorUserId: userEmail || actorUserId,
      actorName: contract.customer?.representativeName || contract.organizationName || 'Customer Signatory',
      timestamp: now.toISOString(),
      details: `Payment transfer completed & submitted by customer. Ref: ${dto.transactionRef || 'BANK-TRANSFER'}. Notes: ${dto.note || 'Transfer verified on mobile banking'}. Awaiting Admin verification.`,
    };

    await this.invoicesCol.updateOne(
      {
        $or: [
          { contractId: contract._id.toString() },
          { contractNumber: contract.contractNumber },
        ],
      },
      {
        $set: {
          status: 'PAYMENT_SUBMITTED',
          customerSubmittedAt: now,
          transactionRef: dto.transactionRef,
          updatedAt: now,
        },
      },
    );

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          status: 'Payment Verification',
          paymentStatus: 'Payment Submitted',
          lifecycleStatus: 'CUSTOMER_SIGNED',
          updatedAt: now,
        },
        $push: { auditTrail: auditEntry } as any,
      },
    );

    return this.getContractDetail(contract._id.toString());
  }

  async confirmContractPayment(
    contractId: string,
    dto: ConfirmContractPaymentDto,
    adminUserId: string,
  ) {
    const query: any = {};
    if (Types.ObjectId.isValid(contractId)) {
      query.$or = [{ _id: new Types.ObjectId(contractId) }, { contractNumber: contractId }];
    } else {
      query.contractNumber = contractId;
    }

    let contract = await this.contractsCol.findOne(query);
    if (!contract) {
      let inv = await this.invoicesCol.findOne({
        $or: [
          { invoiceNumber: contractId },
          { invoice_number: contractId },
        ],
      });

      // Normalized fallback if hyphens or prefixes (DEMO, ALSM) were omitted by bank
      if (!inv) {
        const cleanInput = contractId.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const allInvoices = await this.invoicesCol.find({}).toArray();
        inv = allInvoices.find((candidate: any) => {
          const cleanInv = (candidate.invoiceNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const cleanCtr = (candidate.contractNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const strippedInv = cleanInv.replace(/^(DEMO|ALSM)/, '');
          const strippedCtr = cleanCtr.replace(/^(ALSM)/, '');
          return (
            cleanInv === cleanInput ||
            cleanCtr === cleanInput ||
            cleanInv.includes(cleanInput) ||
            cleanInput.includes(cleanInv) ||
            (cleanInput.length >= 6 && cleanInv.endsWith(cleanInput.slice(-6))) ||
            (strippedInv.length >= 6 && cleanInput.includes(strippedInv))
          );
        }) || null;
        if (inv) {
        }
      }

      if (inv) {
        if (inv.contractId && Types.ObjectId.isValid(inv.contractId)) {
          contract = await this.contractsCol.findOne({ _id: new Types.ObjectId(inv.contractId) });
        } else if (inv.contractNumber) {
          contract = await this.contractsCol.findOne({ contractNumber: inv.contractNumber });
        }
      }
    }
    if (!contract) throw new NotFoundException('Contract not found.');

    // Idempotency check: prevent duplicate payment confirmations and duplicate quota provisioning
    if (contract.paymentStatus === 'Payment Verified' && (contract.status === 'Active' || contract.status === 'ACTIVE') && contract.activationStatus === 'COMPLETED') {
      return {
        success: true,
        alreadyConfirmed: true,
        message: 'Payment already verified and organization quotas already provisioned.',
        contract: await this.getContractDetail(contract._id.toString()),
      };
    }

    const now = new Date();
    const auditEntry = {
      id: randomUUID(),
      action: 'PAYMENT_VERIFIED',
      actorUserId: adminUserId,
      actorName: 'Admin / Finance Officer',
      timestamp: now.toISOString(),
      details: `Payment verified and confirmed by Admin. Note: ${dto?.note || 'Bank transfer verified against statement'}. Web 3 Partner Portal activated and provisioned.`,
    };

    await this.invoicesCol.updateOne(
      {
        $or: [
          { contractId: contract._id.toString() },
          { contractNumber: contract.contractNumber },
        ],
      },
      {
        $set: {
          status: 'PAID',
          paidAt: now,
          amountVnd: contract.commercialTerms?.totalValue || contract.totalValue,
          verifiedBy: adminUserId,
          updatedAt: now,
        },
      },
    );

    const customerSigner = contract.signingProcess?.customerSigner || {
      name: contract.customer?.representativeName || 'Authorized Signatory',
      title: contract.customer?.representativeTitle || 'Director',
      email: contract.customer?.contactEmail || '',
      signedAt: now.toISOString(),
      method: 'VIETQR_PAYMENT_ASSURANCE',
      certificate: 'AUTO-VERIFIED-BY-BANK',
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          status: 'Active',
          paymentStatus: 'Payment Verified',
          lifecycleStatus: 'COMPLETED',
          activationStatus: 'COMPLETED',
          'signingProcess.customerSigningStatus': 'SIGNED',
          'signingProcess.customerSigner': customerSigner,
          'signingStatus.customer': true,
          signedDate: contract.signedDate || now.toISOString().slice(0, 10),
          updatedAt: now,
        },
        $push: { auditTrail: auditEntry } as any,
      },
    );

    const activation = await this.activateContractAndProvisionWeb3(
      contract._id.toString(),
      adminUserId,
      { force: true, reason: 'Payment confirmed & verified by Admin' },
    );

    const updated = await this.getContractDetail(contract._id.toString());
    return {
      success: true,
      activation,
      contract: updated,
    };
  }

  async generateContractFromPackage(
    dto: GenerateContractFromPackageDto,
    actorUserId: string,
    userEmail?: string,
  ) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const randomSuffix = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
    const contractNumber = `ALSM-CTR-${year}-${randomSuffix}`;

    let screensQuota = 100;
    let programsQuota = 50;
    let storageGb = 20;
    let subtotal = 50000000;
    let packageTitle = 'Starter Modernization Package';

    if (dto.packageTier === 'GROWTH') {
      screensQuota = 500;
      programsQuota = 250;
      storageGb = 50;
      subtotal = 200000000;
      packageTitle = 'Growth Modernization Package';
    } else if (dto.packageTier === 'ENTERPRISE') {
      screensQuota = 1000;
      programsQuota = 500;
      storageGb = 100;
      subtotal = 450000000;
      packageTitle = 'Enterprise Full Scale Modernization';
    } else if (dto.packageTier === 'CUSTOM') {
      screensQuota = dto.customScreensQuota || 1500;
      programsQuota = Math.round(screensQuota / 2);
      storageGb = Math.round(screensQuota / 10);
      subtotal = screensQuota * 400000;
      packageTitle = 'Custom Tailored Modernization';
    }

    const vatRate = 10;
    const vatAmount = Math.round(subtotal * (vatRate / 100));
    const totalValue = subtotal + vatAmount;

    const companyName = dto.organizationName || 'Enterprise Partner';
    const contactEmail = dto.contactEmail || userEmail || 'customer@enterprise.io';
    const repName = dto.representativeName || 'Authorized Signatory';
    const repTitle = dto.representativeTitle || 'Managing Director';

    const effectiveDate = now.toISOString().slice(0, 10);
    const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const endDate = oneYearLater.toISOString().slice(0, 10);

    const contractDoc: any = {
      _id: new Types.ObjectId(),
      contractNumber,
      title: `${packageTitle} (${dto.serviceMode}) — ${companyName}`,
      serviceMode: dto.serviceMode,
      contractType: dto.serviceMode === 'SELF_SERVICE' ? 'SELF_SERVICE_SUBSCRIPTION' : 'ENTERPRISE_HYBRID_MSA',
      organizationName: companyName,
      plan: packageTitle,
      effectiveDate,
      endDate,
      status: 'Pending Signature',
      lifecycleStatus: 'READY_FOR_SIGNATURE',
      activationStatus: 'NOT_ELIGIBLE',
      paymentStatus: 'Not Required',
      totalValue,
      currency: 'VND',
      customer: {
        companyName,
        taxId: dto.taxId || '0109988776',
        businessAddress: dto.businessAddress || 'Enterprise Headquarters',
        representativeName: repName,
        representativeTitle: repTitle,
        contactEmail,
      },
      parties: {
        provider: {
          legalName: 'ALSM Technology Solutions JSC',
          brandName: 'ALSM Enterprise Platform',
          taxId: '0109876543',
          headquarters: '8th Floor, ALSM Modernization Center, Duy Tan, Cau Giay, Hanoi, Vietnam',
          signatoryName: 'Dr. Nguyen Van Tien',
          signatoryTitle: 'General Director / Legal Representative',
          contactEmail: 'contracts@alsm.io',
        },
        customer: {
          legalName: companyName,
          taxId: dto.taxId || '0109988776',
          businessAddress: dto.businessAddress || 'Enterprise Headquarters',
          representativeName: repName,
          representativeTitle: repTitle,
          contactEmail,
        },
      },
      scope: {
        screensQuota,
        programsQuota,
        storageGb,
        targetTechnology: 'React 19 + TypeScript + Spring Boot 3 Java',
        sourceCodeType: 'IBM 3270 BMS / AS400 DSPF & COBOL Logic',
        supportTier: dto.packageTier === 'ENTERPRISE' ? 'Mission-Critical SLA (2h response)' : 'Standard Enterprise SLA (4h response)',
        slaCommitment: '99.9% AST Validation & Runtime Equivalence Guarantee',
        deliverables: [
          'Synthesized React 19 UI component repository with Tailwind styles',
          'Spring Boot 3 Java DTO contracts and JPA entities',
          'AST semantic equivalence & rule verification dossier',
          'Deployment architecture blueprint and migration runbook',
        ],
      },
      commercialTerms: {
        subtotal,
        discountPercent: 0,
        discountAmount: 0,
        vatRate,
        vatAmount,
        totalValue,
        currency: 'VND',
        paymentStructure: 'FULL_OR_MILESTONE',
        bankAccountInfo: 'MB Bank — Account: 0899886249 (ALSM TECHNOLOGY SOLUTIONS)',
        paymentTermsDays: 'Net 15 days upon signing',
      },
      clauses: DEFAULT_LEGAL_CLAUSES,
      signingProcess: {
        providerSigningStatus: 'SIGNED',
        customerSigningStatus: 'NOT_SIGNED',
        alsmSigner: {
          name: 'Dr. Nguyen Van Tien',
          title: 'General Director',
          email: 'contracts@alsm.io',
          signedAt: now.toISOString(),
          certificateReference: 'ALSM-ECA-OFFICIAL',
        },
        customerSigner: null,
      },
      auditTrail: [
        {
          id: randomUUID(),
          action: 'CONTRACT_GENERATED_FROM_PACKAGE',
          actorUserId,
          actorName: repName,
          timestamp: now.toISOString(),
          details: `Contract generated based on selected package: ${packageTitle} (${dto.serviceMode}). Quota: ${screensQuota} screens, ${programsQuota} programs. Total Value: ${totalValue.toLocaleString('en-US')} VND.`,
        },
      ],
      createdByUserId: Types.ObjectId.isValid(actorUserId) ? new Types.ObjectId(actorUserId) : actorUserId,
      createdAt: now,
      updatedAt: now,
    };

    await this.contractsCol.insertOne(contractDoc);
    return await this.mapFullContract(contractDoc);
  }

  async getOrCreateContractInvoice(contract: any) {
    const invoice = await this.invoicesCol.findOne({
      $or: [
        { contractId: contract._id.toString() },
        { contractNumber: contract.contractNumber },
      ],
    });

    if (invoice) return invoice;

    const isDemoMode = process.env.DEMO_MODE !== 'false';
    const now = new Date();
    const prefix = isDemoMode ? 'DEMO-INV-' : 'INV-';
    const invoiceNumber = `${prefix}${contract.contractNumber.replace('ALSM-CTR-', '')}`;

    const subtotal = contract.commercialTerms?.subtotal || Math.round((contract.totalValue || 0) / 1.1);
    const vatRate = contract.commercialTerms?.vatRate || 10;
    const taxAmount = contract.commercialTerms?.vatAmount || Math.round((contract.totalValue || 0) - subtotal);
    const total = contract.commercialTerms?.totalValue || contract.totalValue || 0;

    const newInvoice = {
      _id: new Types.ObjectId(),
      invoiceNumber,
      invoice_number: invoiceNumber,
      isDemo: isDemoMode,
      invoiceType: isDemoMode ? 'DEMO_INVOICE' : 'OFFICIAL_VAT_INVOICE',
      contractId: contract._id.toString(),
      contractNumber: contract.contractNumber,
      organizationId: contract.organizationId,
      organizationName: contract.customer?.companyName || contract.organizationName,
      customerName: contract.customer?.representativeName || contract.signingProcess?.customerSigner?.name || 'Customer Signatory',
      customerEmail: contract.customer?.contactEmail || contract.signingProcess?.customerSigner?.email || '',
      amount: total,
            amountVnd: total,
            subtotalVnd: subtotal,
      vatRate,
      taxAmountVnd: taxAmount,
      currency: contract.currency || 'VND',
      status: 'ISSUED',
      dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      items: [
        {
          description: `${isDemoMode ? '[DEMO] ' : ''}Enterprise Modernization Program (${contract.serviceMode}) - ${contract.scope?.screensQuota || 100} screens`,
          quantity: 1,
          unitPrice: subtotal,
          amount: subtotal,
        },
      ],
      paymentMethod: 'VIETQR_BANK_TRANSFER',
      createdAt: now,
      updatedAt: now,
    };

    await this.invoicesCol.insertOne(newInvoice);

    const auditEntry = {
      id: randomUUID(),
      action: 'INVOICE_GENERATED',
      actorUserId: 'SYSTEM_BILLING_ENGINE',
      actorName: 'ALSM Billing Engine',
      timestamp: now.toISOString(),
      details: `${isDemoMode ? 'Demo Invoice' : 'VAT Invoice'} ${invoiceNumber} generated for amount ${total.toLocaleString('en-US')} VND. Bank transfer QR code active.`,
    };
    await this.contractsCol.updateOne(
      { _id: contract._id },
      { $push: { auditTrail: auditEntry } as any },
    );

    return newInvoice;
  }

  async simulateContractPayment(contractIdOrNumber: string) {
    const query: any = {};
    if (Types.ObjectId.isValid(contractIdOrNumber)) {
      query.$or = [{ _id: new Types.ObjectId(contractIdOrNumber) }, { contractNumber: contractIdOrNumber }];
    } else {
      query.contractNumber = contractIdOrNumber;
    }

    let contract = await this.contractsCol.findOne(query);
    if (!contract) {
      const invQuery: any = {};
      if (Types.ObjectId.isValid(contractIdOrNumber)) {
        invQuery.$or = [
          { _id: new Types.ObjectId(contractIdOrNumber) },
          { invoiceNumber: contractIdOrNumber },
          { invoice_number: contractIdOrNumber },
        ];
      } else {
        invQuery.$or = [{ invoiceNumber: contractIdOrNumber }, { invoice_number: contractIdOrNumber }];
      }
      const inv = await this.invoicesCol.findOne(invQuery);
      if (inv) {
        if (inv.contractId && Types.ObjectId.isValid(inv.contractId)) {
          contract = await this.contractsCol.findOne({ _id: new Types.ObjectId(inv.contractId) });
        } else if (inv.contractNumber) {
          contract = await this.contractsCol.findOne({ contractNumber: inv.contractNumber });
        }
      }
    }

    if (!contract) throw new NotFoundException('Contract not found.');

    // Step 1: customer submit payment
    await this.submitContractPayment(
      contract._id.toString(),
      { transactionRef: 'DEMO-SIM-TRANS-' + Date.now().toString().slice(-6), note: 'Simulated payment completed by customer in Demo Mode' },
      'DEMO_CUSTOMER',
      contract.customer?.contactEmail,
    );

    // Step 2: admin verify & confirm payment -> triggers activation & quota provisioning
    const confirmResult = await this.confirmContractPayment(
      contract._id.toString(),
      { note: 'Demo payment automatically verified by Admin Simulator' },
      'ADMIN_SIMULATOR',
    );

    return {
      success: true,
      status: 'PAID',
      paymentStatus: 'Payment Verified',
      contractStatus: 'Active',
      paidAt: new Date().toISOString(),
      activation: confirmResult.activation,
      contract: confirmResult.contract,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 14. RETRY PROVISIONING (ADMIN WEB 2)
  // ─────────────────────────────────────────────────────────────────────────────
  async retryProvisioning(contractId: string, actorUserId: string) {
    return this.activateContractAndProvisionWeb3(contractId, actorUserId, {
      force: true,
      reason: 'Admin manual retry provisioning',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. AMENDMENTS & RENEWALS
  // ─────────────────────────────────────────────────────────────────────────────
  async amendContract(contractId: string, dto: AmendContractDto, actorUserId: string) {
    const contract = await this.contractsCol.findOne({
      _id: new Types.ObjectId(contractId),
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    const now = new Date();
    const amendmentNumber = `AMD-${contract.contractNumber}-${(contract.amendments?.length || 0) + 1}`;

    const amendmentRecord = {
      id: randomUUID(),
      amendmentNumber,
      title: dto.amendmentTitle,
      effectiveDate: dto.effectiveDate,
      changesSummary: dto.changesSummary,
      additionalValue: dto.additionalValue || 0,
      additionalScreensQuota: dto.additionalScreensQuota || 0,
      status: 'APPROVED',
      createdAt: now.toISOString(),
    };

    // If quota increases, update contract scope
    const newQuota = (contract.scope?.screensQuota || 0) + (dto.additionalScreensQuota || 0);
    const newTotal = (contract.totalValue || 0) + (dto.additionalValue || 0);

    const auditEntry = {
      id: randomUUID(),
      action: 'CONTRACT_AMENDMENT_CREATED',
      actorUserId,
      actorName: 'Contract Administrator',
      timestamp: now.toISOString(),
      details: `Amendment ${amendmentNumber} recorded. ${dto.changesSummary}.`,
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          'scope.screensQuota': newQuota,
          maxScreens: newQuota,
          remainingScreens: (contract.remainingScreens || 0) + (dto.additionalScreensQuota || 0),
          totalValue: newTotal,
          updatedAt: now,
        },
        $push: {
          amendments: amendmentRecord,
          auditTrail: auditEntry,
        } as any,
      },
    );

    return this.getContractDetail(contractId);
  }

  async renewContract(contractId: string, renewalMonths: number = 12, actorUserId: string) {
    const contract = await this.contractsCol.findOne({
      _id: new Types.ObjectId(contractId),
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    const now = new Date();
    const currentEnd = new Date(contract.endDate || now);
    currentEnd.setMonth(currentEnd.getMonth() + renewalMonths);
    const newEndDate = currentEnd.toISOString().slice(0, 10);

    const renewalRecord = {
      id: randomUUID(),
      renewedAt: now.toISOString(),
      additionalMonths: renewalMonths,
      previousEndDate: contract.endDate,
      newEndDate,
      status: 'ACTIVE',
    };

    const auditEntry = {
      id: randomUUID(),
      action: 'CONTRACT_RENEWED',
      actorUserId,
      actorName: 'Account Executive',
      timestamp: now.toISOString(),
      details: `Contract extended by ${renewalMonths} months. New expiration date: ${newEndDate}.`,
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          endDate: newEndDate,
          status: 'ACTIVE',
          updatedAt: now,
        },
        $push: {
          renewals: renewalRecord,
          auditTrail: auditEntry,
        } as any,
      },
    );

    return this.getContractDetail(contractId);
  }

  async terminateContract(contractId: string, dto: TerminateContractDto, actorUserId: string) {
    const contract = await this.contractsCol.findOne({
      _id: new Types.ObjectId(contractId),
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    const now = new Date();
    const auditEntry = {
      id: randomUUID(),
      action: 'CONTRACT_TERMINATED',
      actorUserId,
      actorName: 'Legal Compliance Officer',
      timestamp: now.toISOString(),
      details: `Contract terminated on ${dto.effectiveTerminationDate}. Reason: ${dto.reason}`,
    };

    await this.contractsCol.updateOne(
      { _id: contract._id },
      {
        $set: {
          status: 'TERMINATED',
          lifecycleStatus: 'TERMINATED',
          terminationReason: dto.reason,
          terminatedAt: now,
          updatedAt: now,
        },
        $push: { auditTrail: auditEntry } as any,
      },
    );

    return this.getContractDetail(contractId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. TEMPLATES & CLAUSES LIBRARY
  // ─────────────────────────────────────────────────────────────────────────────
  getTemplatesAndClauses() {
    return {
      templates: [
        {
          id: 'tmpl-msa-hybrid',
          title: CONTRACT_TITLES.ENTERPRISE_HYBRID_MSA.titleEn || CONTRACT_TITLES.ENTERPRISE_HYBRID_MSA.titleVi,
          titleVi: CONTRACT_TITLES.ENTERPRISE_HYBRID_MSA.titleVi,
          titleEn: CONTRACT_TITLES.ENTERPRISE_HYBRID_MSA.titleEn,
          type: 'ENTERPRISE_HYBRID_MSA',
          version: 'v2026.1',
          status: 'APPROVED',
          jurisdiction: 'Vietnam Civil & Commercial Law / Electronic Transactions Law 2023',
          summary:
            'Comprehensive legal framework covering modernization platform licensing and managed conversion services with AST acceptance commitments.',
        },
        {
          id: 'tmpl-sow-managed',
          title: CONTRACT_TITLES.MANAGED_CONVERSION_SOW.titleEn || CONTRACT_TITLES.MANAGED_CONVERSION_SOW.titleVi,
          titleVi: CONTRACT_TITLES.MANAGED_CONVERSION_SOW.titleVi,
          titleEn: CONTRACT_TITLES.MANAGED_CONVERSION_SOW.titleEn,
          type: 'MANAGED_CONVERSION_SOW',
          version: 'v2026.1',
          status: 'APPROVED',
          jurisdiction: 'Commercial Law & Law on Electronic Transactions 2023',
          summary:
            'Statement of Work for legacy codebase modernization (BMS, DSPF, COBOL) to React 19 and Spring Boot 3 Java with milestone acceptance and AST validation dossier.',
        },
        {
          id: 'tmpl-sub-self-service',
          title: CONTRACT_TITLES.SELF_SERVICE_SUBSCRIPTION.titleEn || CONTRACT_TITLES.SELF_SERVICE_SUBSCRIPTION.titleVi,
          titleVi: CONTRACT_TITLES.SELF_SERVICE_SUBSCRIPTION.titleVi,
          titleEn: CONTRACT_TITLES.SELF_SERVICE_SUBSCRIPTION.titleEn,
          type: 'SELF_SERVICE_SUBSCRIPTION',
          version: 'v2026.1',
          status: 'APPROVED',
          jurisdiction: 'Vietnam Law on Electronic Transactions 2023',
          summary:
            'Tiered access to ALSM Studio platform enabling customer technical teams to autonomously analyze and convert legacy code.',
        },
        {
          id: 'tmpl-nda-confidentiality',
          title: CONTRACT_TITLES.NON_DISCLOSURE_AGREEMENT.titleEn || CONTRACT_TITLES.NON_DISCLOSURE_AGREEMENT.titleVi,
          titleVi: CONTRACT_TITLES.NON_DISCLOSURE_AGREEMENT.titleVi,
          titleEn: CONTRACT_TITLES.NON_DISCLOSURE_AGREEMENT.titleEn,
          type: 'NON_DISCLOSURE_AGREEMENT',
          version: 'v2026.1',
          status: 'APPROVED',
          jurisdiction: 'Decree 13/2023/ND-CP & Cyber Information Security Law',
          summary:
            'Mutual non-disclosure terms protecting trade secrets, banking legacy codebase, and proprietary data compliance.',
        },
        {
          id: 'tmpl-order-form',
          title: CONTRACT_TITLES.ORDER_FORM.titleEn || CONTRACT_TITLES.ORDER_FORM.titleVi,
          titleVi: CONTRACT_TITLES.ORDER_FORM.titleVi,
          titleEn: CONTRACT_TITLES.ORDER_FORM.titleEn,
          type: 'ORDER_FORM',
          version: 'v2026.1',
          status: 'APPROVED',
          jurisdiction: 'Vietnam Commercial Law',
          summary:
            'Order form for purchasing additional modernization screen conversion quota or batch logic volume under the active Master Agreement.',
        },
        {
          id: 'tmpl-amendment',
          title: CONTRACT_TITLES.CONTRACT_AMENDMENT.titleEn || CONTRACT_TITLES.CONTRACT_AMENDMENT.titleVi,
          titleVi: CONTRACT_TITLES.CONTRACT_AMENDMENT.titleVi,
          titleEn: CONTRACT_TITLES.CONTRACT_AMENDMENT.titleEn,
          type: 'CONTRACT_AMENDMENT',
          version: 'v2026.1',
          status: 'APPROVED',
          jurisdiction: 'Civil Code 2015',
          summary:
            'Contract amendment addendum for extending terms, adjusting scope, or modifying commercial conditions of existing contracts.',
        },
      ],
      clauses: STANDARD_LEGAL_ARTICLES.map((a) => ({
        articleNumber: a.articleNumber,
        category: a.category,
        title: a.titleEn || a.titleVi,
        titleVi: a.titleVi,
        titleEn: a.titleEn,
        description: a.contentEn || a.contentVi,
        descriptionVi: a.contentVi,
        descriptionEn: a.contentEn,
        legalReference: a.legalReference,
        isMandatory: a.isMandatory,
      })),
      appendices: CONTRACT_APPENDICES.map((ap) => ({
        id: ap.id,
        title: ap.titleEn || ap.titleVi,
        titleEn: ap.titleEn,
        titleVi: ap.titleVi,
        summary: ap.summaryEn || ap.summaryVi,
        summaryEn: ap.summaryEn,
        summaryVi: ap.summaryVi,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 14. SELECTABLE CUSTOMERS (ORGS & CONVERTED LEADS)
  // ─────────────────────────────────────────────────────────────────────────────
  async getSelectableCustomers() {
    const orgs = await this.orgsCol.find({}).sort({ name: 1 }).limit(100).toArray();
    const leads = await this.leadsCol
      .find({ stage: { $in: ['QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON'] } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return {
      organizations: orgs.map((o) => ({
        id: o._id.toString(),
        name: o.name || 'Unnamed Organization',
        taxId: o.taxId || '',
        contactEmail: o.contactEmail || o.email || '',
        businessAddress: o.address || '',
        representativeName: o.representativeName || '',
        representativeTitle: o.representativeTitle || '',
      })),
      leads: leads.map((l) => ({
        id: l._id.toString(),
        companyName: l.company || l.companyName || '',
        contactName: l.contactName || '',
        contactEmail: l.contactEmail || '',
        dealValue: l.dealValue || 0,
        stage: l.stage,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 15. VALIDATE CONTRACT INTEGRITY & READINESS
  // ─────────────────────────────────────────────────────────────────────────────
  async validateContractIntegrity(contractIdOrNumber: string) {
    let contract: any = null;
    if (Types.ObjectId.isValid(contractIdOrNumber)) {
      contract = await this.contractsCol.findOne({ _id: new Types.ObjectId(contractIdOrNumber) });
    }
    if (!contract) {
      contract = await this.contractsCol.findOne({ contractNumber: contractIdOrNumber });
    }
    if (!contract) throw new NotFoundException('Contract not found.');

    return EnterpriseContractValidator.validate(contract);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 16. FORMAL LEGAL HTML DOCUMENT RENDERER (Clean Corporate Styling)
  // ─────────────────────────────────────────────────────────────────────────────
  renderContractHtml(contract: any, locale: 'vi' | 'en' | 'vi-en' = 'vi'): string {
    const configDict = {
      PROVIDER_LEGAL_NAME: this.config?.get<string>('PROVIDER_LEGAL_NAME'),
      PROVIDER_TAX_ID: this.config?.get<string>('PROVIDER_TAX_ID'),
      PROVIDER_REGISTERED_ADDRESS: this.config?.get<string>('PROVIDER_REGISTERED_ADDRESS'),
      PROVIDER_REPRESENTATIVE_NAME: this.config?.get<string>('PROVIDER_REPRESENTATIVE_NAME'),
      PROVIDER_REPRESENTATIVE_TITLE: this.config?.get<string>('PROVIDER_REPRESENTATIVE_TITLE'),
      PROVIDER_CONTACT_PHONE: this.config?.get<string>('PROVIDER_CONTACT_PHONE'),
      PROVIDER_CONTACT_EMAIL: this.config?.get<string>('PROVIDER_CONTACT_EMAIL'),
    };

    const docData = buildContractDocumentData(contract, configDict);

    const isSigned =
      contract?.lifecycleStatus === 'COMPLETED' ||
      contract?.lifecycleStatus === 'CUSTOMER_SIGNED' ||
      contract?.signingProcess?.customerSigningStatus === 'SIGNED';

    const isDemoMode = Boolean(contract?.isDemoMode ?? (process.env.DEMO_MODE !== 'false'));

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>${docData.contractNumber} — ${docData.contractTitle}</title>
  <style>
    @page { size: A4; margin: 25mm 20mm 25mm 20mm; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 13pt;
      line-height: 1.5;
      color: #000000;
      background: #ffffff;
      padding: 45px 55px;
      margin: 0 auto;
      max-width: 820px;
    }
    .national-header { text-align: center; margin-bottom: 22px; }
    .national-title { font-weight: bold; font-size: 13pt; text-transform: uppercase; margin-bottom: 3px; color: #000000; }
    .national-motto { font-size: 12.5pt; font-weight: bold; margin-bottom: 6px; color: #000000; }
    .national-line { width: 160px; height: 1px; background: #000000; margin: 8px auto 20px auto; }
    .contract-title { font-size: 15pt; font-weight: bold; text-transform: uppercase; text-align: center; color: #000000; margin: 18px 0 6px 0; }
    .contract-meta { text-align: center; font-size: 11pt; color: #222222; margin-bottom: 18px; }
    .preamble { text-align: justify; font-style: italic; font-size: 11pt; color: #222222; margin-bottom: 22px; line-height: 1.55; }
    .section-title { font-size: 12.5pt; font-weight: bold; color: #000000; text-transform: uppercase; margin-top: 20px; margin-bottom: 6px; }
    .parties-block { margin-bottom: 18px; font-size: 12pt; line-height: 1.55; }
    .party-title { font-weight: bold; font-size: 12pt; text-transform: uppercase; margin-top: 14px; margin-bottom: 4px; color: #000000; }
    .party-details { padding-left: 20px; }
    .lead-in { text-align: justify; font-size: 12pt; margin: 16px 0; color: #000000; }
    .article-block { margin-top: 18px; margin-bottom: 16px; text-align: justify; }
    .article-title { font-weight: bold; font-size: 12pt; color: #000000; text-transform: uppercase; margin-bottom: 6px; }
    .article-item { font-size: 12pt; line-height: 1.55; color: #000000; margin-bottom: 6px; text-align: justify; }
    .article-subitem { font-size: 12pt; line-height: 1.55; color: #000000; padding-left: 24px; margin-bottom: 4px; text-align: justify; }
    .signature-closing { text-align: justify; font-style: italic; font-size: 11pt; color: #222222; margin-top: 28px; margin-bottom: 24px; line-height: 1.5; }
    .signature-row { display: flex; justify-content: space-between; margin-top: 20px; page-break-inside: avoid; }
    .signature-col { width: 46%; text-align: center; font-size: 11pt; }
    .sig-heading { font-weight: bold; font-size: 12pt; text-transform: uppercase; color: #000000; }
    .sig-role { font-weight: bold; font-size: 11pt; color: #222222; margin-top: 2px; }
    .sig-title-info { font-size: 11pt; color: #444444; margin-top: 4px; }
    .sig-space { min-height: 90px; margin: 12px 0; display: flex; flex-direction: column; justify-content: center; align-items: center; }
    .sig-signed-box { font-size: 10pt; line-height: 1.45; text-align: center; color: #15803d; font-weight: bold; }
    .sig-meta { font-size: 8.5pt; color: #555555; font-style: italic; margin-top: 4px; font-weight: normal; }
    .sig-unsigned-label { font-style: italic; color: #666666; font-size: 10.5pt; }
    .sig-fullname { font-weight: bold; font-size: 12pt; color: #000000; margin-top: 6px; }
    .watermark-banner {
      padding: 6px 12px;
      margin-bottom: 20px;
      text-align: center;
      font-weight: bold;
      font-size: 9pt;
      letter-spacing: 0.5px;
      border: 1px solid #d1d5db;
      color: #6b7280;
      background: #f9fafb;
    }
    .watermark-banner.demo { color: #b91c1c; border-color: #fca5a5; background: #fff5f5; }
  </style>
</head>
<body>
  
  <div class="national-header">
    <div class="national-title">${docData.nationalHeader.country}</div>
    <div class="national-motto">${docData.nationalHeader.motto}</div>
    <div class="national-line"></div>
    <div class="contract-title">${docData.contractTitle}</div>
    <div class="contract-meta">
      Số: <strong>${docData.contractNumber}</strong><br/>
      Hôm nay, ${docData.effectiveDate.dateStr}, tại văn phòng ${docData.partyA.legalName}, các Bên gồm có:
    </div>
  </div>

  <div class="preamble">
    ${docData.preamble.map(p => '- ' + p).join('<br/>')}
  </div>

  <div class="parties-block">
    <div class="party-title">${docData.partyA.roleHeader}</div>
    <div class="party-details">
      Tên doanh nghiệp: <strong>${docData.partyA.legalName}</strong><br/>
      Mã số doanh nghiệp / Mã số thuế: <strong>${docData.partyA.taxId}</strong><br/>
      Địa chỉ trụ sở chính: ${docData.partyA.address}<br/>
      Người đại diện theo pháp luật: <strong>${docData.partyA.representativeName}</strong><br/>
      Chức vụ: ${docData.partyA.representativeTitle}<br/>
      Điện thoại liên hệ: ${docData.partyA.phone}<br/>
      Thư điện tử (Email): ${docData.partyA.email}<br/>
      Tài khoản thanh toán: <strong>${docData.partyA.bankAccount || '0899886249 mở tại Ngân hàng TMCP Quân Đội (MB Bank)'}</strong>
    </div>

    <div class="party-title">${docData.partyB.roleHeader}</div>
    <div class="party-details">
      Tên doanh nghiệp: <strong>${docData.partyB.legalName}</strong><br/>
      Mã số doanh nghiệp / Mã số thuế: <strong>${docData.partyB.taxId}</strong><br/>
      Địa chỉ trụ sở: ${docData.partyB.address}<br/>
      Người đại diện theo pháp luật: <strong>${docData.partyB.representativeName}</strong><br/>
      Chức vụ: ${docData.partyB.representativeTitle}<br/>
      Điện thoại liên hệ: ${docData.partyB.phone}<br/>
      Thư điện tử (Email): ${docData.partyB.email}
    </div>
  </div>

  <div class="lead-in">
    Hai Bên cùng thống nhất ký kết Hợp đồng Dịch vụ này với các điều khoản cụ thể sau đây:
  </div>

  ${docData.articles.map(article => `
    <div class="article-block">
      <div class="article-title">${article.title}</div>
      ${article.items.map(item => `
        <div class="article-item">${item.clauseNumber}. ${item.text}</div>
        ${item.subItems ? item.subItems.map(sub => `
          <div class="article-subitem">${sub.key} ${sub.text}</div>
        `).join('') : ''}
      `).join('')}
    </div>
  `).join('')}

  <div class="signature-closing">
    Hợp đồng này được lập thành 02 bản điện tử có giá trị pháp lý như nhau. Mỗi Bên giữ 01 bản để thực hiện. Các Bên xác nhận đã đọc, hiểu rõ và hoàn toàn đồng ý với toàn bộ các điều khoản và tiến hành ký tên dưới đây.
  </div>

  <div class="signature-row">
    <div class="signature-col">
      <div class="sig-heading">${docData.signatures.partyA.title}</div>
      <div class="sig-role">${docData.signatures.partyA.roleTitle}</div>
      <div class="sig-title-info">Chức vụ: ${docData.signatures.partyA.signerTitle}</div>
      <div class="sig-space">
        ${docData.signatures.partyA.isSigned ? `
          <div class="sig-signed-box">
            ${(docData.signatures.partyA.officialSealImage || docData.signatures.partyA.signatureImage) ? `
              <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 6px;">
                ${docData.signatures.partyA.stampPosition === 'overlap' ? `
                  <div style="position: relative; width: 180px; height: 85px; display: flex; align-items: center; justify-content: center; margin: 0 auto;">
                    ${docData.signatures.partyA.officialSealImage ? `<img src="${docData.signatures.partyA.officialSealImage}" style="position: absolute; left: 10px; width: 80px; height: 80px; object-fit: contain; opacity: 0.85;" />` : ''}
                    ${docData.signatures.partyA.signatureImage ? `<img src="${docData.signatures.partyA.signatureImage}" style="position: relative; z-index: 2; max-height: 60px; max-width: 130px; object-fit: contain;" />` : ''}
                  </div>
                ` : `
                  ${docData.signatures.partyA.officialSealImage ? `<img src="${docData.signatures.partyA.officialSealImage}" style="height: 70px; width: 70px; object-fit: contain;" />` : ''}
                  ${docData.signatures.partyA.signatureImage ? `<img src="${docData.signatures.partyA.signatureImage}" style="max-height: 55px; max-width: 130px; object-fit: contain;" />` : ''}
                `}
              </div>
            ` : `<div style="font-weight: 700; color: #15803d; margin-bottom: 4px;">[ĐÃ KÝ ĐIỆN TỬ BỞI BÊN A]</div>`}
            <div class="sig-meta" style="font-size: 8pt; color: #15803d; border-top: 1px dashed #cbd5e1; padding-top: 4px;">
              ✓ Ký số xác thực: ${docData.signatures.partyA.certificateProvider || 'VNPT-CA'} (Serial: ${docData.signatures.partyA.certificateReference || 'VNPT-ECA-ALSM-01'})<br/>
              Thời gian: ${new Date(docData.signatures.partyA.signedAt || Date.now()).toLocaleString('vi-VN')}
            </div>
          </div>
        ` : `
          <div class="sig-unsigned-label">(Ký, ghi rõ họ tên và đóng dấu)</div>
        `}
      </div>
      <div class="sig-fullname">${docData.signatures.partyA.signerName}</div>
    </div>

    <div class="signature-col">
      <div class="sig-heading">${docData.signatures.partyB.title}</div>
      <div class="sig-role">${docData.signatures.partyB.roleTitle}</div>
      <div class="sig-title-info">Chức vụ: ${docData.signatures.partyB.signerTitle}</div>
      <div class="sig-space">
        ${docData.signatures.partyB.isSigned ? `
          <div class="sig-signed-box">
            [ĐÃ KÝ ĐIỆN TỬ BỞI BÊN B]
            <div class="sig-meta">
              Thời gian: ${new Date(docData.signatures.partyB.signedAt || Date.now()).toLocaleString('vi-VN')}<br/>
              Chứng chỉ: ${docData.signatures.partyB.certificateReference || 'VNPT-ECA-CLIENT-VERIFIED'}
            </div>
          </div>
        ` : `
          <div class="sig-unsigned-label">(Ký, ghi rõ họ tên và đóng dấu)</div>
        `}
      </div>
      <div class="sig-fullname">${docData.signatures.partyB.signerName}</div>
    </div>
  </div>
</body>
</html>`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────
  computeContractAndPaymentStatus(doc: any, invoice?: any): { contractStatus: string; paymentStatus: string } {
    const rawStatus = (doc.status || '').toString().trim();
    const rawLifecycle = (doc.lifecycleStatus || '').toString().trim().toUpperCase();
    const rawPayment = (doc.paymentStatus || '').toString().trim();
    const invoiceStatus = (invoice?.status || '').toString().trim().toUpperCase();

    // 1. Cancelled
    if (rawStatus.toUpperCase() === 'CANCELLED' || rawLifecycle === 'CANCELLED') {
      return { contractStatus: 'Cancelled', paymentStatus: doc.paymentStatus || 'Not Required' };
    }

    // 2. Completed
    if (rawStatus.toUpperCase() === 'COMPLETED' || rawLifecycle === 'COMPLETED_CLOSED') {
      return { contractStatus: 'Completed', paymentStatus: 'Payment Verified' };
    }

    // 3. Active / Payment Verified
    if (
      rawStatus === 'Active' ||
      rawStatus === 'ACTIVE' ||
      rawPayment === 'Payment Verified' ||
      rawPayment === 'PAYMENT_VERIFIED' ||
      invoiceStatus === 'PAID' ||
      doc.activationStatus === 'COMPLETED'
    ) {
      return { contractStatus: 'Active', paymentStatus: 'Payment Verified' };
    }

    // 4. Payment Verification / Payment Submitted
    if (
      rawStatus === 'Payment Verification' ||
      rawStatus === 'PAYMENT_VERIFICATION' ||
      rawPayment === 'Payment Submitted' ||
      rawPayment === 'PAYMENT_SUBMITTED' ||
      invoiceStatus === 'PAYMENT_SUBMITTED'
    ) {
      return { contractStatus: 'Payment Verification', paymentStatus: 'Payment Submitted' };
    }

    // 5. Signed / Pending Payment
    const isCustomerSigned =
      doc.signingProcess?.customerSigningStatus === 'SIGNED' ||
      rawStatus === 'Signed' ||
      rawStatus === 'SIGNED' ||
      rawStatus === 'Pending Payment' ||
      rawStatus === 'PENDING_PAYMENT' ||
      rawLifecycle === 'CUSTOMER_SIGNED';

    if (isCustomerSigned) {
      return { contractStatus: 'Pending Payment', paymentStatus: 'Pending Payment' };
    }

    // 6. Pending Signature
    if (
      rawStatus === 'Pending Signature' ||
      rawStatus === 'PENDING_SIGNATURE' ||
      rawLifecycle === 'SENT_TO_CUSTOMER' ||
      rawLifecycle === 'READY_FOR_SIGNATURE'
    ) {
      return { contractStatus: 'Pending Signature', paymentStatus: 'Not Required' };
    }

    // 7. Draft
    return { contractStatus: 'Draft', paymentStatus: 'Not Required' };
  }

  private mapContractSummary(doc: any, invoice?: any) {
    const isCustomerSigned =
      doc.signingProcess?.customerSigningStatus === 'SIGNED' ||
      doc.status === 'SIGNED' ||
      doc.status === 'Signed' ||
      doc.status === 'Pending Payment' ||
      doc.status === 'Payment Verification' ||
      doc.status === 'ACTIVE' ||
      doc.status === 'Active' ||
      doc.lifecycleStatus === 'COMPLETED' ||
      doc.lifecycleStatus === 'CUSTOMER_SIGNED';

    const statusPair = this.computeContractAndPaymentStatus(doc, invoice);
    const isDemoMode = process.env.DEMO_MODE !== 'false';

    return {
      id: doc._id.toString(),
      contractNumber: doc.contractNumber,
      title: doc.title,
      organizationId: doc.organizationId?.toString(),
      organizationName: doc.organizationName || doc.customer?.companyName || 'Enterprise Partner',
      serviceMode: doc.serviceMode || 'HYBRID',
      contractType: doc.contractType || 'ENTERPRISE_HYBRID_MSA',
      status: statusPair.contractStatus,
      contractStatus: statusPair.contractStatus,
      paymentStatus: statusPair.paymentStatus,
      isDemoMode,
      lifecycleStatus: doc.lifecycleStatus || 'DRAFT',
      reviewStatus: doc.reviewStatus || 'NOT_SUBMITTED',
      plan: doc.plan || 'Enterprise Core Modernization',
      effectiveDate: doc.effectiveDate,
      endDate: doc.endDate,
      signedDate: doc.signedDate,
      totalValue: doc.totalValue || doc.commercialTerms?.totalValue || 0,
      currency: doc.currency || doc.commercialTerms?.currency || 'VND',
      screensQuota: doc.scope?.screensQuota || doc.maxScreens || 100,
      remainingScreens: doc.remainingScreens ?? doc.scope?.screensQuota ?? 100,
      customer: doc.customer || {
        companyName: doc.organizationName || 'Enterprise Partner',
        taxId: '0109988776',
        businessAddress: 'Hanoi, Vietnam',
        representativeName: 'Corporate Representative',
        representativeTitle: 'Director',
        contactEmail: 'partner@enterprise.io',
      },
      signingStatus: {
        alsm: doc.signingProcess?.providerSigningStatus === 'SIGNED' || doc.status === 'ACTIVE' || doc.status === 'Active',
        customer: isCustomerSigned,
      },
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private async mapFullContract(doc: any, invoice?: any) {
    const summary = this.mapContractSummary(doc, invoice);
    const isCustomerSigned = summary.signingStatus.customer;
    const isDemoMode = process.env.DEMO_MODE !== 'false';

    let invoiceDetails: any = null;
    let qrPayment: any = null;

    // QR payment section is available immediately so customers can scan and pay anytime (even during contract signing)
    const effectiveInvoice = invoice || {
      _id: doc._id,
      invoiceNumber: `INV-${doc.contractNumber.replace('ALSM-CTR-', '')}`,
      amount: doc.totalValue || doc.commercialTerms?.totalValue || 0,
      currency: doc.currency || doc.commercialTerms?.currency || 'VND',
      status: 'PENDING',
      createdAt: doc.createdAt || new Date(),
      items: [],
      paymentMethod: 'VIETQR_BANK_TRANSFER',
    };

    if (true) {
      const bankId = '970422';
      const accountNumber = '0899886249';
      const accountName = 'ALSM TECHNOLOGY SOLUTIONS';
      const refCode = effectiveInvoice.invoiceNumber;
      const amount = effectiveInvoice.amount || doc.totalValue || 0;
      const qrDataUrl = await generateCleanBankQrDataUrl({
      bankBin: bankId,
      accountNumber,
      accountName,
      amount,
      message: refCode,
    });

      invoiceDetails = {
        id: effectiveInvoice._id?.toString(),
        invoiceNumber: effectiveInvoice.invoiceNumber,
        isDemoMode,
        invoiceLabel: isDemoMode ? 'Demo Invoice' : 'Official VAT Invoice',
        paymentLabel: isDemoMode ? 'Demo Payment' : 'Official Bank Transfer',
        vatDisclaimer: isDemoMode
          ? 'DEMO MODE: Demo Invoice generated for evaluation and sandbox payment testing. No official VAT tax invoice is issued.'
          : 'Official Electronic VAT Invoice compliant with Ministry of Finance regulations (Circular 78/2021/TT-BTC).',
        amountVnd: effectiveInvoice.amount,
        subtotalVnd: effectiveInvoice.subtotalVnd || Math.round(effectiveInvoice.amount / 1.1),
        taxAmountVnd: effectiveInvoice.taxAmountVnd || Math.round(effectiveInvoice.amount - (effectiveInvoice.subtotalVnd || effectiveInvoice.amount / 1.1)),
        vatRate: effectiveInvoice.vatRate || 10,
        currency: effectiveInvoice.currency || 'VND',
        status: effectiveInvoice.status || 'PENDING',
        dueDate: effectiveInvoice.dueDate,
        createdAt: effectiveInvoice.createdAt,
        paidAt: effectiveInvoice.paidAt || null,
        items: effectiveInvoice.items || [],
        paymentMethod: effectiveInvoice.paymentMethod,
        transactionRef: effectiveInvoice.transactionRef || null,
      };

      qrPayment = {
        qrDataUrl,
        bankName: 'MB Bank (Military Commercial Joint Stock Bank)',
        accountNumber,
        accountName,
        referenceCode: refCode,
        amountVnd: amount,
        currency: effectiveInvoice.currency || 'VND',
        paymentInstructions: [
          'Open your mobile banking app (e.g. MB Bank, Vietcombank, Techcombank, VPBank, etc.).',
          'Scan the bank transfer QR code shown on this page.',
          `Ensure the transfer amount is exactly ${new Intl.NumberFormat('en-US').format(amount)} ${effectiveInvoice.currency || 'VND'}.`,
          `Keep the exact transfer reference: "${refCode}".`,
          isDemoMode
            ? 'DEMO MODE: You may click "Complete Demo Payment" below to immediately test the workflow.'
            : 'After completing the transfer, click "Submit Payment Proof" to notify the ALSM finance team.',
        ],
      };
    }

    // RULE: Do not activate Web 3 access before payment verification.
    const isPaymentVerified =
      summary.paymentStatus === 'Payment Verified' ||
      summary.contractStatus === 'Active' ||
      summary.contractStatus === 'Completed' ||
      doc.activationStatus === 'COMPLETED';

    const web3Activation = {
      isActivated: isPaymentVerified,
      status: isPaymentVerified ? 'ACTIVE' : 'LOCKED',
      activationStatus: isPaymentVerified ? 'COMPLETED' : 'PENDING_PAYMENT_VERIFICATION',
      web3PortalUrl: process.env.WEB3_URL || 'http://localhost:3003',
      organizationId: doc.organizationId ? doc.organizationId.toString() : null,
      activatedAt: isPaymentVerified ? (doc.updatedAt || new Date()) : null,
      message: isPaymentVerified
        ? 'Partner Portal Web 3 access is active and provisioned.'
        : 'Partner Portal Web 3 access is locked. It will be activated once payment is confirmed and verified by Admin.',
    };

    let paymentConfirmationStatus = 'Pending Payment';
    if (summary.paymentStatus === 'Payment Verified') {
      paymentConfirmationStatus = 'Verified & Confirmed by Admin';
    } else if (summary.paymentStatus === 'Payment Submitted') {
      paymentConfirmationStatus = 'Submitted by Customer — Awaiting Admin Verification';
    } else if (summary.paymentStatus === 'Not Required') {
      paymentConfirmationStatus = 'Not Required (Pending Signature)';
    }

    return {
      ...summary,
      invoice: invoiceDetails,
      qrPayment,
      paymentInstructions: qrPayment?.paymentInstructions || null,
      paymentConfirmationStatus,
      web3Activation,
      customer: doc.customer || {
        companyName: doc.organizationName || 'Enterprise Partner',
        taxId: '0109988776',
        businessAddress: 'Hanoi, Vietnam',
        representativeName: 'Corporate Representative',
        representativeTitle: 'Managing Director',
        contactEmail: 'partner@enterprise.io',
      },
      parties: doc.parties || {
        provider: {
          legalName: 'ALSM Technology Solutions JSC',
          brandName: 'ALSM Enterprise Platform',
          taxId: '0109876543',
          headquarters: '8th Floor, ALSM Modernization Center, Duy Tan, Cau Giay, Hanoi, Vietnam',
          signatoryName: 'Dr. Nguyen Van Tien',
          signatoryTitle: 'General Director / Legal Representative',
          contactEmail: 'contracts@alsm.io',
        },
        customer: doc.customer || {},
      },
      scope: doc.scope || {
        screensQuota: 1000,
        programsQuota: 500,
        storageGb: 50,
        targetTechnology: 'React 19 + TypeScript + Spring Boot 3 Java',
        supportTier: 'Dedicated Enterprise SLA (2h response)',
        slaCommitment: '99.9% Uptime with Deterministic AST Validation',
        deliverables: [],
      },
      commercialTerms: doc.commercialTerms || {
        subtotal: doc.totalValue || 75000,
        discountPercent: 0,
        discountAmount: 0,
        vatRate: 10,
        vatAmount: (doc.totalValue || 75000) * 0.1,
        totalValue: (doc.totalValue || 75000) * 1.1,
        currency: doc.currency || 'VND',
        paymentStructure: 'MILESTONE_BASED',
        bankAccountInfo: 'MB Bank — Account: 0899886249 (ALSM TECHNOLOGY SOLUTIONS)',
        paymentTermsDays: 'Net 15 days upon milestone invoice',
      },
      clauses: doc.clauses && doc.clauses.length > 0 ? doc.clauses : DEFAULT_LEGAL_CLAUSES,
      milestones: doc.milestones || [],
      paymentSchedule: doc.paymentSchedule || [],
      signingProcess: doc.signingProcess || {
        providerSigningStatus: 'NOT_SIGNED',
        customerSigningStatus: 'NOT_SIGNED',
        documentSha256: 'pending-generation',
      },
      serviceUsage: {
        screensQuota: doc.scope?.screensQuota || 1000,
        usedScreens: doc.usedScreens || 0,
        remainingScreens: doc.remainingScreens ?? doc.scope?.screensQuota ?? 1000,
        programsQuota: doc.scope?.programsQuota || 500,
        usedPrograms: 0,
        storageQuotaGb: doc.scope?.storageGb || 50,
        usedStorageGb: 0,
      },
      amendments: doc.amendments || [],
      renewals: doc.renewals || [],
      auditTrail: doc.auditTrail || [],
      paymentAuditTrail: (doc.auditTrail || []).filter((a: any) =>
        (a.action || '').includes('PAYMENT') ||
        (a.action || '').includes('INVOICE') ||
        (a.action || '').includes('CONTRACT_SIGNED') ||
        (a.action || '').includes('PROVISION') ||
        (a.action || '').includes('ACTIVATION')
      ),
    };
  }

  private generateDefaultMilestones(serviceMode: string, effectiveDate: string, endDate: string) {
    if (serviceMode === 'SELF_SERVICE') {
      return [
        {
          id: 'ms-1',
          title: 'Milestone 1: Workspace Activation & SDK Provisioning',
          description: 'Autonomous workspace provisioning, AST compiler license keys, and API credentials.',
          targetDate: effectiveDate,
          paymentPercentage: 50,
          deliverables: ['Dedicated tenant cluster', 'CLI & Web 3 workspace credentials', 'Screen parsing quota'],
          status: 'COMPLETED' as const,
        },
        {
          id: 'ms-2',
          title: 'Milestone 2: Annual Platform Maintenance & Upgrades',
          description: 'Quarterly AST parser enhancements, bug patches, and developer support.',
          targetDate: endDate,
          paymentPercentage: 50,
          deliverables: ['Quarterly engine updates', 'Continuous compliance audit'],
          status: 'PENDING' as const,
        },
      ];
    }

    return [
      {
        id: 'ms-1',
        title: 'Milestone 1: Legacy Extraction & Architecture Blueprint',
        description: 'Complete analysis of legacy BMS maps, copybooks, and batch dependencies.',
        targetDate: effectiveDate,
        paymentPercentage: 30,
        deliverables: ['Legacy Architecture Assessment', 'Component inventory matrix', 'Target schema specifications'],
        status: 'COMPLETED' as const,
      },
      {
        id: 'ms-2',
        title: 'Milestone 2: Deterministic AST Conversion & Validation',
        description: 'Automated synthesis of React 19 UI components and Spring Boot 3 microservices.',
        targetDate: this.calculateIntermediateDate(effectiveDate, endDate, 0.6),
        paymentPercentage: 40,
        deliverables: ['Synthesized frontend bundles', 'Spring Boot backend microservices', 'AST compliance report'],
        status: 'IN_PROGRESS' as const,
      },
      {
        id: 'ms-3',
        title: 'Milestone 3: Final Acceptance & Production Handover',
        description: 'User acceptance testing, gap remediation, and certified production deliverables handover.',
        targetDate: endDate,
        paymentPercentage: 30,
        deliverables: ['Production deployment bundle', 'Certified sign-off dossier', '30-day warranty coverage'],
        status: 'PENDING' as const,
      },
    ];
  }

  private generatePaymentSchedule(milestones: any[], totalValue: number, currency: string) {
    return milestones.map((m, idx) => ({
      installment: `Stage ${idx + 1}`,
      title: m.title,
      dueDate: m.targetDate,
      percentage: m.paymentPercentage,
      amount: Math.round((totalValue * m.paymentPercentage) / 100),
      currency,
      status: m.status === 'COMPLETED' ? 'PAID' : 'PENDING',
    }));
  }

  private calculateIntermediateDate(start: string, end: string, ratio: number): string {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (!s || !e || e <= s) return end;
    const inter = new Date(s + (e - s) * ratio);
    return inter.toISOString().slice(0, 10);
  }
}
