import { Controller, Get, Header } from "@nestjs/common";
import { db } from "../lib/db";

@Controller()
export class HealthController {
  @Get()
  @Header("Content-Type", "text/plain")
  root() {
    return "CSI CDR Intelligence API. See /healthz.";
  }

  @Get("healthz")
  async healthz() {
    let dbStatus = "ok";
    try {
      await db()`SELECT id FROM branches LIMIT 1`;
    } catch (e) {
      dbStatus = `error: ${(e as Error).message}`;
    }
    return { status: "ok", db: dbStatus, version: "1.0.0" };
  }

  @Get("readyz")
  readyz() {
    return { status: "ready" };
  }
}
