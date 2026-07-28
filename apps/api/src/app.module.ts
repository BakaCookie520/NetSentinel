import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard, AuthService } from "./auth.js";
import { AdminController, AgentsController, ApprovalsController, AuthController, CredentialsController, DashboardController, IncidentsController, MaintenanceController, MonitorsController, RuntimeLogsController, SystemController, TagsController, TokensController, WorkflowsController } from "./controllers.js";
import { PrismaService } from "./prisma.service.js";
import { EventStreamService, QueueService } from "./services.js";
import { PublicStatusController } from "./public-status.controller.js";

@Module({
  controllers: [AuthController, PublicStatusController, SystemController, DashboardController, RuntimeLogsController, MonitorsController, TagsController, IncidentsController, WorkflowsController, ApprovalsController, CredentialsController, AdminController, TokensController, AgentsController, MaintenanceController],
  providers: [PrismaService, AuthService, QueueService, EventStreamService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
