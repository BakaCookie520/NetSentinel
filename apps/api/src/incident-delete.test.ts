import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { IncidentsController } from "./controllers.js";

function createPrisma(options: { exists?: boolean; activeRuns?: number } = {}) {
  const tx = {
    incident: {
      findUnique: vi.fn(async () => options.exists === false ? null : { id: "incident-1" }),
      delete: vi.fn(async () => ({ id: "incident-1" })),
    },
    workflowRun: {
      count: vi.fn(async () => options.activeRuns ?? 0),
      updateMany: vi.fn(async () => ({ count: 2 })),
    },
    auditEvent: {
      create: vi.fn(async () => ({ id: "audit-1" })),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
}

describe("IncidentsController.remove", () => {
  it("deletes an incident, detaches completed runs, and writes an audit event", async () => {
    const { prisma, tx } = createPrisma();
    const controller = new IncidentsController(prisma as never);

    await expect(controller.remove("incident-1", {
      principal: { id: "user-1" },
    } as never)).resolves.toEqual({ ok: true });

    expect(tx.workflowRun.updateMany).toHaveBeenCalledWith({
      where: { incidentId: "incident-1" },
      data: { incidentId: null },
    });
    expect(tx.incident.delete).toHaveBeenCalledWith({ where: { id: "incident-1" } });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "user-1",
        action: "incident.delete",
        resourceType: "incident",
        resourceId: "incident-1",
      },
    });
  });

  it("rejects deletion while a workflow run is pending or running", async () => {
    const { prisma, tx } = createPrisma({ activeRuns: 1 });
    const controller = new IncidentsController(prisma as never);

    await expect(controller.remove("incident-1", { principal: { id: "user-1" } } as never))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.incident.delete).not.toHaveBeenCalled();
  });

  it("returns not found for an unknown incident", async () => {
    const { prisma } = createPrisma({ exists: false });
    const controller = new IncidentsController(prisma as never);

    await expect(controller.remove("missing", { principal: { id: "user-1" } } as never))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
