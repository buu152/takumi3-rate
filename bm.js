(() => {
  const DEST = "https://buu152.github.io/takumi3-rate/best40.html";

  const overlay = (msg, err = false) => {
    const id = "__takumi_bm_overlay__";
    let box = document.getElementById(id);
    if (!box) {
      box = document.createElement("div");
      box.id = id;
      box.style.cssText =
        "position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:999999;max-width:min(92vw,860px);padding:14px 16px;border-radius:16px;color:#fff;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.45);";
      document.body.appendChild(box);
    }
    box.style.background = err ? "#b91c1c" : "#111827";
    box.innerHTML = "";
    const p = document.createElement("div");
    p.textContent = msg;
    p.style.whiteSpace = "pre-wrap";
    box.appendChild(p);
    return box;
  };

  const norm = (s) =>
    String(s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  const isScore = (s) => /^\d{1,7}$/.test(String(s).replace(/,/g, ""));
  const toScore = (s) => Number(String(s).replace(/,/g, ""));

  const isDiff = (s) => /MASTER|INSANITY|RAVAGE/.test(String(s ?? "").toUpperCase());
  const normDiff = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, "").trim();

  const isLevelLike = (s) => /^\d{1,2}(\.\d)?\+?$/.test(String(s ?? "").trim());

  const escapeCSV = (s) => '"' + String(s ?? "").replaceAll('"', '""') + '"';

  const tryAutoSelect = () => {
    const sel = window.getSelection?.();
    if (!sel) return false;

    const tables = [...document.querySelectorAll("table")];
    if (tables.length) {
      tables.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length);
      const t = tables[0];
      const range = document.createRange();
      range.selectNodeContents(t);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }

    const big = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 320 || r.height < 240) return false;
        const tx = el.innerText || "";
        return /MASTER|INSANITY|RAVAGE/.test(tx);
      })
      .sort((a, b) => (b.innerText || "").length - (a.innerText || "").length);

    if (big.length) {
      const range = document.createRange();
      range.selectNodeContents(big[0]);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }

    try {
      const range = document.createRange();
      range.selectNodeContents(document.body);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch {
      return false;
    }
  };

  const getSelectedText = () => {
    const sel = window.getSelection?.();
    return (sel ? sel.toString() : "").replace(/\r/g, "").trim();
  };

  const parseLines = (text) => {
    const lines = text.split("\n").map(norm).filter(Boolean);
    const parsed = [];

    for (const line of lines) {
      let parts = line.includes("\t")
        ? line.split("\t").map(norm).filter(Boolean)
        : line.split(/\s+/).map(norm).filter(Boolean);

      if (parts.length < 3) continue;

      let scoreIdx = -1;
      for (let i = parts.length - 1; i >= 0; i--) {
        const sc = parts[i].replace(/,/g, "");
        if (isScore(sc)) { scoreIdx = i; break; }
      }
      if (scoreIdx < 0) continue;
      const score = toScore(parts[scoreIdx]);

      let diffIdx = -1;
      for (let i = scoreIdx - 1; i >= 0; i--) {
        if (isDiff(parts[i])) { diffIdx = i; break; }
      }
      if (diffIdx < 0) continue;
      const diff = normDiff(parts[diffIdx]);

      let lvIdx = -1;
      for (let i = diffIdx + 1; i < scoreIdx; i++) {
        if (isLevelLike(parts[i])) { lvIdx = i; break; }
      }
      if (lvIdx < 0) {
        for (let i = diffIdx - 1; i >= 0; i--) {
          if (isLevelLike(parts[i])) { lvIdx = i; break; }
        }
      }
      const lv = lvIdx >= 0 ? parts[lvIdx] : "";

      const cut = Math.min(diffIdx, lvIdx >= 0 && lvIdx < diffIdx ? lvIdx : diffIdx);
      const title = parts.slice(0, cut).join(" ").trim();
      if (!title) continue;

      parsed.push({ title, diff, lv, score });
    }

    return parsed;
  };

  try {
    overlay("自動選択→抽出を試行中…");
    tryAutoSelect();

    const selText = getSelectedText();
    if (!selText || selText.length < 10) {
      overlay("自動選択できませんでした。\n表をドラッグして選択（青）してから、もう一度実行して。", true);
      return;
    }

    const rows = parseLines(selText);
    if (!rows.length) {
      overlay("抽出0件。\n表を横方向も含めて広めに選択して再実行して。", true);
      return;
    }

    const csv = ["曲名,難易度名,定数,スコア"];
    for (const r of rows) {
      csv.push([escapeCSV(r.title), escapeCSV(r.diff), escapeCSV(r.lv), String(r.score)].join(","));
    }
    window.name = "TAKUMI_B40_CSV_V1\n" + csv.join("\n");

    const box = overlay(`抽出: ${rows.length}行\n下のボタンをタップしてBest40へ`, false);
    const a = document.createElement("a");
    a.href = DEST + "#from=bookmarklet";
    a.textContent = "▶ Best40ページを開く（タップ）";
    a.style.cssText =
      "display:block;margin-top:10px;text-align:center;padding:14px 16px;border-radius:14px;background:rgba(138,180,255,.20);border:1px solid rgba(138,180,255,.35);color:#fff;text-decoration:none;font-weight:900;";
    box.appendChild(a);
  } catch (e) {
    overlay("bm.js error: " + e, true);
  }
})();
