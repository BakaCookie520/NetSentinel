import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Param, Patch, Post, Put, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import type { Response } from "express";
import { z } from "zod";
import { RequirePermissions, type AuthenticatedRequest } from "./auth.js";
import { BackupService } from "./backup-service.js";
import { backupDirectory } from "./backup-storage.js";
import { uploadLimit } from "./backup-format.js";

const idSchema = z.string().uuid();
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException("BACKUP_INPUT_INVALID");
  return result.data;
};
const policySchema = z.object({
  enabled: z.boolean(), frequency: z.enum(["daily", "weekly"]), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
  weekday: z.number().int().min(0).max(6), timezone: z.string().max(100).refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }),
  retain: z.number().int().min(1).max(365), password: z.string().min(12).max(1024).optional(),
});
const session = (request: AuthenticatedRequest) => {
  if (request.principal?.authentication !== "session") throw new ForbiddenException("BACKUP_SESSION_REQUIRED");
  return request.principal.id;
};

@Controller("admin/backups")
@RequirePermissions("backup:manage")
export class BackupController {
  constructor(@Inject(BackupService) private readonly backups: BackupService) {}
  @Get() list(@Req() request: AuthenticatedRequest) { session(request); return this.backups.list(); }
  @Get("policy") policy(@Req() request: AuthenticatedRequest) { session(request); return this.backups.policyView(); }
  @Put("policy") async savePolicy(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const actor = session(request);
    return this.backups.savePolicy(parse(policySchema, body), actor);
  }
  @Get("jobs/:id") job(@Param("id") id: string, @Req() request: AuthenticatedRequest) { session(request); return this.backups.job(parse(idSchema, id)); }
  @Post() @HttpCode(202) create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const actor = session(request);
    const input = parse(z.object({ name: z.string().trim().min(1).max(120), note: z.string().max(2000).default("") }), body);
    return this.backups.create(input.name, input.note, actor);
  }
  @Post("import") @HttpCode(202)
  @UseInterceptors(FileInterceptor("file", {
    storage: diskStorage({ destination: (_req, _file, callback) => callback(null, backupDirectory()), filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`) }),
    limits: { fileSize: uploadLimit(), files: 1, fields: 2, fieldSize: 4096 },
  }))
  async import(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    try {
      const actor = session(request);
      const input = parse(z.object({ password: z.string().min(1).max(1024), name: z.string().trim().min(1).max(120) }), body);
      if (!file) throw new BadRequestException("BACKUP_FILE_REQUIRED");
      return await this.backups.import(file.path, input.password, input.name, actor);
    } catch (error) { if (file) await rm(file.path, { force: true }); throw error; }
  }
  @Get(":id") detail(@Param("id") id: string, @Req() request: AuthenticatedRequest) { session(request); return this.backups.detail(parse(idSchema, id)); }
  @Patch(":id") update(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const actor = session(request);
    const input = parse(z.object({ name: z.string().trim().min(1).max(120), note: z.string().max(2000) }), body);
    return this.backups.update(parse(idSchema, id), input.name, input.note, actor);
  }
  @Delete(":id") remove(@Param("id") id: string, @Req() request: AuthenticatedRequest) { return this.backups.remove(parse(idSchema, id), session(request)); }
  @Post(":id/download") @HttpCode(200) async download(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest, @Res() response: Response) {
    const actor = session(request);
    const input = parse(z.object({ currentPassword: z.string().min(1).max(1024) }), body);
    await this.backups.verifyPassword(actor, input.currentPassword);
    const output = await this.backups.download(parse(idSchema, id), actor);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Disposition", `attachment; filename="${output.filename}"`);
    response.type("application/octet-stream");
    const stream = createReadStream(output.path);
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  }
  @Post(":id/restore") @HttpCode(202) async restore(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const actor = session(request);
    const input = parse(z.object({ currentPassword: z.string().min(1).max(1024), confirmation: z.literal("RESTORE") }), body);
    await this.backups.verifyPassword(actor, input.currentPassword);
    return this.backups.restore(parse(idSchema, id), actor);
  }
}
