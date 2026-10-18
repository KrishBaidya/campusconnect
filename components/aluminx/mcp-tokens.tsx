"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, CircleAlert, Copy, KeyRound, Trash2 } from "lucide-react";
import { createToken, revokeToken } from "@/app/tokens/actions";
import { When } from "./when";

type Token = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

/** "Connect an AI assistant": create and revoke personal access tokens for /api/mcp. */
export function McpTokens({ tokens, endpoint }: { tokens: Token[]; endpoint: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Couldn’t copy. Select the text and copy it yourself.");
    }
  };

  return (
    <section className="sec" style={{ marginTop: 48, maxWidth: 720 }} aria-labelledby="mcp-h">
      <h3 id="mcp-h" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Bot className="ic" style={{ fontSize: 18, color: "var(--accent-hi)" }} />
        Connect an AI assistant
      </h3>
      <p>
        AluminX has an MCP server, so assistants like Claude can search people, read your feed and mentorship requests, and send connection requests for you.
        Create a token, then add the server to your assistant with it. Anyone with the token can act as you, so keep it private.
      </p>

      <div className="attach" style={{ marginTop: 0 }}>
        <div className="t" style={{ fontWeight: 500, fontSize: 13.5 }}>
          Server URL
          <code className="mono" style={{ color: "var(--accent-ink)", overflowWrap: "anywhere" }}>
            {endpoint}
          </code>
          <button type="button" className="btn sm icon ghost" aria-label="Copy server URL" onClick={() => copy(endpoint, "url")} style={{ marginLeft: "auto" }}>
            {copied === "url" ? <Check className="ic" /> : <Copy className="ic" />}
          </button>
        </div>
      </div>

      {fresh && (
        <div className="attach" style={{ borderColor: "rgba(52,211,153,.35)", marginTop: 0 }} role="status">
          <div className="t" style={{ color: "var(--ok)" }}>
            <KeyRound className="ic" style={{ color: "var(--ok)" }} />
            Copy your token now. You won&apos;t see it again.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code className="mono" style={{ flex: 1, overflowWrap: "anywhere", fontSize: 13 }}>
              {fresh}
            </code>
            <button type="button" className="btn sm" onClick={() => copy(fresh, "token")}>
              {copied === "token" ? <Check className="ic" /> : <Copy className="ic" />}
              {copied === "token" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="stack">
          {tokens.map((t) => (
            <div key={t.id} className="person">
              <KeyRound className="ic" style={{ color: "var(--fg-3)" }} />
              <div>
                <b>{t.name}</b>
                <small>
                  <span className="mono">{t.prefix}…</span>. Created <When iso={t.createdAt} format={(s) => new Date(s).toLocaleDateString()} />.{" "}
                  {t.lastUsedAt ? (
                    <>
                      Last used <When iso={t.lastUsedAt} format={(s) => new Date(s).toLocaleString()} />.
                    </>
                  ) : (
                    "Never used."
                  )}
                </small>
              </div>
              <button
                type="button"
                className="btn sm ghost danger"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Revoke “${t.name}”? Assistants using it will lose access.`)) return;
                  start(async () => {
                    const res = await revokeToken(t.id).catch(() => ({ ok: false as const, error: "Something went wrong." }));
                    if (!res.ok) setError(res.error);
                    router.refresh();
                  });
                }}
              >
                <Trash2 className="ic" />
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const res = await createToken(name).catch(() => ({ ok: false as const, error: "Something went wrong." }));
            if (!res.ok) return setError(res.error);
            setFresh(res.token);
            setName("");
            router.refresh();
          });
        }}
      >
        <input className="input" style={{ height: 36, flex: "1 1 220px", width: "auto" }} placeholder="Token name, e.g. Claude Desktop" aria-label="Token name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button type="submit" className="btn primary sm" style={{ height: 36 }} disabled={pending || !name.trim()}>
          <KeyRound className="ic" />
          Create token
        </button>
      </form>
      {error && (
        <span className="err-t" role="alert">
          <CircleAlert className="ic" />
          {error}
        </span>
      )}
    </section>
  );
}
