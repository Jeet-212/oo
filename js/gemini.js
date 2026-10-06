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
    const wait = msg.match(/retry in ([\d.]+)\s*s/i) || msg.match(/"retryDelay":\s*"(\d+)s"/);
    if (wait) err.retryAfter = Math.ceil(parseFloat(wait[1]));
    return err;
  }

  /**
   * Streams a response. Calls onText(fullTextSoFar) as chunks arrive.
   * Resolves to { text, sources: [{title, uri}], finishReason }.
   */
  async function stream({ apiKey, model, system, messages, grounding, temperature, onText, signal, inlineSystem, timeoutMs = 45000 }) {
    // Our own controller, so a stalled connection can be cut off without the caller's Stop button.
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    let timedOut = false;
    let timer = 0;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs); };
    arm();
    try {
      return await streamInner({ apiKey, model, system, messages, grounding, temperature, onText, inlineSystem, signal: ctrl.signal, arm });
    } catch (err) {
      if (timedOut) {
        const e = new Error(`${model} stopped responding.`);
        e.status = 504;
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async function streamInner({ apiKey, model, system, messages, grounding, temperature, onText, inlineSystem, signal, arm }) {
    const url = `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const body = {
      contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { temperature },
    };
    if (inlineSystem) {
      // Some models reject a separate system prompt, so put it at the top of the first message instead.
      const first = body.contents[0];
      if (first) first.parts[0].text = `${system}\n\n---\n\n${first.parts[0].text}`;
    } else {
      body.systemInstruction = { parts: [{ text: system }] };
    }
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
      arm();
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

    if (!text.trim() && finishReason !== 'MAX_TOKENS') {
      // Gemini occasionally "finishes" without writing anything; callers should retry.
      const e = new Error(`${model} returned an empty response${finishReason ? ` (${finishReason})` : ''}.`);
      e.status = 502;
      e.empty = true;
      throw e;
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

  /** True when the model refuses a separate system prompt. */
  function isSystemError(err) {
    return /developer instruction|system instruction|systemInstruction/i.test((err && err.message) || '');
  }

  /** True when the error means this model name can't be used (retired, renamed, not on this key). */
  function isModelError(err) {
    const m = (err && err.message) || '';
    if (/search|grounding|tool/i.test(m) && !/update your code to use/i.test(m)) return false; // a search problem, not the model
    return err.status === 404 || /no longer available|not found|deprecated|retired|update your code to use|model.*not supported|not supported.*model/i.test(m);
  }

  /**
   * Orders a key's models for MUN writing: newest Flash first, then Lite models as backups.
   * Skips specialised models (speech, images, previews) and Pro (no free quota on most keys).
   */
  function rankModels(models) {
    const skip = /tts|image|live|audio|embed|preview|exp|robotics|computer|transcribe|omni|gemma|nano|banana|lyria|antigravity|research|customtools|pro/i;
    const version = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const byVersion = (list) => list.slice().sort((x, y) => version(y) - version(x));
    const ok = models.filter((n) => /^gemini-/.test(n) && /flash/.test(n) && !skip.test(n));
    return [...byVersion(ok.filter((n) => !/lite/.test(n))), ...byVersion(ok.filter((n) => /lite/.test(n)))];
  }

  /** Temporary server-side trouble: worth trying another model or waiting. */
  function isBusy(err) {
    if (!err) return false;
    // A dropped connection (TypeError from fetch) is usually Google or the network hiccuping.
    if (err.name === 'TypeError') return true;
    return [429, 500, 502, 503, 504].includes(err.status) || /overloaded|high demand|unavailable|stopped responding|failed to fetch|network/i.test(err.message || '');
  }

  /** The request failed because of Google Search (quota or not supported), not the model. */
  function isSearchError(err) {
    return err && (err.status === 429 || /search|grounding|tool/i.test(err.message || ''));
  }

  /** Turns raw API errors into advice a student can act on. */
  function friendly(err) {
    const m = (err && err.message) || String(err);
    if (/API key not valid|API_KEY_INVALID/i.test(m)) return 'Your Gemini API key looks invalid. Open Settings and paste the key again.';
    if ([500, 502, 503, 504].includes(err.status) || /high demand|overloaded/i.test(m)) {
      return 'Google\'s Gemini servers are overloaded right now: every model was busy, even after several retries. This is on Google\'s side. Wait a minute and press Regenerate.';
    }
    if (err.status === 429 || /quota|rate/i.test(m)) {
      const wait = err.retryAfter ? `about ${err.retryAfter} seconds` : 'a minute';
      return `You hit Google's free-tier limit (it resets every minute, with a separate daily cap). Wait ${wait} and press Regenerate. Tips: choose "Standard" or "Quick brief" depth, and avoid sending several requests back to back.`;
    }
    if (isModelError(err)) return `That model isn't available on your key. Open Settings, click "Load my models", and pick one from the Model box. (${m})`;
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Network error: check your internet connection.';
    return m;
  }

  return { stream, listModels, friendly, isModelError, isSystemError, isBusy, isSearchError, rankModels };
})();
