# SOP-based assistant: next implementation stage

The user authorized an optional assistant to help members plan tasks, break large work into checkpoints, and answer SOP questions using the Head's documented knowledge. The assistant is not yet enabled or connected to a model. Production deployment of AI requires a deliberate update to the current no-AI product rule, verified SOP sources, and a provider credential.

## Knowledge and permission boundary

1. The Head supplies and approves SOP documents. Each document needs an owner, last-reviewed date, scope, version, and source link. Unreviewed chat messages and task comments do not become policy automatically. The draft Notion home is [Marketing jamoasi — SOP va qarorlar](https://app.notion.com/p/41986faa180481f1b828f8e96f2668f2); its child `SOP kutubxonasi` has a reusable draft template and an explicit approval status. The Head will write or revise SOPs there and notify us to review and sync approved content.
2. Store current published SOPs with version history. Retrieve relevant passages with citations for each answer. Restrict documents and task context to the requesting member's existing permissions.
3. The assistant may suggest a daily order, estimated effort, SMART-style outcome wording, and checkpoints. It cannot create, approve, reassign, or complete a task without a separate explicit user action through the existing application service.
4. Keep provider keys server-only, redact secrets and private identifiers from logs, apply per-user rate limits and bounded context size, and record model/cost/error metrics without storing raw prompts by default.
5. Start with deterministic full-text retrieval for the small SOP corpus. Add embeddings only if measured question quality requires them. Test unsupported questions and conflicting/outdated SOP versions before enabling AI for teammates.

## Inputs needed

- The Head's SOP files or source links and which teammates may read each document.
- Choice of model provider and budget. A staging credential is enough for the first prototype.
- A decision to update the no-AI production rule after a staging review.
