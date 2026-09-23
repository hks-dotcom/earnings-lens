import { CLAUDE_DAILY_CAP } from "@/lib/rules/declaredValues";

// Central place for env-derived configuration. Never hardcode secrets or
// the contact email here — both come from Vercel/`.env.local` env vars only.

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Set it in .env.local (dev) or the Vercel project settings (prod).`
    );
  }
  return v;
}

export function edgarContactEmail(): string {
  return required("EDGAR_CONTACT_EMAIL");
}

export function anthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL || "claude-opus-5";
}

/**
 * The daily cap, declared in the rules and overridable by env var for a
 * local run. Read as a function, not a module constant, so a script that
 * loads .env.local after import still sees it.
 */
export function claudeDailyCap(): number {
  const raw = Number(process.env.CLAUDE_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? raw : CLAUDE_DAILY_CAP;
}

/**
 * The explicit off switch.
 *
 * CLAUDE_ENABLED=false turns the layer off everywhere with no other
 * change: the page renders complete, every flagged item reads
 * "Explanations unavailable", and no call is made or counted. A missing
 * API key has the same effect -- "if the cap is hit, the call fails, or
 * Claude is disabled, the block reads 'Explanations unavailable' and
 * everything else renders normally."
 */
export function claudeEnabled(): boolean {
  const flag = (process.env.CLAUDE_ENABLED ?? "").trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(flag)) return false;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Why the layer is off, for the fallback line's diagnostics (never shown to a reader). */
export function claudeDisabledReason(): string | undefined {
  const flag = (process.env.CLAUDE_ENABLED ?? "").trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(flag)) return "disabled by CLAUDE_ENABLED";
  if (!process.env.ANTHROPIC_API_KEY) return "no ANTHROPIC_API_KEY set";
  return undefined;
}
