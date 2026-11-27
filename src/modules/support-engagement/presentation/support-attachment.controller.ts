import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { diskStorage } from 'multer';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { SupportAttachment, SupportAttachmentDocument } from '../infrastructure/support-attachment.schema';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'support-attachments');
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_PREFIXES = ['image/'];
const ALLOWED_EXACT_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function isAllowedMime(mimeType: string): boolean {
  if (!mimeType) return false;
  if (ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
    return mimeType !== 'image/svg+xml';
  }
  return ALLOWED_EXACT_MIMES.has(mimeType);
}

@ApiTags('Support Attachments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CurrentSessionGuard)
@Controller('support/attachments')
export class SupportAttachmentController {
  constructor(
    @InjectModel(SupportAttachment.name)
    private readonly attachmentModel: Model<SupportAttachmentDocument>,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Upload an image or file attachment for support chat or feedback' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname || '').slice(0, 16);
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!isAllowedMime(file.mimetype)) {
          cb(new BadRequestException('Unsupported file type. Allowed: images, PDF, TXT, CSV, JSON, Office docs, ZIP.'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const fileId = randomUUID();
    const created = await this.attachmentModel.create({
      fileId,
      originalName: file.originalname || 'attachment',
      storedName: file.filename,
      mimeType: file.mimetype,
      size: file.size,
      uploadedByUserId: Types.ObjectId.isValid(user.userId) ? new Types.ObjectId(user.userId) : new Types.ObjectId(),
      uploadedByEmail: user.email.toLowerCase(),
    });

    return {
      fileId: created.fileId,
      name: created.originalName,
      url: `/support/attachments/${created.fileId}`,
      size: created.size,
      mimeType: created.mimeType,
    };
  }

  @Get(':fileId')
  @ApiOperation({ summary: 'Download or preview a support attachment' })
  async getAttachment(
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const record = await this.attachmentModel.findOne({ fileId }).lean();
    if (!record) {
      throw new NotFoundException('Attachment not found');
    }

    const fullPath = path.join(UPLOAD_DIR, record.storedName);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Attachment file missing on storage');
    }

    res.setHeader('Content-Type', record.mimeType || 'application/octet-stream');
    const safeName = encodeURIComponent(record.originalName || 'attachment');
    const disposition = record.mimeType?.startsWith('image/') ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${safeName}`);
    return res.sendFile(fullPath);
  }
}
