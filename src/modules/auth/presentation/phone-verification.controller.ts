import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PhoneVerificationService } from '../application/phone-verification.service';
import {
  CONTRACT_INVITATION_REPOSITORY,
  type ContractInvitationRepository,
} from '../../crm/domain/contract-invitation.types';
import {
  PhoneOtpRequestedResponse,
  PhoneOtpVerifiedResponse,
  PhoneVerificationStatusResponse,
  RequestPhoneOtpDto,
  VerifyPhoneOtpDto,
} from './phone-verification.dto';

@ApiTags('Auth')
@Controller('auth/phone')
export class PhoneVerificationController {
  constructor(
    private readonly phoneVerification: PhoneVerificationService,
    @Inject(CONTRACT_INVITATION_REPOSITORY)
    private readonly invitations: ContractInvitationRepository,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('request-otp')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'OTP sent (or cooldown returned).', type: PhoneOtpRequestedResponse })
  @ApiUnauthorizedResponse({ description: 'Not authenticated.' })
  @ApiResponse({ status: 400, description: 'Rate limited or invalid phone format.' })
  @ApiResponse({ status: 503, description: 'SMS provider not configured.' })
  async requestOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestPhoneOtpDto,
  ): Promise<PhoneOtpRequestedResponse> {
    return this.phoneVerification.requestOtp(user.userId, dto.phone);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-otp')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'OTP verified; phone is now marked verified.', type: PhoneOtpVerifiedResponse })
  @ApiUnauthorizedResponse({ description: 'Not authenticated.' })
  @ApiResponse({ status: 400, description: 'Invalid, expired, or locked OTP.' })
  async verifyOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyPhoneOtpDto,
  ): Promise<PhoneOtpVerifiedResponse> {
    const verified = await this.phoneVerification.verifyOtp(
      user.userId,
      dto.phone,
      dto.code,
    );

    if (verified) {
      // Update all active grants for this user: phone is now verified.
      await this.invitations.updatePhoneVerification({
        userId: user.userId,
        phone: dto.phone,
        status: 'VERIFIED',
        eligibility: 'ELIGIBLE',
      });
    }

    return { verified };
  }

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'Current phone verification status.', type: PhoneVerificationStatusResponse })
  @ApiUnauthorizedResponse({ description: 'Not authenticated.' })
  async getStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PhoneVerificationStatusResponse> {
    const grant = await this.invitations.findGrantByUserId(user.userId);

    if (!grant) {
      return { status: 'UNVERIFIED' };
    }

    if (grant.phoneVerificationStatus === 'VERIFIED' && grant.verifiedPhone) {
      // Mask the phone number: +84******567
      const masked = grant.verifiedPhone.replace(
        /^(\+\d{2})\d+(\d{3})$/,
        '$1******$2',
      );
      return { status: 'VERIFIED', phone: masked };
    }

    return { status: grant.phoneVerificationStatus };
  }
}

