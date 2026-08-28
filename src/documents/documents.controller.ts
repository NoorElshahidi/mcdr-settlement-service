import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Role } from '../common/enums/role.enum';
import { Roles } from '../common/decorators/roles.decorator';
import { DocumentsService, UploadFile } from './documents.service';
import { Response } from 'express';

@Controller('backoffice/meetings')
@Roles(Role.BackofficeEmployee)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('meeting-attachment')
  @Roles(Role.Owner)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadAttachment(@Req() request: Request, @UploadedFile() file: UploadFile) {
    return this.documents.uploadMeetingAttachment(request.user?.subject ?? '', file);
  }

  @Get(':id')
  @Roles(Role.Owner, Role.BackofficeEmployee)
  async download(@Param('id') id: string, @Req() request: Request, @Res() response: Response) {
    const result = await this.documents.download(id, request.user!);
    response.setHeader('Content-Type', result.document.mimeType);
    response.setHeader('Content-Length', result.data.length);
    const safeName = result.document.originalName.replace(/[\\"\r\n]/g, '_');
    response.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.send(result.data);
  }

  @Post(':id/settlement-document')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(@Param('id') id: string, @Req() request: Request, @UploadedFile() file: UploadFile) {
    return this.documents.uploadSettlementDocument(id, request.user?.subject ?? '', file);
  }
}
