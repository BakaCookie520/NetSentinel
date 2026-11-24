import { CanActivate, ExecutionContext, Inject, Injectable, Optional, SetMetadata, ServiceUnavailableException, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { Permission } from "@netsentinel/contracts";
import { PrismaService } from "./prisma.service.js";
import { BackupRuntime } from "./backup-runtime.js";
import { RESTORE_GATE } from "./backup-types.js";

export const Public = () => SetMetadata("public", true);
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata("permissions", permissions);
export const AllowPasswordChangeRequired = () =>
  SetMetadata("allowPasswordChangeRequired", true);

export interface Principal {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  permissions: Permission[];
  authentication: "session" | "token";
  forcePasswordChange: boolean;
}

export type AuthenticatedRequest = Request & {
  principal?: Principal;
  sessionCsrfHash?: string;
  sessionIdHash?: string;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

function avatarUrl(avatarKey: string | null): string | null {
  return avatarKey ? `/api/v1/auth/me/avatar?v=${encodeURIComponent(avatarKey)}` : null;
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  principal(
    user: {
      id: string;
      email: string;
      displayName: string;
      avatarKey: string | null;
      forcePasswordChange: boolean;
      roles: Array<{ role: { permissions: string[] } }>;
    },
    authentication: "session" | "token",
    tokenScopes?: string[],
  ): Principal {
    const granted = new Set(user.roles.flatMap(({ role }) => role.permissions));
    const permissions =
      authentication === "token"
        ? (tokenScopes?.filter((scope) => granted.has(scope)) ?? []) as Permission[]
        : [...granted] as Permission[];
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: avatarUrl(user.avatarKey),
      permissions,
      authentication,
      forcePasswordChange: user.forcePasswordChange,
    };
  }

  async login(email: string, password: string): Promise<{ principal: Principal; session: string; csrf: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { roles: { include: { role: true } } } });
    if (!user || user.disabledAt || !(await verify(user.passwordHash, password))) throw new UnauthorizedException("Invalid email or password");
    const session = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    await this.prisma.session.create({ data: { idHash: digest(session), csrfHash: digest(csrf), userId: user.id, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1_000) } });
    return { principal: this.principal(user, "session"), session, csrf };
  }

  async logout(session: string | undefined): Promise<void> {
    if (session) await this.prisma.session.deleteMany({ where: { idHash: digest(session) } });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionIdHash: string,
  ): Promise<void> {
    if (currentPassword === newPassword) {
      throw new ForbiddenException("New password must differ from the current password");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user || !(await verify(user.passwordHash, currentPassword))) {
      throw new ForbiddenException("Current password is incorrect");
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(newPassword),
          forcePasswordChange: false,
        },
      }),
      this.prisma.session.deleteMany({
        where: { userId, idHash: { not: currentSessionIdHash } },
      }),
    ]);
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Optional() @Inject(BackupRuntime) private readonly backups?: BackupRuntime,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const incoming = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (this.backups && !/^\/api\/v1\/(?:admin\/backups(?:\/|$)|health\/)/u.test(incoming.originalUrl) && await this.backups.redis.exists(RESTORE_GATE)) {
      throw new ServiceUnavailableException("RESTORE_IN_PROGRESS");
    }
    if (this.reflector.getAllAndOverride<boolean>("public", [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    let principal: Principal | undefined;
    if (authorization?.startsWith("Bearer nst_")) principal = await this.fromToken(authorization.slice(7));
    else principal = await this.fromSession(request);
    if (!principal) throw new UnauthorizedException();
    if (/^\/api\/v1\/admin\/backups(?:\/|$)/u.test(request.originalUrl ?? "") && principal.authentication !== "session") throw new ForbiddenException("BACKUP_SESSION_REQUIRED");
    request.principal = principal;
    this.assertCsrf(request, principal);
    const allowPasswordChangeRequired = this.reflector.getAllAndOverride<boolean>(
      "allowPasswordChangeRequired",
      [context.getHandler(), context.getClass()],
    );
    if (principal.forcePasswordChange && !allowPasswordChangeRequired) {
      throw new ForbiddenException("Password change is required");
    }
    const required = this.reflector.getAllAndOverride<Permission[]>("permissions", [context.getHandler(), context.getClass()]) ?? [];
    if (!required.every((permission) => principal.permissions.includes(permission))) throw new ForbiddenException("Missing permission");
    return true;
  }

  private async fromSession(request: AuthenticatedRequest): Promise<Principal | undefined> {
    const raw = request.cookies?.netsentinel_session as string | undefined;
    if (!raw) return undefined;
    const session = await this.prisma.session.findUnique({ where: { idHash: digest(raw) }, include: { user: { include: { roles: { include: { role: true } } } } } });
    if (!session || session.expiresAt <= new Date() || session.user.disabledAt) return undefined;
    request.sessionCsrfHash = session.csrfHash;
    request.sessionIdHash = session.idHash;
    return this.auth.principal(session.user, "session");
  }

  private async fromToken(raw: string): Promise<Principal | undefined> {
    const token = await this.prisma.apiToken.findUnique({ where: { tokenHash: digest(raw) }, include: { user: { include: { roles: { include: { role: true } } } } } });
    if (!token || token.revokedAt || token.user.disabledAt || (token.expiresAt && token.expiresAt <= new Date())) return undefined;
    return this.auth.principal(token.user, "token", token.scopes);
  }

  private assertCsrf(request: AuthenticatedRequest, principal: Principal): void {
    if (principal.authentication !== "session" || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const header = request.headers["x-csrf-token"];
    const candidate = Array.isArray(header) ? header[0] : header;
    if (!candidate || !request.sessionCsrfHash) throw new ForbiddenException("Missing CSRF token");
    const expected = Buffer.from(request.sessionCsrfHash, "hex");
    const actual = Buffer.from(digest(candidate), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ForbiddenException("Invalid CSRF token");
  }
}

export { digest };
