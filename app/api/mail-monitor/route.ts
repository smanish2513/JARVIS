import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase, getMailMonitorPreference, saveMailMonitorPreference } from "@/lib/database";
import { isOwnerRequest, ownerId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const preferenceSchema = z.object({
  enabled: z.boolean(),
  query: z.string().trim().min(1).max(2_000),
});
const requiredWhatsApp = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_RECIPIENT_ID",
  "WHATSAPP_ALERT_TEMPLATE_NAME",
  "WHATSAPP_ALERT_TEMPLATE_LANGUAGE",
] as const;

function whatsAppReady() {
  return requiredWhatsApp.every((key) => Boolean(process.env[key]));
}

function unavailable() {
  return NextResponse.json({ error: "Cloud monitoring settings are not configured." }, { status: 503 });
}

function unauthorized() {
  return NextResponse.json({ error: "Sign in to your private JARVIS workspace." }, { status: 401 });
}

export async function GET(request: Request) {
  if (!isOwnerRequest(request)) return unauthorized();
  const sql = getDatabase();
  if (!sql) return unavailable();

  try {
    const preference = await getMailMonitorPreference(sql, ownerId());
    return NextResponse.json({
      enabled: preference.gmail_monitor_enabled,
      query: preference.gmail_query,
      gmailAuthorized: preference.gmail_authorized,
      ready: whatsAppReady() && preference.gmail_authorized,
    });
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request) {
  if (!isOwnerRequest(request)) return unauthorized();
  const sql = getDatabase();
  if (!sql) return unavailable();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send valid JSON monitoring settings." }, { status: 400 });
  }

  const parsed = preferenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid Gmail query." }, { status: 400 });
  }

  try {
    if (parsed.data.enabled) {
      if (!whatsAppReady()) {
        return NextResponse.json(
          { error: "Finish the WhatsApp Business setup before enabling mail alerts." },
          { status: 409 },
        );
      }
      const current = await getMailMonitorPreference(sql, ownerId());
      if (!current.gmail_authorized) {
        return NextResponse.json(
          { error: "First check Gmail in JARVIS chat and complete Google read-only consent." },
          { status: 409 },
        );
      }
    }

    await saveMailMonitorPreference(sql, ownerId(), parsed.data);
    const preference = await getMailMonitorPreference(sql, ownerId());
    return NextResponse.json({
      ...parsed.data,
      gmailAuthorized: preference.gmail_authorized,
      ready: whatsAppReady() && preference.gmail_authorized,
    });
  } catch {
    return unavailable();
  }
}
