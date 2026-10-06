/* Minimal Google Gemini client (browser, streaming via SSE). */

const Gemini = (() => {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta';

  async function errorFrom(res) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error && j.error.message) msg = j.error.message;
    } catch (_) { /* not JSON */ }
    const err = new Error(msg);
    err.status = res.status;
    return err;
  }

  /**
   * Streams a response. Calls onText(fullTextSoFar) as chunks arrive.
   * Resolves to { text, sources: [{title, uri}], finishReason }.
   */
  async function stream({ apiKey, model, system, messages, grounding, temperature, onText, signal }) {
    const url = `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { temperature },
    };
    if (grounding) body.tools = [{ google_search: {} }];

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await errorFrom(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const sources = new Map();
    let buf = '';
    let text = '';
    let finishReason = '';

    const handle = (chunk) => {
      if (chunk.promptFeedback && chunk.promptFeedback.blockReason) {
        throw new Error(`Request blocked by Gemini safety filters (${chunk.promptFeedback.blockReason}). Try rephrasing.`);
      }
      const cand = chunk.candidates && chunk.candidates[0];
      if (!cand) return;
      const parts = (cand.content && cand.content.parts) || [];
      for (const p of parts) if (p.text && !p.thought) text += p.text;
      const gm = cand.groundingMetadata;
      if (gm && gm.groundingChunks) {
        for (const g of gm.groundingChunks) {
          if (g.web && g.web.uri && !sources.has(g.web.uri)) sources.set(g.web.uri, g.web.title || g.web.uri);
        }
      }
      if (cand.finishReason) finishReason = cand.finishReason;
      onText && onText(text);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        let json;
        try { json = JSON.parse(data); } catch (_) { continue; }
        handle(json);
      }
    }

    return {
      text,
      finishReason,
      sources: [...sources].map(([uri, title]) => ({ uri, title })),
    };
  }

  /** Lists Gemini models on this key that support generateContent. */
  async function listModels(apiKey) {
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
    if (!res.ok) throw await errorFrom(res);
    const j = await res.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name))
      .map((m) => m.name.replace(/^models\//, ''))
      .sort();
  }

  /** Turns raw API errors into advice a student can act on. */
  function friendly(err) {
    const m = (err && err.message) || String(err);
    if (/API key not valid|API_KEY_INVALID/i.test(m)) return 'Your Gemini API key looks invalid. Open Settings and paste the key again.';
    if (err.status === 429 || /quota|rate/i.test(m)) return 'You hit the free-tier rate limit. Wait a minute and retry, or switch to a lighter model such as gemini-2.5-flash-lite in Settings.';
    if (err.status === 404 || /not found|is not supported/i.test(m)) return `That model isn't available on your key. Open Settings and click "Load my models" to pick one. (${m})`;
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Network error: check your internet connection.';
    return m;
  }

  return { stream, listModels, friendly };
})();
