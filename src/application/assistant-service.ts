import { z } from "zod";
import { ApplicationError } from "./errors";
import type { MarketingService } from "./marketing-service";
import type { AssistantModel } from "./ports/assistant-model";
import type { AssistantRepository } from "./ports/assistant-repository";
import type { User } from "@/domain/models";
import type { Task } from "@/domain/models";
import type { AssistantAction, AssistantProposal } from "./assistant-action";
import { canTransition } from "@/domain/workflow";

const TurnInputSchema = z.object({
  requestKey: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9:_-]+$/),
  source: z.enum(["WEB", "TELEGRAM"]),
  text: z.string().trim().min(1).max(3000),
}).strict();

const actionLabels = { ACCEPT: "Ishni boshlash", BLOCK: "Bloklash", RESUME: "Davom ettirish",
  SUBMIT_REVIEW: "Tekshiruvga yuborish", APPROVE: "Tasdiqlash",
  REQUEST_REVISION: "Tuzatishga qaytarish", CANCEL: "Bekor qilish", REOPEN: "Qayta ochish" } as const;

function localDeadline(value: string): string {
  return new Intl.DateTimeFormat("uz-UZ", { timeZone: "Asia/Tashkent", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(value));
}

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
      throw new ApplicationError("INTEGRATION_UNAVAILABLE", "AI yordamchi hali ulanmagan. Rahbar OpenAI API kalitini serverga qo‘shishi kerak.");
    }
    const claimed = await this.repository.claim({ userId: actor.id, ...parsed });
    if (!claimed.fresh) {
      return {
        status: claimed.turn.status,
        answer: claimed.turn.actionResult && claimed.turn.proposalStatus === "DONE"
          ? `${claimed.turn.answerText ?? ""}\n\n${claimed.turn.actionResult}` : claimed.turn.answerText,
        proposal: claimed.turn.proposalStatus === "PENDING" &&
          claimed.turn.proposalExpiresAt && Date.parse(claimed.turn.proposalExpiresAt) > Date.now()
          ? claimed.turn.proposal : null,
        turnId: claimed.turn.id,
        reused: true,
      };
    }
    try {
      const [history, page, recentPage, users] = await Promise.all([
        this.repository.listRecent(actor.id, 8),
        this.marketing.listTaskPage(actor, actor.role === "HEAD_OF_MARKETING" ? "team" : "my", {
          pageSize: 20, sort: "deadline_asc", reportView: "open",
        }),
        this.marketing.listTaskPage(actor, actor.role === "HEAD_OF_MARKETING" ? "team" : "created",
          { pageSize: 20, sort: "created_desc", reportView: "open" }),
        this.marketing.listUsers(actor),
      ]);
      const tasks = [...new Map([...page.tasks, ...recentPage.tasks]
        .map((task) => [task.id, task])).values()];
      const response = await this.model.generate({ actor, question: parsed.text,
        history: history.filter((item) => item.id !== claimed.turn.id), tasks, users });
      const proposal = response.action ? this.prepareProposal(actor, response.action, tasks, users, parsed.text) : null;
      const answer = (response.action && !proposal
        ? response.action.kind === "ADD_CHECKPOINT"
          ? "Bu checkpointni hozir qo‘sha olmayman. Vazifa va checkpoint nomini aniq yozing; vazifa mas’uli, yaratuvchisi yoki rahbarigina band qo‘sha oladi."
          : "Bu amalni hozir tasdiqlash uchun vazifa yoki mas’ulni aniq topolmadim yoxud ruxsat yetarli emas. Kerakli tafsilotlarni aniqlashtiring."
        : response.answer).trim().slice(0, 9000);
      if (!answer) throw new Error("AI returned an empty answer");
      await this.repository.setProposal({ turnId: claimed.turn.id, userId: actor.id, proposal });
      await this.repository.finish({ turnId: claimed.turn.id, userId: actor.id, answer,
        inputTokens: response.inputTokens, outputTokens: response.outputTokens });
      return { status: "COMPLETE" as const, answer, proposal, turnId: claimed.turn.id, reused: false };
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

  private prepareProposal(actor: User, action: AssistantAction, tasks: Task[], users: User[], question: string): AssistantProposal | null {
    if (action.kind === "CREATE_TASK") {
      const assignee = users.find((user) => user.id === action.assigneeId && user.isActive);
      if (!assignee || Date.parse(action.deadline) <= Date.now()) return null;
      const sameNames = users.filter((user) => user.isActive &&
        user.displayName.toLocaleLowerCase() === assignee.displayName.toLocaleLowerCase());
      if (sameNames.length > 1 && !question.includes(assignee.id) &&
        !(assignee.telegramUsername && question.toLocaleLowerCase().includes(`@${assignee.telegramUsername.toLocaleLowerCase()}`))) return null;
      return { action, summary: `Vazifa yaratish: ${action.title}\nMas’ul: ${assignee.displayName}\nMuddat: ${localDeadline(action.deadline)}` };
    }
    const task = tasks.find((item) => item.id === action.taskId);
    if (!task) return null;
    if (tasks.filter((item) => item.title.trim().toLocaleLowerCase() === task.title.trim().toLocaleLowerCase()).length > 1 &&
      !question.includes(task.id)) return null;
    if (action.kind === "ADD_CHECKPOINT") {
      if ((actor.role !== "HEAD_OF_MARKETING" && task.creatorId !== actor.id && task.assigneeId !== actor.id) ||
        task.status === "DONE" || task.status === "CANCELLED") return null;
      return { action, summary: `Checkpoint qo‘shish: ${task.title}\nBand: ${action.title}${action.dueAt ? `\nVaqt: ${localDeadline(action.dueAt)}` : ""}` };
    }
    if (action.kind === "REQUEST_DEADLINE") {
      if (task.assigneeId !== actor.id || Date.parse(action.requestedDeadline) <= Date.now()) return null;
      return { action, summary: `Muddat so‘rovi: ${task.title}\nYangi muddat: ${localDeadline(action.requestedDeadline)}\nSabab: ${action.reason}` };
    }
    const assigneeActions = ["ACCEPT", "BLOCK", "RESUME", "SUBMIT_REVIEW"];
    const reviewerActions = ["APPROVE", "REQUEST_REVISION"];
    if (!canTransition(task.status, action.action) ||
      (assigneeActions.includes(action.action) && task.assigneeId !== actor.id) ||
      (reviewerActions.includes(action.action) && task.creatorId !== actor.id && actor.role !== "HEAD_OF_MARKETING") ||
      (action.action === "CANCEL" && task.creatorId !== actor.id && actor.role !== "HEAD_OF_MARKETING") ||
      (action.action === "REOPEN" && actor.role !== "HEAD_OF_MARKETING") ||
      (action.action === "BLOCK" && !action.reason)) return null;
    return { action, summary: `Holatni o‘zgartirish: ${task.title}\nAmal: ${actionLabels[action.action]}${action.reason ? `\nSabab: ${action.reason}` : ""}` };
  }

  async confirm(actor: User, turnId: string) {
    if (!actor.isActive) throw new ApplicationError("FORBIDDEN", "Faol hisob kerak.");
    const claim = await this.repository.claimAction({ turnId: z.uuid().parse(turnId), userId: actor.id });
    if (!claim.fresh) return { answer: claim.result, reused: true };
    try {
      const action = claim.proposal.action;
      let answer: string;
      if (action.kind === "CREATE_TASK") {
        const result = await this.marketing.createTaskQueued(actor, {
          title: action.title, assigneeId: action.assigneeId, deadline: action.deadline,
          priority: action.priority, ...(action.description ? { description: action.description } : {}),
        });
        answer = `✅ Vazifa yaratildi: ${result.task.title} (#${result.task.id.slice(0, 8)}).`;
      } else if (action.kind === "CHANGE_STATUS") {
        const task = await this.marketing.performTaskAction(actor, action.taskId, {
          action: action.action, ...(action.reason ? { reason: action.reason } : {}),
          ...(action.nextDeadline ? { nextDeadline: action.nextDeadline } : {}),
        }, { deferNotifications: true });
        answer = `✅ ${task.title}: holat ${task.status} ga o‘zgardi.`;
      } else if (action.kind === "ADD_CHECKPOINT") {
        const checkpoint = await this.marketing.addCheckpoint(actor, action.taskId, {
          title: action.title, dueAt: action.dueAt,
        });
        answer = `✅ Checkpoint qo‘shildi: ${checkpoint.title}.`;
      } else {
        const request = await this.marketing.requestDeadlineChange(actor, action.taskId, {
          requestedDeadline: action.requestedDeadline, reason: action.reason,
        });
        answer = `✅ Muddat so‘rovi yuborildi (#${request.id.slice(0, 8)}). Tasdiq kutilmoqda.`;
      }
      await this.repository.finishAction({ turnId, userId: actor.id, result: answer, success: true });
      return { answer, reused: false };
    } catch (error) {
      const message = error instanceof ApplicationError ? error.message : "Amal bajarilmadi. Vazifa holatini tekshiring.";
      try { await this.repository.finishAction({ turnId, userId: actor.id, result: message, success: false }); }
      catch { console.error(JSON.stringify({ event: "assistant_action_finish_failed", turnId })); }
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("INTEGRATION_UNAVAILABLE", message);
    }
  }
}
