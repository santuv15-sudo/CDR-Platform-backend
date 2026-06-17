import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { ExportsModule } from "./exports/exports.module";
import { HealthModule } from "./health/health.module";
import { IngestModule } from "./ingest/ingest.module";
import { MetricsModule } from "./metrics/metrics.module";

@Module({
  imports: [
    HealthModule,
    AuthModule,
    AdminModule,
    IngestModule,
    MetricsModule,
    ExportsModule,
  ],
})
export class AppModule {}
