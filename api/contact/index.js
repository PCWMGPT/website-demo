"use strict";

/*
 * POST /api/contact
 * Receives a JSON contact-form submission and emails it to the team via
 * Microsoft Graph (sendMail) using client-credentials auth.
 *
 * Config (environment variables only — never hardcode):
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   MAIL_SENDER  = team@pointercreek.com
 *   MAIL_TO      = team@pointercreek.com,clientservices@pointercreek.com
 *
 * Privacy: we never log message contents or personal info — only outcome/error type.
 */

const { ClientSecretCredential } = require("@azure/identity");

// ---- In-memory, per-instance rate limiting -------------------------------
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_MAX = 5; // submissions per window per IP
const hits = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return recent.length > RATE_MAX;
}

// ---- Helpers -------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max) {
  return String(value == null ? "" : value)
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function easternTimestamp() {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      dateStyle: "full",
      timeStyle: "long",
    }).format(new Date());
  } catch (e) {
    return new Date().toISOString() + " (UTC)";
  }
}

let cachedCredential = null;
function getCredential() {
  if (!cachedCredential) {
    cachedCredential = new ClientSecretCredential(
      process.env.GRAPH_TENANT_ID,
      process.env.GRAPH_CLIENT_ID,
      process.env.GRAPH_CLIENT_SECRET
    );
  }
  return cachedCredential;
}

module.exports = async function (context, req) {
  const respond = (status, body) => {
    context.res = {
      status,
      headers: { "Content-Type": "application/json" },
      body,
    };
  };

  try {
    // ---- Rate limit (client IP from SWA's x-forwarded-for) ----
    const ip = ((req.headers && req.headers["x-forwarded-for"]) || "")
      .split(",")[0]
      .trim() || "unknown";
    if (isRateLimited(ip)) {
      context.log.warn("contact: rate_limited");
      return respond(429, { ok: false, error: "rate_limited" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};

    // ---- Honeypot: if filled, pretend success and send nothing ----
    if (clean(body.company, 200)) {
      context.log("contact: honeypot_triggered");
      return respond(200, { ok: true });
    }

    // ---- Minimum time-to-submit (bot guard) ----
    const elapsedMs = Number(body.elapsedMs);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 3000) {
      context.log("contact: too_fast");
      return respond(400, { ok: false, error: "too_fast" });
    }

    // ---- Collect + validate fields ----
    const name = clean(body.name, 200);
    const email = clean(body.email, 320);
    const phone = clean(body.phone, 50);
    const prompt = clean(body.prompt, 200);
    const message = clean(body.message, 5000);
    const page = clean(body.page, 300);

    if (!name || !EMAIL_RE.test(email) || !message) {
      context.log("contact: validation_failed");
      return respond(400, { ok: false, error: "validation" });
    }

    // ---- Config check ----
    const sender = process.env.MAIL_SENDER;
    const toList = (process.env.MAIL_TO || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      !sender ||
      toList.length === 0 ||
      !process.env.GRAPH_TENANT_ID ||
      !process.env.GRAPH_CLIENT_ID ||
      !process.env.GRAPH_CLIENT_SECRET
    ) {
      context.log.error("contact: misconfigured_env");
      return respond(500, { ok: false, error: "server" });
    }

    // ---- Build the email (HTML + plain text) ----
    const ts = easternTimestamp();
    const rows = [
      ["Name", name],
      ["Email", email],
      ["Phone", phone || "—"],
      ["What's prompting this", prompt || "—"],
      ["Submitted from", page || "—"],
      ["Received", ts + " (Eastern)"],
    ];

    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1d2419;line-height:1.5;">' +
      '<h2 style="margin:0 0 14px;font-size:18px;">New website contact request</h2>' +
      '<table style="border-collapse:collapse;">' +
      rows
        .map(
          ([k, v]) =>
            '<tr><td style="padding:4px 14px 4px 0;color:#6a8c62;vertical-align:top;white-space:nowrap;"><strong>' +
            escapeHtml(k) +
            '</strong></td><td style="padding:4px 0;">' +
            escapeHtml(v) +
            "</td></tr>"
        )
        .join("") +
      "</table>" +
      '<p style="margin:16px 0 4px;color:#6a8c62;"><strong>Message</strong></p>' +
      '<div style="white-space:pre-wrap;border-left:3px solid #9cb389;padding:2px 0 2px 12px;">' +
      escapeHtml(message) +
      "</div>" +
      '<p style="margin:18px 0 0;font-size:12px;color:#8a9a7d;">Reply directly to this email to respond to ' +
      escapeHtml(name) +
      ".</p>" +
      "</div>";

    const text =
      "New website contact request\n\n" +
      rows.map(([k, v]) => k + ": " + v).join("\n") +
      "\n\nMessage:\n" +
      message +
      "\n\n(Reply directly to this email to respond.)\n";

    // ---- Acquire Graph token (client credentials) ----
    const token = (
      await getCredential().getToken("https://graph.microsoft.com/.default")
    ).token;

    // ---- Send via Graph: prefer a MIME message so we get real HTML + text.
    // Fallback to the JSON message shape if MIME send is rejected. ----
    const boundary = "pcwm_" + Date.now().toString(36);
    const mime = [
      "From: Pointer Creek Website <" + sender + ">",
      "To: " + toList.join(", "),
      "Reply-To: " + email,
      "Subject: Website contact request – " + name,
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="' + boundary + '"',
      "",
      "--" + boundary,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
      "--" + boundary,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
      "--" + boundary + "--",
      "",
    ].join("\r\n");

    const sendUrl =
      "https://graph.microsoft.com/v1.0/users/" +
      encodeURIComponent(sender) +
      "/sendMail";

    let resp = await fetch(sendUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "text/plain",
      },
      body: Buffer.from(mime, "utf-8").toString("base64"),
    });

    // Fallback to the structured JSON message if MIME send isn't accepted.
    if (resp.status !== 202) {
      const jsonMessage = {
        message: {
          subject: "Website contact request – " + name,
          body: { contentType: "HTML", content: html },
          toRecipients: toList.map((a) => ({ emailAddress: { address: a } })),
          replyTo: [{ emailAddress: { address: email } }],
        },
        saveToSentItems: true,
      };
      resp = await fetch(sendUrl, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(jsonMessage),
      });
    }

    if (resp.status !== 202) {
      context.log.error("contact: graph_send_failed status=" + resp.status);
      return respond(502, { ok: false, error: "send_failed" });
    }

    context.log("contact: sent ok");
    return respond(200, { ok: true });
  } catch (err) {
    context.log.error("contact: exception type=" + (err && err.name ? err.name : "unknown"));
    return respond(500, { ok: false, error: "server" });
  }
};
