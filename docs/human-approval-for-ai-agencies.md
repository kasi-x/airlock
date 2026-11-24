# Human Approval for AI Agencies and Freelancers

Human approval for AI agencies means gating client-facing posts, invoices, and deliverables per account before an agent's mistake hits a client's brand.

---

## The problem is specific to running agents for other people

A solo founder using an AI agent on their own accounts can afford to be a little loose — if it sends a rough email from their own inbox, they clean it up themselves. An agency or freelancer running the same kind of agent across five or ten client accounts doesn't have that slack. A social post that goes out with the wrong tone, an invoice sent with the wrong line items, or a deliverable submitted before it's actually reviewed is now a client relationship problem, not an internal one — and it happened on an account the client trusts you to operate carefully.

The agents themselves don't need to change. What needs to exist is a checkpoint between "agent decided to act" and "action reaches the client's audience or inbox," scoped per client, so approval and audit trail are actually enforceable — not just a policy you hope the agent follows.

## One action kind per client-facing surface

Instead of one generic "approve this" gate, agencies get more value from splitting by what the action touches, since different surfaces need different reviewers (the social manager isn't who should approve an invoice):

- `agency.social_post` — scheduled posts to a client's own social accounts
- `agency.invoice_send` — invoices or estimates sent to a client
- `agency.deliverable_submit` — final assets or copy delivered for client sign-off

## Routing each client's approvals to the right reviewer

```typescript
import { AirlockClient, AirlockRejected, AirlockExpired, AirlockTimeout } from "@airlock/sdk";

const client = new AirlockClient({ apiKey: process.env.AIRLOCK_API_KEY! });

interface ClientAction {
  clientId: string;
  clientName: string;
  kind: "agency.social_post" | "agency.invoice_send" | "agency.deliverable_submit";
  summary: string;
  body: string;
}

async function proposeForClient(a: ClientAction) {
  const created = await client.createAction({
    kind: a.kind,
    title: `[${a.clientName}] ${a.summary}`,
    preview: { format: "markdown", body: a.body },
    editable: ["preview.body"],
    expires_in: 172800, // 48 h: account managers aren't always online
  });

  let finalBody: string;
  try {
    const action = await client.awaitDecision(created.id, { timeoutS: 172800 });
    // The reviewer may have edited the copy before approving.
    finalBody = action.decision?.final_preview?.body ?? a.body;
  } catch (e) {
    if (e instanceof AirlockRejected || e instanceof AirlockExpired || e instanceof AirlockTimeout) {
      console.log(`[${a.clientName}] ${a.kind} not sent: ${e.name}`);
      return;
    }
    throw e;
  }

  try {
    await executeForClient(a.clientId, a.kind, finalBody); // your integration per surface
    await client.reportResult(created.id, "executed");
  } catch (e) {
    await client.reportResult(created.id, "execute_failed", { detail: String(e) });
    throw e;
  }
}
```

The `[${a.clientName}]` prefix in the title matters more here than in a single-tenant setup — an account manager scanning a shared inbox needs to know which client a card belongs to before they even open it. For posts and invoices, the REST API also takes an `undo` note on the action ("delete the post within 5 minutes", "void and reissue the invoice"), which the inbox shows on the card; the TypeScript SDK's `createAction` doesn't pass it yet.

## Keeping client work out of one shared inbox

Prefixing titles works for a small team checking one inbox, but it doesn't scope who's *allowed* to approve what. Inside one Airlock project, every notification channel gets every pending action: Airlock doesn't route by client. Two ways agencies handle that as they grow past a couple of clients:

| Approach | When it fits |
|---|---|
| A separate Airlock project per client: its own API keys, inbox, audit log and notification channels, e.g. that account manager's [Slack](slack-approval.md) or [Telegram](telegram-approval.md) | Each client has a dedicated account manager, or wants its own record of approvals |
| One project, client name in the title, one `kind` per surface; reviewers filter the inbox by kind | Small team, everyone reviews everything |

Neither needs Airlock to know your client roster: it's how you split projects and where each project's notifications go.

## What this doesn't solve

Airlock holds the pending action and the decision — it doesn't manage client relationships, doesn't track retainer hours, and doesn't know which account manager owns which client; that mapping lives in your own agent code or a lookup table you maintain. It also isn't a substitute for a client-facing approval step if your contract requires the *client* to sign off before publishing — that's a second, separate action your agent should push once your internal reviewer has approved it. And as always, the gate only holds if the agent's posting/invoicing credentials are wrapped so `executeForClient` can't run on a path that skips the approval call — see [the propose-approve-execute pattern](the-propose-approve-execute-pattern.md).

It also doesn't collect what you need from clients before the agent can start — logos, copy, logins, answers. That is a different shape of human input: a portal link with typed fields, uploads and automatic reminders rather than an approval card. [BriefGate](https://briefgate.dev/use-cases/ai-agency-client-intake), from the same developer, covers that part.

---

Next: [how to add human approval to an AI agent](how-to-add-human-approval-to-an-ai-agent.md) for the base pattern, and [audit log](audit-log.md) for the record you'll want when a client asks who approved what.
