import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AuthGuard, AuthService } from "./auth.js";
import { AdminController, AgentsController, ApprovalsController, AuthController, CredentialsController, DashboardController, IncidentsController, MaintenanceController, MonitorsController, RuntimeLogsController, SystemController, TagsController, TokensController, WorkflowsController } from "./controllers.js";
import { PrismaService } from "./prisma.service.js";
import { EventStreamService, QueueService } from "./services.js";
import { PublicStatusController } from "./public-status.controller.js";
import { BackupController } from "./backup-controller.js";
import { BackupService } from "./backup-service.js";
import { BackupRuntime } from "./backup-runtime.js";

@Module({
  controllers: [BackupController, AuthController, PublicStatusController, SystemController, DashboardController, RuntimeLogsController, MonitorsController, TagsController, IncidentsController, WorkflowsController, ApprovalsController, CredentialsController, AdminController, TokensController, AgentsController, MaintenanceController],
  providers: [PrismaService, AuthService, QueueService, EventStreamService, BackupRuntime, BackupService, { provide: APP_INTERCEPTOR, useExisting: BackupRuntime }, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
