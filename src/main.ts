import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HttpErrorFilter } from "./common/http-exception.filter";
import { env } from "./lib/env";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = env.corsOrigins();
  app.enableCors({
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked origin: ${origin}`), false);
    },
  });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
}

bootstrap();
