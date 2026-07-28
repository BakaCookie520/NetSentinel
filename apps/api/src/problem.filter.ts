import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : undefined;
    const record = typeof payload === "object" && payload ? payload as Record<string, unknown> : undefined;
    const detail = typeof payload === "string" ? payload : typeof record?.detail === "string" ? record.detail : record && "message" in record ? JSON.stringify(record.message) : status === 500 ? "An unexpected error occurred" : "Request failed";
    response.status(status).type("application/problem+json").json({ type: `https://httpstatuses.com/${status}`, title: HttpStatus[status] ?? "Error", status, detail, instance: request.originalUrl, ...(Array.isArray(record?.errors) ? { errors: record.errors } : {}) });
  }
}
