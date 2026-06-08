export async function register() {
  const { ensureGeminiEnv } = await import("@/lib/edison/gemini-config");
  ensureGeminiEnv();
}
