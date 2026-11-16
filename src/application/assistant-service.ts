import { z } from "zod";
import { ApplicationError } from "./errors";
import type { MarketingService } from "./marketing-service";
import type { AssistantModel } from "./ports/assistant-model";
import type { AssistantRepository } from "./ports/assistant-repository";
import type { User } from "@/domain/models";

const TurnInputSchema = z.object({
  requestKey: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9:_-]+$/),
  source: z.enum(["WEB", "TELEGRAM"]),
  text: z.string().trim().min(1).max(3000),
}).strict();

export class AssistantService {
  constructor(
    private readonly repository: AssistantRepository,
    private readonly model: AssistantModel,
    private readonly marketing: MarketingService,
  ) {}

  available(): boolean { return this.model.isAvailable(); }

  async listRecent(actor: User) {
    if (!actor.isActive) throw new ApplicationError("FORBIDDEN", "Faol hisob kerak.");
    return this.repository.listRecent(actor.id, 20);
  }

  async respond(actor: User, input: unknown) {
    if (!actor.isActive) throw new ApplicationError("FORBIDDEN", "AI yordamchidan faqat faol jamoa a’zolari foydalana oladi.");
    const parsed = TurnInputSchema.parse(input);
    if (!this.model.isAvailable()) {
      throw new ApplicationError("INTEGRATION_UNAVAILABLE", "AI yordamchi hali ulanmagan. Rahbar Vercel AI Gateway to‘lovini faollashtirishi kerak.");
    }
    const claimed = await this.repository.claim({ userId: actor.id, ...parsed });
    if (!claimed.fresh) {
      return {
        status: claimed.turn.status,
        answer: claimed.turn.answerText,
        turnId: claimed.turn.id,
        reused: true,
      };
    }
    try {
      const [history, page, users] = await Promise.all([
        this.repository.listRecent(actor.id, 8),
        this.marketing.listTaskPage(actor, actor.role === "HEAD_OF_MARKETING" ? "team" : "my", {
          pageSize: 20, sort: "deadline_asc", reportView: "open",
        }),
        this.marketing.listUsers(actor),
      ]);
      const response = await this.model.generate({ actor, question: parsed.text,
        history: history.filter((item) => item.id !== claimed.turn.id), tasks: page.tasks, users });
      const answer = response.answer.trim().slice(0, 9000);
      if (!answer) throw new Error("AI returned an empty answer");
      await this.repository.finish({ turnId: claimed.turn.id, userId: actor.id, answer,
        inputTokens: response.inputTokens, outputTokens: response.outputTokens });
      return { status: "COMPLETE" as const, answer, turnId: claimed.turn.id, reused: false };
    } catch (error) {
      try {
        await this.repository.finish({ turnId: claimed.turn.id, userId: actor.id, answer: null,
          inputTokens: null, outputTokens: null });
      } catch {
        console.error(JSON.stringify({ event: "assistant_failure_record_failed", turnId: claimed.turn.id }));
      }
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("INTEGRATION_UNAVAILABLE", "AI yordamchi hozir javob bera olmadi. Birozdan keyin qayta yozing.");
    }
  }
}
