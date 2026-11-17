import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { EnterpriseContractService } from '../application/enterprise-contract.service';
import { EnterpriseContractPdfService } from '../application/enterprise-contract-pdf.service';
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
import type { Response } from 'express';

@ApiTags('Enterprise Contract Management')
@ApiBearerAuth()
@Controller(['enterprise-contracts', 'api/enterprise-contracts'])
export class EnterpriseContractController {
  constructor(
    private readonly contractService: EnterpriseContractService,
    private readonly pdfService: EnterpriseContractPdfService,
  ) {}

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get KPI statistics for contract dashboard' })
  async getStats(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') orgId?: string,
  ) {
    return this.contractService.getDashboardStats({
      organizationId: orgId,
      userId: user?.userId,
      userEmail: user?.email,
      isPlatformAdmin: user?.isPlatformAdmin,
    });
  }

  @Get('templates')
  @ApiOperation({ summary: 'Get legal contract templates and pre-approved clause library' })
  getTemplatesAndClauses() {
    return this.contractService.getTemplatesAndClauses();
  }

  @Get('customers')
  @ApiOperation({ summary: 'Get selectable organizations and converted leads for contract creation' })
  async getCustomers() {
    return this.contractService.getSelectableCustomers();
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List enterprise contracts with tabs, filters, and pagination' })
  async listContracts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tab') tab?: string,
    @Query('serviceMode') serviceMode?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Headers('x-organization-id') orgId?: string,
  ) {
    return this.contractService.listContracts({
      tab,
      serviceMode,
      search,
      organizationId: orgId,
      userId: user?.userId,
      userEmail: user?.email,
      isPlatformAdmin: user?.isPlatformAdmin,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 15,
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get full contract detail with 14 enterprise sections' })
  async getContractDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.contractService.getContractDetail(id, {
      userId: user?.userId,
      email: user?.email,
      isPlatformAdmin: user?.isPlatformAdmin,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a new contract draft from multi-step wizard' })
  async createContract(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEnterpriseContractDto,
  ) {
    return this.contractService.createContract(dto, user.userId);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update an editable contract draft' })
  async updateContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() updates: Partial<CreateEnterpriseContractDto>,
  ) {
    return this.contractService.updateContract(id, updates, user.userId);
  }

  @Post(':id/submit-review')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Submit contract draft for internal and legal review' })
  async submitForReview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contractService.submitForReview(id, user.userId);
  }

  @Post(':id/review')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Record internal or legal review decision (Approve, Request Changes, Reject)' })
  async reviewContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewContractDto,
  ) {
    return this.contractService.reviewContract(id, dto, user.userId);
  }

  @Post(':id/send')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Send contract to customer for online preview and signature' })
  async sendToCustomer(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contractService.sendToCustomer(id, user.userId);
  }

  @Post(':id/decision')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Record customer decision on contract (Accept, Request Revision, Decline)' })
  async customerDecision(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CustomerDecisionDto,
  ) {
    return this.contractService.customerDecision(id, dto, user.userId);
  }

  @Get(':id/invoice')
  @ApiOperation({ summary: 'Get invoice and dynamic VietQR details for contract' })
  async getInvoice(@Param('id') id: string) {
    return this.contractService.getContractInvoice(id);
  }

  @Post(':id/customer-sign')
  @ApiOperation({ summary: 'Customer execute electronic contract signing' })
  async customerSign(
    @Param('id') id: string,
    @Body() dto: Partial<SignContractDto>,
    @Req() req: any,
  ) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const signDto: SignContractDto = {
      signerRole: 'CUSTOMER',
      signerName: dto.signerName || 'Customer Signatory',
      signerTitle: dto.signerTitle || 'Representative',
      signerEmail: dto.signerEmail || 'customer@enterprise.com',
      authMethod: dto.authMethod || 'Enterprise Multi-Factor + OTP',
    };
    return this.contractService.signContract(id, signDto, ip.toString());
  }

  @Post('generate-from-package')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Customer select service mode & modernization package to generate contract' })
  async generateFromPackage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateContractFromPackageDto,
  ) {
    return this.contractService.generateContractFromPackage(dto, user.userId, user.email);
  }

  @Post(':id/submit-payment')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Customer submit payment confirmation / proof' })
  async submitPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitContractPaymentDto,
  ) {
    return this.contractService.submitContractPayment(id, dto, user.userId, user.email);
  }

  @Post(':id/confirm-payment')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin verify and confirm payment, activating Partner Portal Web 3 access' })
  async confirmPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmContractPaymentDto,
  ) {
    return this.contractService.confirmContractPayment(id, dto, user.userId);
  }

  @Post(':id/simulate-payment')
  @ApiOperation({ summary: 'Simulate invoice payment and trigger automatic Web 3 activation' })
  async simulatePayment(@Param('id') id: string) {
    return this.contractService.simulateContractPayment(id);
  }

  @Post(':id/retry-provisioning')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Retry Web 3 provisioning safely and idempotently' })
  async retryProvisioning(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const actorId = user?.userId || 'ADMIN';
    return this.contractService.retryProvisioning(id, actorId);
  }

  @Post(':id/sign')
  @ApiOperation({ summary: 'Execute electronic signing with cryptographic evidence & certificate' })
  async signContract(
    @Param('id') id: string,
    @Body() dto: SignContractDto,
    @Req() req: any,
  ) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    return this.contractService.signContract(id, dto, ip.toString());
  }

  @Post(':id/activate')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Activate fully-signed contract: auto-provisions quota and project' })
  async activateContract(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contractService.activateContract(id, user.userId);
  }

  @Post(':id/amend')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create formal contract amendment' })
  async amendContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AmendContractDto,
  ) {
    return this.contractService.amendContract(id, dto, user.userId);
  }

  @Post(':id/renew')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Renew active contract' })
  async renewContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('renewalMonths') months: number = 12,
  ) {
    return this.contractService.renewContract(id, months, user.userId);
  }

  @Post(':id/terminate')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Terminate contract with formal reason and date' })
  async terminateContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TerminateContractDto,
  ) {
    return this.contractService.terminateContract(id, dto, user.userId);
  }

  @Get(':id/validation')
  @ApiOperation({ summary: 'Validate legal completeness and statutory fields of contract' })
  async validateContract(@Param('id') id: string) {
    return this.contractService.validateContractIntegrity(id);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download or view official enterprise contract document in court-admissible PDF format' })
  async downloadPdf(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('locale') locale?: 'vi' | 'en' | 'vi-en',
    @Query('download') download?: string,
  ) {
    const contract = await this.contractService.getContractDetail(id);
    if (!contract) {
      return res.status(404).send('Contract not found.');
    }

    const isDownload = download === 'true' || download === '1';
    const dispositionType = isDownload ? 'attachment' : 'inline';

    if (format === 'html') {
      const htmlContent = this.contractService.renderContractHtml(contract, locale);
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `${dispositionType}; filename="ALSM-Contract-${contract.contractNumber}.html"`,
      );
      return res.send(htmlContent);
    }

    const pdfBuffer = await this.pdfService.renderContractPdf({
      contract,
      locale: locale || 'vi',
    });

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${dispositionType}; filename="ALSM-Contract-${contract.contractNumber}.pdf"`,
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  }
}
