/* takumi3-rate Best40 - Complete (diagnostic enhanced)
 * - CSV file / paste / hash (#csv= or #k=localStorage key)
 * - Computes single-chart rating and Best40 sum using TAKUMI³ Wiki rating formula
 * - Color-coded difficulties: MASTER=purple, INSANITY=cream, RAVAGE=red
 *
 * Requires: songData.js (loaded before this). If songData is missing or matching fails,
 * the app will still show parsed rows and highlight unmatched charts with diagnostic reasons.
 */

(() => {
  "use strict";

  // -------- Config --------
  const MAX_SCORE = 1_000_000;

  const DIFF_COLORS = {
    MASTER:  "diff-master",
    INSANITY:"diff-insanity",
    RAVAGE:  "diff-ravage",
    OTHER:   "diff-other",
  };

  // -------- Utilities --------
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

  function nfkc(s){ try { return s.normalize("NFKC"); } catch { return String(s ?? ""); } }
  function normSpace(s){ return nfkc(String(s ?? "")).replace(/\u00A0/g," ").replace(/[ \t]+/g," ").trim(); }

  // 1) normTitle() 置き換え（表記揺れ吸収を強化）
  function normTitle(s){
    let t = nfkc(String(s ?? ""));

    // whitespace / invisible
    t = t.replace(/\u00A0/g," ").replace(/\u200B/g,"");
    t = t.replace(/[ \t]+/g," ").trim();

    // quote variants
    t = t.replace(/[’‘]/g,"'").replace(/[“”]/g,'"');

    // punctuation variants
    t = t.replace(/，/g,",");
    t = t.replace(/：/g, ":");                 // 全角コロン→半角
    t = t.replace(/[‐-‒–—―]/g, "-");          // ダッシュ類→-
    t = t.replace(/（/g,"(").replace(/）/g,")");

    // TAKUMI3 / TAKUMI³ 揺れ吸収
    t = t.replace(/TAKUMI3/gi, "TAKUMI³");

    // ありがちな余計な空白
    t = t.replace(/\(\s+/g,"(").replace(/\s+\)/g,")");
    t = t.replace(/\s*-\s*/g,"-");            // " - " → "-"
    t = t.replace(/\s*:\s*/g, ":");           // " : " → ":"

    // "(TAKUMI³Edit/mix)" 系の揺れを統一
    t = t.replace(/\(TAKUMI³\s*Edit\)/gi, "(TAKUMI³Edit)");
    t = t.replace(/\(TAKUMI³\s*mix\)/gi, "(TAKUMI³mix)");

    return t;
  }

  function normDiff(s){
    const t = normSpace(s).toUpperCase();
    if (t === "MAS" || t === "MASTER") return "MASTER";
    if (t === "INS" || t === "INSANITY") return "INSANITY";
    if (t === "RAV" || t === "RAVAGE") return "RAVAGE";
    return t || "OTHER";
  }
  function normLevel(s){ return normSpace(s).toUpperCase(); }

  function toIntScore(s){
    const t = normSpace(s).replace(/,/g,"");
    return /^\d+$/.test(t) ? Number(t) : NaN;
  }
  function formatScore(n){
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString("en-US");
  }
  function formatNum(n, d=3){
    if (!Number.isFinite(n)) return "";
    return n.toFixed(d);
  }

  // 2) 別名辞書（最後の取りこぼし用）
  const TITLE_ALIAS = new Map([
    ["Erwachen(TAKUMI³mix)", "Erwachen(TAKUMI³ mix)"],
    ["Floor of Lava (TAKUMI³ Edit)", "Floor of Lava (TAKUMI³Edit)"],
    ['Get Out of This Endmost Dystøpia(Halv\'s "DISΛSTΣR" Remix)',
     'Get Out of This Endmost Dystøpia (Halv\'s "DISΛSTΣR" Remix)'],
  ]);

  function canonTitle(s){
    const t = normTitle(s);
    return TITLE_ALIAS.get(t) ?? t;
  }

  function parseHashParams(){
    const h = (location.hash || "").replace(/^#/, "");
    return new URLSearchParams(h);
  }

  // -------- CSV parsing (quotes, commas) --------
  function parseCSV(text){
    const src = String(text ?? "").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
    const lines = src.split("\n").filter(l => l.length);
    const out = [];
    for (const line of lines){
      const row = [];
      let cur = "", q = false;
      for (let i=0;i<line.length;i++){
        const c = line[i];
        if (q){
          if (c === '"' && line[i+1] === '"'){ cur += '"'; i++; }
          else if (c === '"'){ q = false; }
          else cur += c;
        } else {
          if (c === '"') q = true;
          else if (c === ','){ row.push(cur); cur=""; }
          else cur += c;
        }
      }
      row.push(cur);
      out.push(row);
    }
    return out;
  }

  function rowsFromCSVText(text){
    const rows = parseCSV(text);
    const parsed = [];
    for (const r of rows){
      if (!r || r.length < 4) continue;

      // 3) CSV側：normTitle → canonTitle
      const title = canonTitle(r[0]);
      const diff  = normDiff(r[1]);
      const level = normLevel(r[2]);
      const score = toIntScore(r[3]);

      if (!title || !Number.isFinite(score)) continue;
      parsed.push({ title, diff, level, score });
    }
    return parsed;
  }

  // -------- songData indexing (robust against schema differences) --------
  function getSongDataArray(){
    const candidates = [
      window.songData,
      window.SONG_DATA,
      window.songs,
      window.SONGS,
      window.takumiSongData,
    ];
    for (const c of candidates){
      if (Array.isArray(c) && c.length) return c;
    }
    if (window.songData && typeof window.songData === "object" && !Array.isArray(window.songData)){
      const vals = Object.values(window.songData);
      if (vals.length && typeof vals[0] === "object") return vals;
    }
    return null;
  }

  function pickField(obj, keys){
    for (const k of keys){
      if (obj && obj[k] != null) return obj[k];
    }
    return null;
  }

  // 4) songData側：normTitle → canonTitle
  // + 診断用に titleMap を追加（曲名はあるがdiff違いの検出）
  function buildChartIndex(){
    const arr = getSongDataArray();
    if (!arr) return {
      map: new Map(),
      titleMap: new Map(),
      issues: ["songData.js が見つかりませんでした（定数突合なしで表示します）"]
    };

    const issues = [];
    const map = new Map();       // title__diff -> []
    const titleMap = new Map();  // title -> [] (diff違い検出)
    let added = 0;

    for (const it of arr){
      if (!it || typeof it !== "object") continue;

      const titleRaw = pickField(it, ["title","name","song","songTitle","music","musicTitle"]);
      const diffRaw  = pickField(it, ["difficulty","diff","chart","type"]);
      const levelRaw = pickField(it, ["level","lv","lvl","diffLevel"]);
      const constRaw = pickField(it, ["constant","const","c","ratingConst","chartConst","ds"]);

      const title = canonTitle(titleRaw);
      if (!title) continue;

      const diff = normDiff(diffRaw);
      const level = levelRaw != null ? normLevel(levelRaw) : "";
      const constant = constRaw != null ? Number(constRaw) : NaN;
      if (!Number.isFinite(constant)) continue;

      const item = { title, diff, level, constant, raw: it };

      const key = `${title}__${diff}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);

      if (!titleMap.has(title)) titleMap.set(title, []);
      titleMap.get(title).push(item);

      added++;
    }

    if (!added) issues.push("songData.js は読み込めていますが、定数フィールドを検出できませんでした（フィールド名が想定外の可能性）");
    return { map, titleMap, issues };
  }

  function matchChart(chartIndex, row){
    const key = `${row.title}__${row.diff}`;
    const candidates = chartIndex.map.get(key);
    if (!candidates || !candidates.length) return null;

    // Prefer exact level match if provided in dataset
    const lv = row.level;
    const exact = candidates.find(c => c.level && normLevel(c.level) === lv);
    if (exact) return exact;

    if (candidates.length === 1) return candidates[0];

    // Heuristic: "14+" -> 14.7
    const plusMap = (s) => {
      const t = normLevel(s);
      if (/^\d+\+$/.test(t)) return Number(t.replace("+",".7"));
      if (/^\d+(\.\d)?$/.test(t)) return Number(t);
      return NaN;
    };
    const want = plusMap(lv);
    if (Number.isFinite(want)){
      let best = null, bestDist = Infinity;
      for (const c of candidates){
        const got = plusMap(c.level);
        if (!Number.isFinite(got)) continue;
        const d = Math.abs(got - want);
        if (d < bestDist){ bestDist = d; best = c; }
      }
      if (best) return best;
    }

    // Fallback: highest constant
    return candidates.slice().sort((a,b)=>b.constant-a.constant)[0];
  }

  // -------- Rating formula (from TAKUMI³ Wiki) --------
  function correctionAAAPlus(score){
    if (score >= 1_000_000) return 2.1;
    if (score >= 999_000) return 2 + (score - 999_000) / 10_000;
    if (score >= 995_000) return 1.5 + (score - 995_000) / 8_000;
    if (score >= 990_000) return 1 + (score - 990_000) / 10_000;
    return (score - 970_000) / 20_000;
  }

  function singleChartRate(constant, score){
    if (!Number.isFinite(constant) || !Number.isFinite(score)) return NaN;
    if (score <= 800_000) return 0;

    if (score < 970_000){
      const corr = (score - 800_000) / 170_000;
      return (constant * corr) / 34;
    }
    const corr = correctionAAAPlus(score);
    return (constant + corr) / 34;
  }

  function scoreForTargetRate(constant, targetRate){
    if (!Number.isFinite(constant) || !Number.isFinite(targetRate)) return null;

    const maxRate = singleChartRate(constant, 1_000_000);
    if (maxRate < targetRate) return null;

    let lo = 0, hi = MAX_SCORE;
    for (let i=0;i<28;i++){
      const mid = (lo + hi) >> 1;
      const r = singleChartRate(constant, mid);
      if (r >= targetRate) hi = mid;
      else lo = mid + 1;
    }
    return hi;
  }

  // -------- Rendering --------
  function setStatus(msg, isErr=false){
    const el = $("#status");
    el.textContent = msg || "";
    el.classList.toggle("err", !!isErr);
  }

  function diffClass(diff){
    if (diff === "MASTER") return DIFF_COLORS.MASTER;
    if (diff === "INSANITY") return DIFF_COLORS.INSANITY;
    if (diff === "RAVAGE") return DIFF_COLORS.RAVAGE;
    return DIFF_COLORS.OTHER;
  }

  function renderTables(state){
    const bestBody = $("#best40Body");
    const candBody = $("#candBody");
    const missBody = $("#missingBody");
    bestBody.innerHTML = "";
    candBody.innerHTML = "";
    missBody.innerHTML = "";

    const makeRow = (x, idx, kind) => {
      const tr = document.createElement("tr");
      tr.className = diffClass(x.diff);
      if (kind === "cand") tr.classList.add("candidate");

      const cells = [
        kind === "best" ? String(idx+1) : String(idx+41),
        x.title,
        x.diff,
        x.level,
        formatScore(x.score),
        Number.isFinite(x.constant) ? x.constant.toFixed(1) : "—",
        Number.isFinite(x.rate) ? x.rate.toFixed(3) : "—",
      ];

      for (const c of cells){
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }

      if (kind === "cand"){
        const tdNeed = document.createElement("td");
        tdNeed.textContent = x.needScore != null ? formatScore(x.needScore) : "—";
        tr.appendChild(tdNeed);
      }
      return tr;
    };

    state.best40.forEach((x,i)=>bestBody.appendChild(makeRow(x,i,"best")));
    state.candidates.forEach((x,i)=>candBody.appendChild(makeRow(x,i,"cand")));

    for (const m of state.missing){
      const tr = document.createElement("tr");
      tr.className = "missing";
      for (const c of [m.title, m.diff, m.level, formatScore(m.score), m.reason]){
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
    $("#borderRate").textContent = border != null ? formatNum(border,3) : "—";
  }

  // -------- Main compute pipeline --------
  function computeFromRows(rows){
    const chartIndex = buildChartIndex();
    const missing = [];
    const matched = [];

    for (const r of rows){
      if (!(r.score > 0)) continue;

      const m = matchChart(chartIndex, r);
      if (!m){
        // 診断：同名はある？（diff違い） or 曲自体がない？
        const sameTitle = chartIndex.titleMap.get(r.title);
        if (sameTitle && sameTitle.length){
          const diffs = [...new Set(sameTitle.map(x => x.diff))].join(", ");
          missing.push({
            ...r,
            reason: `同名はsongDataにあるが難易度が違う/未収録（songData側: ${diffs}）`
          });
        } else {
          missing.push({
            ...r,
            reason: "songDataに曲名自体が無い（wiki.txt生成範囲不足 or 曲名不一致）"
          });
        }
        continue;
      }

      const constant = m.constant;
      const rate = singleChartRate(constant, r.score);
      matched.push({ ...r, constant, rate });
    }

    matched.sort((a,b)=> (b.rate - a.rate) || (b.score - a.score));

    const best40 = matched.slice(0, 40);
    const candidates = matched.slice(40, 60);

    const bestSum = best40.reduce((s,x)=>s + (Number.isFinite(x.rate)?x.rate:0), 0);
    const bestAvg = best40.length ? bestSum / best40.length : 0;

    const borderRate = best40[39]?.rate ?? null;
    if (borderRate != null){
      for (const c of candidates){
        c.needScore = scoreForTargetRate(c.constant, borderRate + 0.00005);
      }
    } else {
      for (const c of candidates) c.needScore = null;
    }

    const issues = chartIndex.issues.slice();
    if (missing.length){
      issues.push(`定数突合できなかった行: ${missing.length} 件（下の「未対応/要修正」に表示）`);
    }

    // 追加：songDataの規模を出す（データ不足が即わかる）
    issues.push(`songData index: title__diff keys=${chartIndex.map.size}, titles=${chartIndex.titleMap.size}`);

    return {
      best40,
      candidates,
      missing,
      playedCount: rows.filter(r=>r.score>0).length,
      matchedCount: matched.length,
      bestSum,
      bestAvg,
      issues,
    };
  }

  // -------- Input handlers --------
  async function handleCSVText(csvText, sourceLabel){
    const rows = rowsFromCSVText(csvText);
    if (!rows.length){
      setStatus("CSVから行を読み取れませんでした（列数/形式を確認してください）", true);
      return;
    }
    const state = computeFromRows(rows);
    renderTables(state);

    setStatus(
      `${sourceLabel}: OK（${rows.length}行 / score>0=${state.playedCount} / 突合=${state.matchedCount}）\n- ` +
      state.issues.join("\n- "),
      false
    );
  }

  async function readFile(file){
    return await file.text();
  }

  function wireUI(){
    const fileInput = $("#csvFile");
    const drop = $("#dropzone");
    const paste = $("#csvPaste");
    const btnPaste = $("#btnParsePaste");
    const btnClear = $("#btnClear");
    const btnCopyBest = $("#btnCopyBestCSV");

    fileInput.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const text = await readFile(f);
      await handleCSVText(text, `ファイル読み込み: ${f.name}`);
    });

    const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };

    ["dragenter","dragover"].forEach(evt => drop.addEventListener(evt, (ev)=>{stop(ev); drop.classList.add("hover");}));
    ["dragleave","drop"].forEach(evt => drop.addEventListener(evt, (ev)=>{stop(ev); drop.classList.remove("hover");}));

    drop.addEventListener("drop", async (ev) => {
      const f = ev.dataTransfer?.files?.[0];
      if (!f) return;
      const text = await readFile(f);
      await handleCSVText(text, `ドラッグ&ドロップ: ${f.name}`);
    });

    btnPaste.addEventListener("click", async () => {
      const t = paste.value || "";
      await handleCSVText(t, "貼り付け");
    });

    btnClear.addEventListener("click", () => {
      paste.value = "";
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

    btnCopyBest.addEventListener("click", async () => {
      const rows = $$("#best40Body tr").map(tr => [...tr.children].map(td => td.textContent));
      if (!rows.length){
        alert("Best40がまだありません");
        return;
      }
      const csv = rows.map(r => {
        const [rank,title,diff,lv,score,constant,rate] = r;
        const vals = [title,diff,lv,score.replace(/,/g,""),constant,rate];
        return vals.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",");
      }).join("\n");
      try{
        await navigator.clipboard.writeText(csv);
        alert("Best40 CSV をコピーしました（title,diff,lv,score,const,rate）");
      }catch{
        alert("コピーできませんでした（ブラウザの制限）。手動で選択してください。");
      }
    });
  }

  // -------- Boot from hash --------
  async function bootFromHash(){
    const p = parseHashParams();

    const k = p.get("k");
    if (k){
      const csv = localStorage.getItem(k);
      if (csv && csv.length){
        await handleCSVText(csv, `hash(k): ${k}`);
        return true;
      } else {
        setStatus(`Best40: localStorage からCSVが見つかりませんでした（key=${k}）`, true);
      }
    }

    const csvParam = p.get("csv");
    if (csvParam){
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
