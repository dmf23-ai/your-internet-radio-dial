// Supabase Edge Function: notify-suggestion
//
// Fired by a Database Webhook on every INSERT into public.suggestions.
// Builds a plain-text email and sends it via Resend's HTTP API to David's
// inbox (or whatever NOTIFY_TO is set to).
//
// Required function secrets (set in Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY  — API key from resend.com (starts with `re_`)
//   NOTIFY_TO       — destination email address
//   NOTIFY_FROM     — sender email; "onboarding@resend.dev" works without
//                     domain verification, otherwise needs a verified domain
//
// Deploy: paste this whole file into the Supabase dashboard's Edge Function
// editor (Edge Functions → Deploy a new function → name "notify-suggestion"),
// or run `supabase functions deploy notify-suggestion` from the project root
// if you prefer the CLI.

// deno-lint-ignore-file no-explicit-any

interface SuggestionRow {
  id: string;
  user_id: string | null;
  kind: "station" | "other";
  station_name: string | null;
  station_url: string | null;
  station_notes: string | null;
  message: string | null;
  contact_email: string | null;
  user_agent: string | null;
  created_at: string;
}

interface WebhookPayload {
  type: "INSERT";
  table: string;
  schema: string;
  record: SuggestionRow;
  old_record: null;
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_TO = Deno.env.get("NOTIFY_TO") ?? "";
const NOTIFY_FROM =
  Deno.env.get("NOTIFY_FROM") ?? "onboarding@resend.dev";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!RESEND_API_KEY || !NOTIFY_TO) {
    return new Response(
      "Server misconfigured: RESEND_API_KEY and NOTIFY_TO must both be set as function secrets.",
      { status: 500 },
    );
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const r = payload?.record;
  if (!r || typeof r !== "object") {
    return new Response("Missing record in payload", { status: 400 });
  }

  // --- compose subject + body ---
  const subject =
    r.kind === "station"
      ? `[Radio Dial] Station suggestion: ${r.station_name ?? "(no name)"}`
      : "[Radio Dial] New suggestion-box message";

  const lines: string[] = [];
  lines.push(`Kind: ${r.kind}`);
  if (r.kind === "station") {
    lines.push(`Station name: ${r.station_name ?? "(none)"}`);
    lines.push(`Stream URL:   ${r.station_url ?? "(none)"}`);
    if (r.station_notes) {
      lines.push("");
      lines.push("Notes:");
      lines.push(r.station_notes);
    }
  } else {
    lines.push("");
    lines.push("Message:");
    lines.push(r.message ?? "(empty)");
  }
  lines.push("");
  lines.push("---");
  if (r.contact_email) lines.push(`Contact email: ${r.contact_email}`);
  if (r.user_id) lines.push(`Supabase user id: ${r.user_id}`);
  if (r.user_agent) lines.push(`User-Agent: ${r.user_agent}`);
  lines.push(`Submitted at: ${r.created_at}`);
  lines.push(`Suggestion id: ${r.id}`);

  const body = lines.join("\n");

  // --- send via Resend ---
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: NOTIFY_TO,
      subject,
      text: body,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "(unreadable)");
    console.error("[notify-suggestion] Resend error", res.status, errText);
    return new Response(`Resend error: ${res.status} ${errText}`, {
      status: 502,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
