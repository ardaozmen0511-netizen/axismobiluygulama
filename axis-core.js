/* AXIS mobil çekirdek: öğretmen yardımcısı ajanı + telefonda saklanan hafıza.
   Öğrenci AXIS hesabıyla giriş yapar; mesajlar AXIS sunucusuna gider, sunucu planı
   (AXIS 1.0 ücretsiz / AXIS 1.2 ücretli) ve günlük limiti kontrol edip Claude'a iletir.
   Sunucunun adresi: index.html'deki window.AXIS_API (boşsa uygulamayı sunan adres). */
(function (root) {
  "use strict";

  const COURSES = ["Python", "C", "C++", "Arduino/ESP32"];
  const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

  // ---------- Telefonda saklama ----------
  function store() {
    try { const s = root.localStorage; s.setItem("__t", "1"); s.removeItem("__t"); return s; }
    catch (e) { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; }
  }
  const S = store();
  const get = (k, d) => { try { const v = S.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const set = (k, v) => { try { S.setItem(k, JSON.stringify(v)); } catch (e) {} };

  function deviceId() {
    let id = get("axis_device", null);
    if (!id || !/^axis-[0-9a-f]{32}$/.test(id)) {
      const b = new Uint8Array(16);
      (root.crypto || globalThis.crypto).getRandomValues(b);
      id = "axis-" + Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
      set("axis_device", id);
    }
    return id;
  }

  const API = () => String(root.AXIS_API || "").replace(/\/$/, "");

  const state = {
    get course() { return get("axis_course", "Python"); },
    set course(c) { if (COURSES.includes(c)) set("axis_course", c); },
    get name() { return get("axis_name", ""); },
    set name(n) { set("axis_name", String(n || "").trim().slice(0, 40)); },
    get token() { return get("axis_token", ""); },
    get me() { return get("axis_me", null); },     // {email, name, plan, label, limit, used, remaining, pro_until}
    get facts() { return get("axis_facts", []); },
    get notes() { return get("axis_notes", []); },
    get log() { return get("axis_log", []); },   // ekranda görünen: {kind: user|axis|tool|err, text}
  };

  function addLog(kind, text, code) {
    const log = state.log;
    log.push(code ? { kind, text, code, t: Date.now() } : { kind, text, t: Date.now() });
    set("axis_log", log.slice(-200));
  }

  // ---------- Hafıza araçları (telefonda çalışır) ----------
  const TOOLS = [
    { name: "remember", description: "Öğrenci hakkında kalıcı ve işe yarar bir bilgiyi kaydeder: seviyesi, zorlandığı veya iyi olduğu konular, projesi, tercihleri. Kısa tek cümle yaz.",
      input_schema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] } },
    { name: "forget", description: "Öğrenci isterse veya bilgi artık doğru değilse, içinde bu metin geçen bilgileri siler.",
      input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    { name: "add_note", description: "Öğrenci için çalışılacak bir konu, hatırlatma veya alıştırma kaydeder.",
      input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    { name: "complete_note", description: "Yapılan veya artık gerekmeyen bir notu siler (notun içinden bir parça yaz).",
      input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  ];
  const WEB_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 3 };
  let webOk = true;

  const FUNCS = {
    remember({ fact }) {
      const f = state.facts;
      if (!f.some(x => x.toLowerCase() === String(fact).toLowerCase())) f.push(String(fact));
      set("axis_facts", f); return "Hafızaya kaydedildi.";
    },
    forget({ text }) {
      const f = state.facts, n = f.filter(x => !x.toLowerCase().includes(String(text).toLowerCase()));
      set("axis_facts", n); return n.length < f.length ? `${f.length - n.length} bilgi unutuldu.` : "Böyle bir bilgi bulunamadı.";
    },
    add_note({ text }) {
      const n = state.notes, d = new Date();
      n.push({ text: String(text), t: `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}` });
      set("axis_notes", n); return "Not alındı.";
    },
    complete_note({ text }) {
      const n = state.notes, k = n.filter(x => !x.text.toLowerCase().includes(String(text).toLowerCase()));
      set("axis_notes", k); return k.length < n.length ? "Not silindi." : "Böyle bir not bulunamadı.";
    },
  };

  function forgetExact(fact) { set("axis_facts", state.facts.filter(f => f !== fact)); }
  function noteDone(text) { set("axis_notes", state.notes.filter(n => n.text !== text)); }

  // ---------- Talimat ----------
  function systemPrompt() {
    const now = new Date(), course = state.course, name = state.name || "öğrenci";
    const facts = state.facts.map(f => "- " + f).join("\n") || "(henüz bir şey bilmiyorsun)";
    const notes = state.notes.map(n => `- [${n.t}] ${n.text}`).join("\n") || "(yok)";
    return [
      "Sen AXIS'sin (AlreonX Intelligent System): AlreonX'in kodlama kurslarında öğrencilere yardım eden yapay zekâ öğretmen yardımcısısın. AlreonX; Python, C, C++ ve Arduino/ESP32 dersleri veriyor, öğrencilerin çoğu yeni başlayan. Genel amaçlı bir asistan değilsin; sabırlı, samimi ve cesaretlendirici bir hoca yardımcısısın. Türkçe konuş.",
      "Öğrenci seninle TELEFONDAN yazışıyor: cevaplarını kısa paragraflarla ver, kod örneklerini kısa tut (telefon ekranına sığsın), uzun tablolardan kaçın.",
      `Öğrencinin şu an çalıştığı kurs: **${course}**. Aksi belirtilmedikçe cevaplarını bu kursa göre ver.`,
      "ÖĞRETİM KURALLARIN:\n1. ÖNCE İPUCU: Öğrenci hatalı kod, ödev veya takıldığı bir problem getirdiğinde hazır çözümü hemen verme. Sorunun nerede olduğunu sezdiren kısa bir ipucu ver ve düşünmesini sağlayacak bir soru sor.\n2. Öğrenci yine takılırsa daha belirgin bir ipucu ver (hangi satır, hangi kavram).\n3. Öğrenci 'çözümü göster' derse ya da iki ipucundan sonra hâlâ takılıyorsa düzeltilmiş kodu ver ve her değişikliği kısaca açıkla; sonunda küçük bir alıştırma öner.\n4. Kavram sorularında ipucu kuralı yoktur: doğrudan, basit ve kısa bir örnekle anlat.\n5. Hata mesajlarını Türkçeye çevir, ne anlama geldiğini ve genelde neden çıktığını açıkla.\n6. Arduino/ESP32'de pin bağlantılarını adım adım yaz; direnç, 3.3V/5V farkı ve kısa devre konusunda uyar.\n7. Kod bloklarında dil etiketi kullan (```python, ```c, ```cpp).\n8. Ödevi baştan sona yazıp verme; adım adım götür.\n9. Kodlama ve elektronik dışı sorulara kısaca cevap ver ama nazikçe derse dön.\n10. Öğrencinin seviyesi veya zorlandığı konular hakkında kalıcı bir şey öğrenirsen 'remember' ile kaydet.",
      (state.me && state.me.web ? "Güncel belge veya kütüphane bilgisi gerekirse internette arama yapabilirsin. " : "İnternette arama yapamazsın; bilmediğin güncel bir bilgi sorulursa bunu açıkça söyle. ") + "Telefonda kod çalıştıramazsın; kodu satır satır açıklayarak yardım et. Cevaplarını kısa ve öz tut.",
      `Şu an: ${DAYS[now.getDay()]}, ${now.toLocaleString("tr-TR")}`,
      `Öğrenci (${name}) hakkında bildiklerin:\n${facts}`,
      `Çalışılacaklar / notlar:\n${notes}`,
    ].join("\n\n");
  }

  // ---------- Konuşma geçmişi ----------
  let history = null;   // bu oturumdaki API mesajları
  const btype = b => (b && b.type) || null;

  function historyFromLog(limit = 20) {
    const log = state.log;
    let start = 0;
    log.forEach((e, i) => { if (e.kind === "reset") start = i + 1; });
    const msgs = [];
    for (const e of log.slice(start)) {
      const role = e.kind === "user" ? "user" : e.kind === "axis" ? "assistant" : null;
      if (!role || !String(e.text).trim()) continue;
      if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n\n" + e.text;
      else msgs.push({ role, content: e.text });
    }
    let m = msgs.slice(-limit);
    while (m.length && m[0].role !== "user") m.shift();
    if (m.length && m[m.length - 1].role === "user") m.pop();
    return m;
  }

  function dropOldThinking(h) {
    for (const msg of h) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      const kept = msg.content.filter(b => !["thinking", "redacted_thinking"].includes(btype(b)));
      if (kept.length !== msg.content.length) msg.content = kept.length ? kept : [{ type: "text", text: "..." }];
    }
  }

  function reset() { history = []; addLog("reset", ""); }

  // ---------- Hesap ----------
  async function call(path, body, auth) {
    let r;
    try {
      r = await fetch(API() + path, {
        method: body ? "POST" : "GET",
        headers: Object.assign({ "content-type": "application/json" }, auth ? { "x-api-key": state.token } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new Error("AXIS sunucusuna ulaşılamadı. İnternet bağlantını kontrol et."); }
    let data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) {
      const er = new Error((data && data.error && data.error.message) || `Sunucu hatası (${r.status}).`);
      er.status = r.status; er.code = data && data.error && data.error.code;
      throw er;
    }
    return data;
  }
  function saveSession(d) { set("axis_token", d.token); set("axis_me", d.me); if (d.me && d.me.name && !state.name) state.name = d.me.name; }
  async function register(f) { saveSession(await call("/api/register", f)); }
  async function login(email, password) { saveSession(await call("/api/login", { email, password })); }
  async function logout() {
    try { await call("/api/logout", {}, true); } catch (e) {}
    S.removeItem("axis_token"); S.removeItem("axis_me");
  }
  async function refreshMe() {
    if (!state.token) return null;
    try { const me = await call("/api/me", null, true); set("axis_me", me); return me; }
    catch (e) { if (e.status === 401) { S.removeItem("axis_token"); S.removeItem("axis_me"); } throw e; }
  }
  const plans = () => call("/api/plans");

  // ---------- Ana döngü ----------
  let busy = false;
  async function send(userText, opts = {}) {
    const base = (opts.base || "").replace(/\/$/, "");
    const onStep = opts.onStep || (() => {});
    if (busy) throw new Error("AXIS hâlâ düşünüyor.");
    busy = true;
    if (history === null) history = historyFromLog();
    const start = history.length;
    try {
      dropOldThinking(history);
      const system = systemPrompt();
      history.push({ role: "user", content: userText });
      addLog("user", userText); onStep();
      let resp = null;
      for (let step = 0; step < 10; step++) {
        const me = state.me;
        const web = webOk && me && me.web;
        const body = { model: "axis", system, messages: history, tools: TOOLS.concat(web ? [WEB_TOOL] : []), max_tokens: 2048 };
        const headers = { "content-type": "application/json", "x-api-key": state.token, "anthropic-version": "2023-06-01" };
        const r = await fetch((base || API()) + "/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
        let data = null;
        try { data = await r.json(); } catch (e) {}
        const rem = r.headers.get("x-axis-remaining");
        if (rem !== null && me) { me.remaining = Number(rem); me.used = me.limit - me.remaining; set("axis_me", me); }
        if (!r.ok) {
          const er = new Error((data && data.error && data.error.message) || `Sunucu hatası (${r.status}).`);
          er.code = (data && data.error && data.error.code) || (r.status === 401 ? "login" : "");
          if (r.status === 401) { S.removeItem("axis_token"); }
          if (r.status === 400 && webOk && /web_search/i.test(er.message)) { webOk = false; continue; }
          throw er;
        }
        resp = data;
        history.push({ role: "assistant", content: resp.content });
        for (const b of resp.content) {
          if (b.type === "server_tool_use") { addLog("tool", "🔎 İnternette arandı: " + ((b.input && b.input.query) || "")); onStep(); }
        }
        if (resp.stop_reason === "pause_turn") continue;
        if (resp.stop_reason !== "tool_use") break;
        const results = [];
        for (const b of resp.content) {
          if (b.type !== "tool_use") continue;
          let out;
          try { out = FUNCS[b.name] ? FUNCS[b.name](b.input || {}) : "Bilinmeyen araç."; } catch (e) { out = "Hata: " + e.message; }
          const label = { remember: "🧠 Hafızaya kaydetti: ", forget: "🧹 Unuttu: ", add_note: "📝 Not aldı: ", complete_note: "✅ Notu tamamladı: " }[b.name] || "• ";
          addLog("tool", label + ((b.input && (b.input.fact || b.input.text)) || ""));
          results.push({ type: "tool_result", tool_use_id: b.id, content: out });
          onStep();
        }
        history.push({ role: "user", content: results });
      }
      const text = (resp ? resp.content : []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      addLog("axis", text || "…");
      return text;
    } catch (e) {
      history.splice(start);                       // yarım kalan turu geri al
      const msg = /Failed to fetch|NetworkError|fetch failed|Load failed/i.test(e.message) ? "AXIS sunucusuna ulaşılamadı. İnternet bağlantını kontrol et." : e.message;
      addLog("err", msg, e.code);
      const er = new Error(msg); er.code = e.code; throw er;
    } finally {
      busy = false; onStep();
    }
  }

  root.AXIS = { COURSES, state, send, reset, forgetExact, noteDone, deviceId, register, login, logout, refreshMe, plans, _systemPrompt: systemPrompt, _historyFromLog: historyFromLog, get busy() { return busy; } };
})(typeof window !== "undefined" ? window : globalThis);
