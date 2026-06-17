import { Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUserParam } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import type { CurrentUser } from "../lib/auth";
import { IngestService } from "./ingest.service";

@Controller("api/ingest")
@UseGuards(AuthGuard, RolesGuard)
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post("mapping")
  @Roles("superadmin", "executive")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  uploadMapping(@UploadedFile() file: Express.Multer.File, @CurrentUserParam() user: CurrentUser) {
    return this.ingest.ingestMapping(file, user.id);
  }

  @Post("cdr")
  @Roles("superadmin", "executive")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }))
  uploadCdr(@UploadedFile() file: Express.Multer.File, @CurrentUserParam() user: CurrentUser) {
    return this.ingest.ingestCdr(file, user.id);
  }

  @Get("batches")
  @Roles("superadmin", "executive")
  batches() {
    return this.ingest.batches();
  }

  @Get("issues")
  @Roles("superadmin", "executive")
  issues(@Query("batch_id") batchId?: string, @Query("issue_type") issueType?: string) {
    return this.ingest.issues(batchId, issueType);
  }

  @Delete("batches/:id")
  @Roles("superadmin", "executive")
  deleteBatch(@Param("id") id: string) {
    return this.ingest.deleteBatch(id);
  }
}
