# Video materials Telegram topic

The team keeps scenarios and raw footage in its separate Telegram forum group. This integration sends only the title and scenario URL from a **Syomka** task to one chosen topic. It does not copy video files or read the group's messages. Edit tasks do not post there.

## Release setup

1. Add the environment's task bot to the materials supergroup and allow it to post in the target topic. Keep the group's topics enabled.
2. Identify the supergroup's numeric `chat.id` (normally starts with `-100`) and that topic's numeric `message_thread_id` from a Telegram update in the topic. These are different from a username or a topic title.
3. Set **both** `VIDEO_MEDIA_CHAT_ID` and `VIDEO_MEDIA_TOPIC_ID` as server-side environment variables in the matching Vercel environment. Leave both unset until ready. Do not use `NEXT_PUBLIC_` names.
4. Apply the matching Supabase migration before enabling the variables. Redeploy that environment so its functions read the new values.
5. Create one disposable Syomka task with a test scenario URL, or edit its URL, and confirm one post appears in the selected topic. Repeat an unchanged save and confirm it adds no post. Check `notification_outbox` for a `SHOOT_SCENARIO` row with `SENT` status; failures are retried by the existing notification cron up to its normal limit.

The scenario URL and topic destination are stored in the notification outbox payload. Anyone with access to that topic can see the URL, so use a scenario link intended for that group. A changed URL produces a new post; the bot does not delete older posts. Production group and topic IDs are deliberately not stored in the repository.
