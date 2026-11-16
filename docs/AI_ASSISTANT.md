# AI assistant setup and operation

The Head authorized a friendly, task-aware assistant for the private Telegram bot and Mini App. It is read-only: it offers plans and SOP answers, and never creates or approves tasks.

## Preview setup

1. Apply `20261116192837_assistant_turns.sql` to the staging Supabase project only. The migration creates a server-only conversation table and service-role RPCs.
2. In the Vercel team that owns this project, open **AI Gateway**, add a payment method, and **Top up / Add credits**. Set a **$25 monthly project budget** before live tests. The budget is a spending cap, not a credit purchase. The selected model rejects free-tier-only access with HTTP 403. A ChatGPT subscription does not cover Gateway/API usage.
3. Vercel AI SDK reads the deployment's rotating OIDC token from the request context. An extra API key is normally unnecessary. For local development, create an AI Gateway key and set `AI_GATEWAY_API_KEY` server-side. Never use a `NEXT_PUBLIC_` prefix. `AI_GATEWAY_MODEL` defaults to `openai/gpt-6.1-terra`.
4. Redeploy Preview after changing environment variables. Sign in as a test team member, open **✦ Ish yordamchisi**, and ask “Bugun nimadan boshlay?”. Ask the same question in a private bot chat after its webhook points to Preview. Telegram group messages do not call AI.
5. Check task scope with a normal member and the Head. The model sees at most 20 open, scoped tasks per answer. Verify that it says no approved SOP exists when asked for an unwritten rule. Check Vercel AI Gateway usage and costs.

Do not point the production bot webhook at Preview for simultaneous tests with real users; use the existing staging test bot. Production database migration, billing-backed model use, and webhook deployment should be released together after Preview verification.

## Limits and costs

The application allows at most **30 new prompts per active user per Asia/Tashkent day**. Requests are idempotent by browser UUID or Telegram update ID. The model call times out after 20 seconds and caps output at 700 tokens. Recent personal conversation and a limited task snapshot add input tokens. At catalog prices checked 2026-11-17, `openai/gpt-6.1-terra` was about **$1 per million input tokens** and **$5 per million output tokens** on AI Gateway; actual spend varies with prompt length and provider. Five users each asking 30 times daily at about 2,000 input and 300 output tokens per answer would cost roughly **$16/month**. The Vercel budget is the financial backstop; check current model pricing in the Dashboard before enabling.

## SOP content

The assistant reads `src/server/assistant/TEAM_SOP.md` from the deployed build. The Head has not yet supplied approved operating rules. Add confirmed rules there through a reviewed change and redeploy. A Notion draft exists but there is no automatic sync yet; adding a Notion page without syncing it does not update the assistant.
