import type { User } from "@/domain/models";

export interface ReportDispatcher {
  sendReport(recipient: User, text: string): Promise<void>;
}
