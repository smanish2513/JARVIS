import { defineTool } from "eve/tools";
import { z } from "zod";
import { ensureDatabaseSchema, getDatabase, getMailMonitorPreference } from "../../lib/database";
import { ownerId } from "../../lib/server-auth";

const alertEmailSchema = z.object({
  id: z.string().min(1).max(512),
  sender: z.string().trim().min(1).max(240),
  subject: z.string().trim().min(1).max(300),
  action: z.string().trim().min(1).max(300),
});

function shortText(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

export default defineTool({
  description:
    "Send one approved WhatsApp template alert to the user's own number for new important mail. Use only during the enabled scheduled mail monitor, and only for messages that need timely action. Already-alerted Gmail message IDs are skipped.",
  inputSchema: z.object({ emails: z.array(alertEmailSchema).min(1).max(10) }),
  label: { start: () => "Send JARVIS alert" },
  endsTurn: true,
  async execute({ emails }, ctx) {
    const auth = ctx.session.auth.current;
    if (
      auth?.principalId !== ownerId() ||
      auth.attributes.monitorPurpose !== "scheduled-email-monitor"
    ) {
      return { sent: false, reason: "This alert tool is reserved for the scheduled mail monitor." };
    }

    const sql = getDatabase();
    const recipientId = process.env.WHATSAPP_RECIPIENT_ID;
    const templateName = process.env.WHATSAPP_ALERT_TEMPLATE_NAME;
    const templateLanguage = process.env.WHATSAPP_ALERT_TEMPLATE_LANGUAGE;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || "v27.0";
    if (!sql || !recipientId || !templateName || !templateLanguage || !accessToken || !phoneNumberId) {
      return { sent: false, reason: "Mail alerts are not configured." };
    }
    if (!/^v\d+\.\d+$/.test(apiVersion)) {
      return { sent: false, reason: "WhatsApp API version is invalid." };
    }

    try {
      await ensureDatabaseSchema(sql);
      const preference = await getMailMonitorPreference(sql, ownerId());
      if (!preference.gmail_monitor_enabled) {
        return { sent: false, reason: "Mail monitoring is disabled." };
      }

      const claimed: string[] = [];
      for (const email of emails) {
        const rows = await sql`INSERT INTO jarvis_email_alerts
          (owner_id, gmail_message_id, status, updated_at)
          VALUES (${ownerId()}, ${email.id}, 'pending', now())
          ON CONFLICT (owner_id, gmail_message_id) DO UPDATE SET
            status = 'pending', updated_at = now()
          WHERE jarvis_email_alerts.status = 'pending'
            AND jarvis_email_alerts.updated_at < now() - interval '20 minutes'
          RETURNING gmail_message_id`;
        if (rows.length > 0) claimed.push(email.id);
      }

      const eligible = emails.filter((email) => claimed.includes(email.id));
      if (eligible.length === 0) {
        return { sent: false, reason: "These messages were already alerted or are being processed." };
      }

      const lines = eligible.map((email) =>
        `• ${shortText(email.sender, 100)} — ${shortText(email.subject, 150)}. Next: ${shortText(email.action, 180)}`,
      );
      const alertText = shortText(`JARVIS found ${eligible.length} important email${eligible.length === 1 ? "" : "s"}.\n${lines.join("\n")}`, 900);
      const response = await fetch(
        `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: recipientId,
            type: "template",
            template: {
              name: templateName,
              language: { code: templateLanguage },
              components: [{ type: "body", parameters: [{ type: "text", text: alertText }] }],
            },
          }),
          signal: ctx.abortSignal,
        },
      );
      if (!response.ok) {
        return { sent: false, reason: "WhatsApp delivery failed; JARVIS will retry on a later check." };
      }

      for (const id of claimed) {
        await sql`UPDATE jarvis_email_alerts
          SET status = 'sent', notified_at = now(), updated_at = now()
          WHERE owner_id = ${ownerId()} AND gmail_message_id = ${id}`;
      }
      return { sent: true, count: eligible.length };
    } catch {
      // Keep claimed rows pending so a later run can retry after the lease expires.
      return { sent: false, reason: "WhatsApp delivery failed; JARVIS will retry on a later check." };
    }
  },
});
