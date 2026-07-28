import { PrismaClient } from "@netsentinel/database";
import { PERMISSIONS } from "@netsentinel/contracts";
import { hashPassword } from "./auth.js";

const [command, email, password] = process.argv.slice(2);
if (!command || !email || !password || password.length < 12) {
  console.error("Usage: pnpm --filter @netsentinel/api admin <create|reset> <email> <password>=12chars");
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  if (command === "create") {
    const role = await prisma.role.upsert({ where: { name: "system-admin" }, create: { name: "system-admin", description: "Built-in administrator", permissions: [...PERMISSIONS], system: true }, update: { permissions: [...PERMISSIONS], system: true } });
    await prisma.user.create({ data: { email: email.toLowerCase(), displayName: "Administrator", passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
    console.log(`Created administrator ${email.toLowerCase()}`);
  } else if (command === "reset") {
    await prisma.user.update({ where: { email: email.toLowerCase() }, data: { passwordHash: await hashPassword(password), forcePasswordChange: true, sessions: { deleteMany: {} } } });
    console.log(`Reset administrator ${email.toLowerCase()}; password change required`);
  } else throw new Error("Unknown command");
} finally { await prisma.$disconnect(); }
