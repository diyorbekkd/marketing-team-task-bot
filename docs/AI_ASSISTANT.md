# AI assistant setup and operation

The Head authorized a friendly, task-aware assistant for the private Telegram bot and Mini App. It is read-only: it offers plans and SOP answers, and never creates or approves tasks. Both interfaces call the same server service.

## OpenAI API credit setup

The Head shared an offer for API credits with an eligible ChatGPT Pro subscription. Claim the benefit in **ChatGPT → Settings → Billing → API credits benefit**, selecting an OpenAI API organization owned by the same account. Confirm the credit grant in that organization's API Platform billing overview. Eligibility and grant size must be verified in the account; unused monthly grants expire at the end of the subscription cycle. [OpenAI's benefit guide](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions) explains the claim flow.

1. In the credited organization, create a dedicated API project for this app and a project API key. Grant only the access needed for model generation. Do not paste the key into chat, Git, or the Mini App.
2. In **OpenAI API Platform → Organization settings → project → Limits**, set a monthly spend limit (suggested starting point: **$25**) and enable **Enforce a hard limit** if available. Alerts alone do not stop requests. [OpenAI project limits](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform) describes this control. The former $25 Vercel AI Gateway budget does not govern direct OpenAI API calls.
3. In Vercel project `marketing-team-task-bot` → **Settings → Environment Variables**, add `OPENAI_API_KEY` as a **Preview-only, server-side secret**. Set `OPENAI_MODEL=gpt-6.1-terra` only if overriding the default is desired. Do not use `NEXT_PUBLIC_`.
4. Redeploy Preview after the environment change. Sign in as a test member, ask “Bugun nimadan boshlay?” in **✦ Ish yordamchisi**, and ask a new question in the private staging test bot chat. Group messages do not call AI. Verify both `COMPLETE` turns in staging and inspect usage in the credited OpenAI project.
5. Check employee task scope against Head scope, and ask a question about an unwritten SOP. The assistant must say that no approved SOP exists rather than inventing one.

The staging Supabase migration `20261116192837_assistant_turns.sql` is already applied. Production database migration and environment configuration remain separate release steps. Do not point the production bot webhook at Preview.

## Limits and costs

The application allows at most **30 new prompts per active user per Asia/Tashkent day**. Requests are idempotent by browser UUID or Telegram update ID. Each model call times out after 20 seconds and caps output at 700 tokens. The assistant sends at most 20 open tasks and a short personal chat history. At the model's listed price checked 2026-11-17, `gpt-6.1-terra` costs about **$1 per million input tokens** and **$5 per million output tokens**. Five users asking 30 questions each daily at about 2,000 input and 300 output tokens per answer would incur roughly **$16/month** before applicable API credits. Actual cost and credit eligibility depend on the OpenAI account and usage.

## SOP content

The assistant reads `src/server/assistant/TEAM_SOP.md` from the deployed build. The Head has not yet supplied approved operating rules. Add confirmed rules there through a reviewed change and redeploy. A Notion draft exists but there is no automatic sync yet; adding a Notion page without syncing it does not update the assistant.
