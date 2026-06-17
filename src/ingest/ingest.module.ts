import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IngestController } from "./ingest.controller";
import { IngestService } from "./ingest.service";

@Module({
  imports: [AuthModule],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
