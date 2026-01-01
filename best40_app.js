/* takumi3-rate Best40 - best40_app.js (Complete)
 * - CSV file / paste / hash (#csv= or #k=localStorage key)
 * - Computes single-chart rating and Best40 sum using TAKUMI³ Wiki rating formula
 * - Color-coded difficulties: MASTER=purple, INSANITY=cream, RAVAGE=red
 *
 * Requires: songData.js (loaded before this).
 *   songData.js should export: window.songData = [{title, difficulty, constant, (optional) level}, ...]
 */

(() => {
  "use strict";

  // -------- Config --------
  const LS_PREFIX = "takumi3_csv_";
  const MAX_SCORE = 1_000_000;

  // 表示グルーピング（並び）
  const DIFF_ORDER = ["RAVAGE", "INSANITY", "MASTER", "HARD", "OTHER"];

  // 行の色（CSS側で .diff-master 等を用意）
  const DIFF_COLORS = {
    MASTER: "diff-master",
    INSANITY: "diff-insanity",
    RAVAGE: "diff-ravage",
    HARD: "diff-hard",
    OTHER: "diff-other",
  };

  // -------- 別名辞書（最後の取りこぼし用）--------
  // キー: CSV等で出てくる表記（canonTitle後の文字列）
  // 値 : songData.js 側の正式表記（canonTitle後の文字列）
  // ※ 未対応リストに出てきたら、ここへ足していけばOK
  const TITLE_ALIAS = {
    // punctuation / colon variants
    "Connection Destination:Utopia": "Connection Destination：Utopia",
    "Connection Destination :Utopia": "Connection Destination：Utopia",
    "Connection Destination: Utopia": "Connection Destination：Utopia",
    "Connection Destination : Utopia": "Connection Destination：Utopia",

    // TAKUMI3 -> TAKUMI³ / mix / edit variants
    "Erwachen(TAKUMI3mix)": "Erwachen(TAKUMI³mix)",
    "Erwachen (TAKUMI3mix)": "Erwachen(TAKUMI³mix)",
    "Floor of Lava (TAKUMI3 Edit)": "Floor of Lava (TAKUMI³Edit)",
    "Floor of Lava(TAKUMI3 Edit)": "Floor of Lava (TAKUMI³Edit)",
    "Floor of Lava(TAKUMI3Edit)": "Floor of Lava (TAKUMI³Edit)",

    // plus/space variants
    "ZEUS+666": "ZEUS 666",
    "ZEUS + 666": "ZEUS 666",

    // normalize some common punctuation in titles
    "Cipher:/2&//<10": "Cipher:/2&//<10", // 念のため（CSVが崩れることがある）
  };

  // -------- Utilities --------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function nfkc(s) {
    try {
      return String(s ?? "").normalize("NFKC");
    } catch {
      return String(s ?? "");
    }
  }
  function normSpace(s) {
    return nfkc(String(s ?? ""))
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  // ★ ここが要：曲名の正規化（表記揺れ吸収）
  function canonTitle(s) {
    s = nfkc(String(s ?? ""));
    s = s.replace(/\u00A0/g, " ").replace(/\u200B/g, "");
    s = s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
    s = s.replace(/[‐-‒–—―]/g, "-");
    s = s.replace(/：/g, ":");
    s = s.replace(/[（）]/g, (m) => (m === "（" ? "(" : ")"));
    s = s.replace(/\s+/g, " ").trim();

    // TAKUMI表記
    s = s.replace(/TAKUMI3/gi, "TAKUMI³");

    // 記号周りのスペース
    s = s.replace(/\s*-\s*/g, "-");
    s = s.replace(/\s*:\s*/g, ":");

    // よくある Edit / mix
    s = s.replace(/\(TAKUMI³\s*Edit\)/i, "(TAKUMI³Edit)");
    s = s.replace(/\(TAKUMI³\s*mix\)/i, "(TAKUMI³mix)");

    // alias適用（canon後の完全一致で変換）
    if (TITLE_ALIAS[s]) s = TITLE_ALIAS[s];

    return s;
  }

  function canonDiff(s) {
    const t = normSpace(s).toUpperCase();
    if (t === "MAS" || t === "MASTER") return "MASTER";
    if (t === "INS" || t === "INSANITY") return "INSANITY";
    if (t === "RAV" || t === "RAVAGE") return "RAVAGE";
    if (t === "HARD") return "HARD";
    return t || "OTHER";
  }

  function canonLevel(s) {
    return normSpace(s).toUpperCase();
  }

  function toIntScore(s) {
    const t = normSpace(s).replace(/,/g, "");
    const m = t.match(/^\d+$/);
    return m ? Number(t) : NaN;
  }

  function formatScore(n) {
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString("en-US");
  }

  function formatNum(n, d = 3) {
    if (!Number.isFinite(n)) return "";
    return n.toFixed(d);
  }

  function parseHashParams() {
    const h = (location.hash || "").replace(/^#/, "");
    return new URLSearchParams(h);
  }

  // -------- CSV parsing (quotes, commas) --------
  function parseCSV(text) {
    const src = String(text ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = src.split("\n").filter((l) => l.length);
    const out = [];
    for (const line of lines) {
      const row = [];
      let cur = "",
        q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
          if (c === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (c === '"') {
            q = false;
          } else cur += c;
        } else {
          if (c === '"') q = true;
          else if (c === ",") {
            row.push(cur);
            cur = "";
          } else cur += c;
        }
      }
      row.push(cur);
      out.push(row);
    }
    return out;
  }

  function rowsFromCSVText(text) {
    const rows = parseCSV(text);
    // Expect 4 columns: title, difficulty, level, score
    const parsed = [];
    for (const r of rows) {
      if (!r || r.length < 4) continue;

      // ★ ここ：CSV側は canonTitle を使用
      const title = canonTitle(r[0]);
      const diff = canonDiff(r[1]);
      const level = canonLevel(r[2]);
      const score = toIntScore(r[3]);

      if (!title || !Number.isFinite(score)) continue;
      parsed.push({ title, diff, level, score });
    }
    return parsed;
  }

  // -------- songData indexing --------
  function pickField(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] != null) return obj[k];
    }
    return null;
  }

  function getSongDataArray() {
    // we want window.songData to be an array of objects
    const c = window.songData;
    if (Array.isArray(c) && c.length) return c;

    // fallback: sometimes exported as object -> values
    if (c && typeof c === "object" && !Array.isArray(c)) {
      const vals = Object.values(c);
      if (vals.length && typeof vals[0] === "object") return vals;
    }
    return null;
  }

  function buildChartIndex() {
    const arr = getSongDataArray();
    if (!arr) {
      return {
        map: new Map(),
        issues: [
          "songData.js が見つかりませんでした（定数突合なしで表示します）",
        ],
      };
    }

    const issues = [];
    const map = new Map();
    let added = 0;

    for (const it of arr) {
      if (!it || typeof it !== "object") continue;

      const titleRaw = pickField(it, [
        "title",
        "name",
        "song",
        "songTitle",
        "music",
        "musicTitle",
      ]);
      const diffRaw = pickField(it, ["difficulty", "diff", "chart", "type"]);
      const levelRaw = pickField(it, ["level", "lv", "lvl", "diffLevel"]);
      const constRaw = pickField(it, [
        "constant",
        "const",
        "c",
        "ratingConst",
        "chartConst",
        "ds",
      ]);

      // ★ ここ：songData側も canonTitle を使用
      const title = canonTitle(titleRaw);
      if (!title) continue;

      const diff = canonDiff(diffRaw);
      const level = levelRaw != null ? canonLevel(levelRaw) : "";
      const constant = constRaw != null ? Number(constRaw) : NaN;

      if (!Number.isFinite(constant)) continue;

      const key = `${title}__${diff}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ title, diff, level, constant, raw: it });
      added++;
    }

    if (!added) {
      issues.push(
        "songData.js は読み込めていますが、定数フィールドを検出できませんでした（フィールド名が想定外の可能性）"
      );
    }

    return { map, issues };
  }

  function matchChart(chartIndex, row) {
    const key = `${row.title}__${row.diff}`;
    const candidates = chartIndex.map.get(key);
    if (!candidates || !candidates.length) return null;

    // Prefer exact level match if provided in dataset
    const lv = row.level;
    const exact = candidates.find(
      (c) => c.level && canonLevel(c.level) === lv
    );
    if (exact) return exact;

    if (candidates.length === 1) return candidates[0];

    // Heuristic: map 14+ -> 14.7
    const plusMap = (s) => {
      const t = canonLevel(s);
      if (/^\d+\+$/.test(t)) return Number(t.replace("+", ".7"));
      if (/^\d+(\.\d)?$/.test(t)) return Number(t);
      return NaN;
    };

    const want = plusMap(lv);
    if (Number.isFinite(want)) {
      let best = null,
        bestDist = Infinity;
      for (const c of candidates) {
        const got = plusMap(c.level);
        if (!Number.isFinite(got)) continue;
        const d = Math.abs(got - want);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (best) return best;
    }

    // Fallback: choose highest constant
    return candidates.slice().sort((a, b) => b.constant - a.constant)[0];
  }

  // -------- Rating formula (TAKUMI³ Wiki style) --------
  function correctionAAAPlus(score) {
    if (score >= 1_000_000) return 2.1;
    if (score >= 999_000) return 2 + (score - 999_000) / 10_000;
    if (score >= 995_000) return 1.5 + (score - 995_000) / 8_000;
    if (score >= 990_000) return 1 + (score - 990_000) / 10_000;
    return (score - 970_000) / 20_000;
  }

  function singleChartRate(constant, score) {
    if (!Number.isFinite(constant) || !Number.isFinite(score)) return NaN;
    if (score <= 800_000) return 0;

    if (score < 970_000) {
      const corr = (score - 800_000) / 170_000; // 970k => 1
      return (constant * corr) / 34;
    }
    const corr = correctionAAAPlus(score);
    return (constant + corr) / 34;
  }

  function scoreForTargetRate(constant, targetRate) {
    if (!Number.isFinite(constant) || !Number.isFinite(targetRate)) return null;

    const maxRate = singleChartRate(constant, 1_000_000);
    if (maxRate < targetRate) return null;

    let lo = 0,
      hi = MAX_SCORE;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) >> 1;
      const r = singleChartRate(constant, mid);
      if (r >= targetRate) hi = mid;
      else lo = mid + 1;
    }
    return hi;
  }

  // -------- Rendering --------
  function setStatus(msg, isErr = false) {
    const el = $("#status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("err", !!isErr);
  }

  function diffClass(diff) {
    if (diff === "MASTER") return DIFF_COLORS.MASTER;
    if (diff === "INSANITY") return DIFF_COLORS.INSANITY;
    if (diff === "RAVAGE") return DIFF_COLORS.RAVAGE;
    if (diff === "HARD") return DIFF_COLORS.HARD;
    return DIFF_COLORS.OTHER;
  }

  function renderTables(state) {
    const bestBody = $("#best40Body");
    const candBody = $("#candBody");
    const missBody = $("#missingBody");
    if (!bestBody || !candBody || !missBody) return;

    bestBody.innerHTML = "";
    candBody.innerHTML = "";
    missBody.innerHTML = "";

    const makeRow = (x, idx, kind) => {
      const tr = document.createElement("tr");
      tr.className = diffClass(x.diff);
      if (kind === "cand") tr.classList.add("candidate");

      const cells = [
        kind === "best" ? String(idx + 1) : String(idx + 41),
        x.title,
        x.diff,
        x.level,
        formatScore(x.score),
        Number.isFinite(x.constant) ? x.constant.toFixed(1) : "—",
        Number.isFinite(x.rate) ? x.rate.toFixed(3) : "—",
      ];

      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }

      if (kind === "cand") {
        const tdNeed = document.createElement("td");
        tdNeed.textContent =
          x.needScore != null ? formatScore(x.needScore) : "—";
        tr.appendChild(tdNeed);
      }

      return tr;
    };

    state.best40.forEach((x, i) => bestBody.appendChild(makeRow(x, i, "best")));
    state.candidates.forEach((x, i) =>
      candBody.appendChild(makeRow(x, i, "cand"))
    );

    for (const m of state.missing) {
      const tr = document.createElement("tr");
      tr.className = "missing";
      for (const c of [
        m.title,
        m.diff,
        m.level,
        formatScore(m.score),
        m.reason,
      ]) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }
      missBody.appendChild(tr);
    }

    $("#playedCount").textContent = String(state.playedCount);
    $("#matchedCount").textContent = String(state.matchedCount);
    $("#rateSum").textContent = formatNum(state.bestSum, 3);
    $("#rateAvg").textContent = formatNum(state.bestAvg, 3);

    const border = state.best40[39]?.rate;
    $("#borderRate").textContent =
      border != null ? formatNum(border, 3) : "—";
  }

  // -------- Main compute pipeline --------
  function computeFromRows(rows) {
    const chartIndex = buildChartIndex();
    const missing = [];
    const matched = [];

    for (const r of rows) {
      if (!(r.score > 0)) continue; // played only
      const m = matchChart(chartIndex, r);
      if (!m) {
        missing.push({
          ...r,
          reason:
            "songDataに該当譜面なし（曲名/難易度の表記揺れ or 定数未収録）",
        });
        continue;
      }
      const constant = m.constant;
      const rate = singleChartRate(constant, r.score);
      matched.push({ ...r, constant, rate });
    }

    matched.sort((a, b) => b.rate - a.rate || b.score - a.score);

    const best40 = matched.slice(0, 40);
    const candidates = matched.slice(40, 60);

    const bestSum = best40.reduce(
      (s, x) => s + (Number.isFinite(x.rate) ? x.rate : 0),
      0
    );
    const bestAvg = best40.length ? bestSum / best40.length : 0;

    const borderRate = best40[39]?.rate ?? null;
    if (borderRate != null) {
      for (const c of candidates) {
        c.needScore = scoreForTargetRate(c.constant, borderRate + 0.00005);
      }
    } else {
      for (const c of candidates) c.needScore = null;
    }

    const issues = chartIndex.issues.slice();
    if (missing.length) {
      issues.push(
        `定数突合できなかった行: ${missing.length} 件（下の「未対応/要修正」に表示）`
      );
    }

    return {
      best40,
      candidates,
      missing,
      playedCount: rows.filter((r) => r.score > 0).length,
      matchedCount: matched.length,
      bestSum,
      bestAvg,
      issues,
    };
  }

  // -------- Input handlers --------
  async function handleCSVText(csvText, sourceLabel) {
    const rows = rowsFromCSVText(csvText);
    if (!rows.length) {
      setStatus("CSVから行を読み取れませんでした（列数/形式を確認してください）", true);
      return;
    }

    const state = computeFromRows(rows);
    renderTables(state);

    if (state.issues.length) {
      setStatus(
        `${sourceLabel}: OK（${rows.length}行 / score>0=${state.playedCount} / 突合=${state.matchedCount}）\n- ` +
          state.issues.join("\n- "),
        false
      );
    } else {
      setStatus(
        `${sourceLabel}: OK（${rows.length}行 / score>0=${state.playedCount} / 突合=${state.matchedCount}）`,
        false
      );
    }
  }

  async function readFile(file) {
    return await file.text();
  }

  function wireUI() {
    const fileInput = $("#csvFile");
    const drop = $("#dropzone");
    const paste = $("#csvPaste");
    const btnPaste = $("#btnParsePaste");
    const btnClear = $("#btnClear");
    const btnCopyBest = $("#btnCopyBestCSV");

    fileInput?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const text = await readFile(f);
      await handleCSVText(text, `ファイル読み込み: ${f.name}`);
    });

    const stop = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    };

    ["dragenter", "dragover"].forEach((evt) =>
      drop?.addEventListener(evt, (ev) => {
        stop(ev);
        drop.classList.add("hover");
      })
    );
    ["dragleave", "drop"].forEach((evt) =>
      drop?.addEventListener(evt, (ev) => {
        stop(ev);
        drop.classList.remove("hover");
      })
    );

    drop?.addEventListener("drop", async (ev) => {
      const f = ev.dataTransfer?.files?.[0];
      if (!f) return;
      const text = await readFile(f);
      await handleCSVText(text, `ドラッグ&ドロップ: ${f.name}`);
    });

    btnPaste?.addEventListener("click", async () => {
      const t = paste?.value || "";
      await handleCSVText(t, "貼り付け");
    });

    btnClear?.addEventListener("click", () => {
      if (paste) paste.value = "";
      setStatus("");
      $("#best40Body").innerHTML = "";
      $("#candBody").innerHTML = "";
      $("#missingBody").innerHTML = "";
      $("#playedCount").textContent = "0";
      $("#matchedCount").textContent = "0";
      $("#rateSum").textContent = "—";
      $("#rateAvg").textContent = "—";
      $("#borderRate").textContent = "—";
    });

    btnCopyBest?.addEventListener("click", async () => {
      const rows = $$("#best40Body tr").map((tr) =>
        [...tr.children].map((td) => td.textContent)
      );
      if (!rows.length) {
        alert("Best40がまだありません");
        return;
      }
      // CSV: title,diff,level,score,constant,rate
      const csv = rows
        .map((r) => {
          const [, title, diff, lv, score, constant, rate] = r;
          const vals = [
            title,
            diff,
            lv,
            score.replace(/,/g, ""),
            constant,
            rate,
          ];
          return vals
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",");
        })
        .join("\n");
      try {
        await navigator.clipboard.writeText(csv);
        alert("Best40 CSV をコピーしました（title,diff,lv,score,const,rate）");
      } catch {
        alert("コピーできませんでした（ブラウザの制限）。手動で選択してください。");
      }
    });
  }

  // -------- Boot from hash --------
  async function bootFromHash() {
    const p = parseHashParams();

    const k = p.get("k");
    if (k) {
      const csv = localStorage.getItem(k);
      if (csv && csv.length) {
        await handleCSVText(csv, `hash(k): ${k}`);
        return true;
      } else {
        setStatus(`Best40: localStorage からCSVが見つかりませんでした（key=${k}）`, true);
      }
    }

    const csvParam = p.get("csv");
    if (csvParam) {
      const csv = decodeURIComponent(csvParam);
      await handleCSVText(csv, "hash(csv)");
      return true;
    }
    return false;
  }

  // -------- Init --------
  window.addEventListener("DOMContentLoaded", async () => {
    wireUI();
    await bootFromHash();
  });
})();
