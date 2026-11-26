import "server-only";

import type { User } from "@/domain/models";
import { getMarketingService } from "@/server/application";

/** The first screen needs identity, active teammates, and visible Home tasks. */
export async function getBootstrapData(actor: User) {
  const service = getMarketingService();
  const [users, tasks] = await Promise.all([
    service.listUsers(actor),
    service.listHomeTasks(actor),
  ]);
  return {
    user: actor,
    users: users.map((user) => ({
      id: user.id,
      telegramUsername: user.telegramUsername,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
      deactivatedAt: user.deactivatedAt,
    })),
    tasks,
  };
}
