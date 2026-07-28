import { PrismaClient } from "@netsentinel/database";
import { PERMISSIONS } from "@netsentinel/contracts";
import { hashPassword } from "./auth.js";

const email = process.env.INITIAL_ADMIN_EMAIL;
const password = process.env.INITIAL_ADMIN_PASSWORD;
if (!email || !password) process.exit(0);
if (password.length < 12) throw new Error("INITIAL_ADMIN_PASSWORD must contain at least 12 characters");
const prisma = new PrismaClient();
try {
  const role = await prisma.role.upsert({ where: { name: "system-admin" }, create: { name: "system-admin", description: "Built-in administrator", permissions: [...PERMISSIONS], system: true }, update: { permissions: [...PERMISSIONS], system: true } });
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!existing) {
    await prisma.user.create({ data: { email: email.toLowerCase(), displayName: "Administrator", passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
    console.log(`Bootstrapped administrator ${email.toLowerCase()}`);
  }
} finally { await prisma.$disconnect(); }
