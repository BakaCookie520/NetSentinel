import { describe, expect, it, vi } from "vitest";
import { AuthGuard, AuthService, hashPassword } from "./auth.js";

const user = {
  id: "user-1",
  email: "operator@example.com",
  displayName: "Operator",
  avatarKey: null,
  forcePasswordChange: true,
  roles: [{ role: { permissions: ["monitor:read"] } }],
};

function context(request: Record<string, unknown>) {
  return {
    getHandler: () => "handler",
    getClass: () => "class",
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe("forced password changes", () => {
  it("blocks regular endpoints while permitting the password-change flow", async () => {
    const prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          idHash: "session-hash",
          csrfHash: "csrf-hash",
          expiresAt: new Date(Date.now() + 60_000),
          user,
        }),
      },
    };
    const auth = new AuthService(prisma as never);
    const getAllAndOverride = vi.fn();
    getAllAndOverride.mockImplementation((key: string) => {
      if (key === "public") return false;
      if (key === "allowPasswordChangeRequired") return false;
      return [];
    });
    const reflector = { getAllAndOverride };
    const guard = new AuthGuard(reflector as never, prisma as never, auth);

    await expect(
      guard.canActivate(context({ cookies: { netsentinel_session: "session" }, method: "GET", headers: {} }) as never),
    ).rejects.toThrow("Password change is required");

    getAllAndOverride.mockImplementation((key: string) => {
      if (key === "public") return false;
      if (key === "allowPasswordChangeRequired") return true;
      return [];
    });
    await expect(
      guard.canActivate(context({ cookies: { netsentinel_session: "session" }, method: "GET", headers: {} }) as never),
    ).resolves.toBe(true);
  });

  it("clears the flag and revokes other sessions after a verified password change", async () => {
    const passwordHash = await hashPassword("temporary-password");
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ passwordHash }),
        update: vi.fn().mockResolvedValue({}),
      },
      session: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const auth = new AuthService(prisma as never);

    await auth.changePassword(
      "user-1",
      "temporary-password",
      "replacement-password",
      "current-session-hash",
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ forcePasswordChange: false }),
      }),
    );
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", idHash: { not: "current-session-hash" } },
    });
  });

  it("rejects an unchanged or unverified password", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          passwordHash: await hashPassword("temporary-password"),
        }),
      },
      session: { deleteMany: vi.fn() },
      $transaction: vi.fn(),
    };
    const auth = new AuthService(prisma as never);

    await expect(
      auth.changePassword("user-1", "temporary-password", "temporary-password", "session"),
    ).rejects.toThrow("must differ");
    await expect(
      auth.changePassword("user-1", "wrong-password", "replacement-password", "session"),
    ).rejects.toThrow("Current password is incorrect");
  });
});
