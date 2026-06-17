import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Response } from "express";
import { AuthError } from "../lib/auth";

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof AuthError) {
      return res.status(exception.status).json({ detail: exception.message });
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const detail = typeof response === "string" ? response : (response as { message?: unknown }).message;
      return res.status(status).json({ detail: Array.isArray(detail) ? detail.join(", ") : detail ?? exception.message });
    }
    const message = exception instanceof Error ? exception.message : "Internal server error";
    return res.status(500).json({ detail: message });
  }
}
