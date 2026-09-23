/*
 * 页面操作层：渲染看板/批次面板、处理表单与按钮事件。
 * 召回判定一律调用 Recall.*，存档一律调用 Archive.*，本文件不直接改判定规则。
 */
(function () {
  "use strict";

  const statuses = ["贴线中", "待阴干", "上金粉", "待交付", "已交付", Recall.REVIEW];
  const flow = ["贴线中", "待阴干", "上金粉", "待交付", "已交付"];
  const today = new Date().toISOString().slice(0, 10);

  let batchesState = Archive.loadBatches();
  let works = Archive.loadWorks(batchesState);
  let activeId = null;
  let replacingId = null;
  let replacingFromDetail = false;

  const form = document.querySelector("#workForm");
  const board = document.querySelector("#board");
  const statusFilter = document.querySelector("#statusFilter");
  const themeFilter = document.querySelector("#themeFilter");
  const sortMode = document.querySelector("#sortMode");
  const dialog = document.querySelector("#detailDialog");
  const batchPanel = document.querySelector("#batchPanel");

  form.dryDate.value = today;
  form.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

  function nowIso() {
    return new Date().toISOString();
  }
  function nowText() {
    return new Date().toLocaleString();
  }
  function esc(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
  function fmt(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString();
  }
  function persist() {
    Archive.saveWorks(works);
    Archive.saveBatches(batchesState);
  }
  function batchOf(work) {
    const id = Recall.batchInUse(work);
    return batchesState.batches.find(b => b.id === id);
  }
  function batchCode(work) {
    const b = batchOf(work);
    return b ? b.code : (Recall.activeIncident(work) || {}).batchCode || "未知批次";
  }
  function findWork(id) {
    return works.find(w => w.id === id);
  }
  function appendLog(work, text) {
    work.logs.push(`${nowText()} ${text}`);
  }

  /* ---------------- 召回事件展示 ---------------- */

  function traceHtml(work) {
    const incidents = work.recallIncidents || [];
    if (!incidents.length) return "";
    const rows = incidents.map(i => {
      const head = i.delivered
        ? `<b class="flag-delivered">已交付作品受影响</b>（批次 ${esc(i.batchCode)}，${esc(fmt(i.blockedAt))}）：原结果保留，已通知客户复核。原因：${esc(i.reason)}`
        : i.resumedAt
          ? `<b class="flag-resumed">召回已闭环</b>（批次 ${esc(i.batchCode)}，${esc(fmt(i.blockedAt))} 拦截）`
          : `<b class="flag-blocked">召回拦截中</b>（批次 ${esc(i.batchCode)}，${esc(fmt(i.blockedAt))} 停在待复核）：${esc(i.reason)}`;
      const lines = [`<div class="trace-row">${head}`];
      if (!i.delivered) {
        lines.push(`<div class="meta">拦截前工序：${esc(i.previousStatus || "贴线中")}${i.resumedAt ? ` · 已于 ${esc(fmt(i.resumedAt))} 恢复` : ""}</div>`);
      }
      if (i.replacement) {
        lines.push(`<div class="meta">换批：${esc(i.replacement.fromCode)} → ${esc(i.replacement.toCode)}，${esc(fmt(i.replacement.replacedAt))}，复核人 ${esc(i.replacement.reviewer)}</div>`);
      } else if (!i.delivered) {
        lines.push(`<div class="meta">换批：待更换合格批次</div>`);
      }
      if (i.reinspection) {
        lines.push(`<div class="meta">补做贴线检查：${esc(fmt(i.reinspection.at))}，复检人 ${esc(i.reinspection.inspector)}</div>`);
      } else if (i.replacement) {
        lines.push(`<div class="meta">补做贴线检查：尚未完成</div>`);
      }
      lines.push("</div>");
      return lines.join("");
    }).join("");
    return `<div class="trace">${rows}</div>`;
  }

  /* ---------------- 批次管理面板 ---------------- */

  function renderBatchOptions(select, onlyActive) {
    const list = batchesState.batches.filter(b => !onlyActive || b.active);
    select.innerHTML = list.map(b =>
      `<option value="${esc(b.id)}" ${b.id === batchesState.currentId ? "selected" : ""}>${esc(b.code)} · ${esc(b.supplier)}${b.active ? "" : "（已停用）"}</option>`
    ).join("");
  }

  function renderBatches() {
    batchPanel.innerHTML = batchesState.batches.map(b => `
      <div class="batch-item ${b.active ? "" : "inactive"}">
        <div>
          <b>${esc(b.code)}</b>${b.id === batchesState.currentId ? ' <span class="cur-tag">建档在用</span>' : ""}
          <div class="meta">${esc(b.supplier)} · 到货 ${esc(b.receivedAt)} · ${b.active ? "合格在用" : "已停用召回"}</div>
          ${b.active ? "" : `<div class="meta">停用时间 ${esc(fmt(b.recalledAt))} · 原因：${esc(b.recallReason || "—")}</div>`}
        </div>
        <div class="actions">
          ${b.active
            ? `<button class="secondary" onclick="setCurrentBatch('${b.id}')">设为建档批次</button>
               <button class="danger" onclick="recallBatch('${b.id}')">供应商停用</button>`
            : `<button class="secondary" disabled>已召回留档</button>`}
        </div>
      </div>`).join("");
  }

  function recallBatch(batchId) {
    const batch = batchesState.batches.find(b => b.id === batchId);
    if (!batch || !batch.active) return;
    const reason = prompt(`批次「${batch.code}」被供应商停用，请填写停用原因：`);
    if (reason === null) return;

    // 先做纯判定，拿到拦截/标记结果再写日志与存档
    const deactivated = Recall.deactivateBatch(batch, reason, nowIso());
    const before = works.map(w => ({ id: w.id, blocked: Recall.isBlocked(w), delivered: Recall.deliveredFlags(w).length }));
    batchesState.batches = batchesState.batches.map(b => b.id === batchId ? deactivated : b);
    if (batchesState.currentId === batchId) {
      const fallback = batchesState.batches.find(b => b.active);
      batchesState.currentId = fallback ? fallback.id : "";
    }
    works = Recall.assess(works, batchesState.batches, nowIso());

    let blockedCount = 0;
    let deliveredCount = 0;
    works.forEach((w, idx) => {
      if (!before[idx].blocked && Recall.isBlocked(w)) {
        blockedCount++;
        appendLog(w, `召回拦截：使用批次 ${batch.code}，马上停在待复核`);
      }
      if (Recall.deliveredFlags(w).length > before[idx].delivered) {
        deliveredCount++;
        appendLog(w, `召回标记：已交付作品使用批次 ${batch.code}，保留原结果并标出受影响`);
      }
    });
    persist();
    render();
    alert(`批次「${batch.code}」已停用留档：未交付 ${blockedCount} 件停在待复核，已交付 ${deliveredCount} 件标出受影响。`);
  }

  function setCurrentBatch(batchId) {
    const batch = batchesState.batches.find(b => b.id === batchId);
    if (!batch || !batch.active) return;
    batchesState.currentId = batchId;
    persist();
    render();
  }

  /* ---------------- 看板与详情 ---------------- */

  function filtered() {
    return works
      .filter(w => !statusFilter.value || w.status === statusFilter.value)
      .filter(w => !themeFilter.value || w.theme.includes(themeFilter.value.trim()))
      .sort((a, b) => (a[sortMode.value] || "").localeCompare(b[sortMode.value] || ""));
  }

  function actionButtons(work, status) {
    if (Recall.isBlocked(work)) {
      return `<button class="violet" onclick="openReplace('${work.id}')">更换合格批次</button>
              <button class="warn" onclick="doReinspect('${work.id}')">补做贴线检查</button>
              <button class="secondary" onclick="doResume('${work.id}')">恢复流转</button>
              <button disabled>状态流转已停</button>`;
    }
    if (work.status === Recall.DELIVERED) {
      return `<button class="secondary" disabled>已交付</button>`;
    }
    const target = flow.indexOf(work.status) + 1;
    return flow.map((s, idx) => {
      if (s === work.status) return "";
      const forward = idx === target && s === Recall.DELIVERED;
      const cls = forward ? "" : "secondary";
      return `<button class="${cls}" onclick="updateStatus('${work.id}', '${s}')">${s}</button>`;
    }).join("") + `<button class="warn" onclick="recordDefect('${work.id}')">记缺陷</button>`;
  }

  function cardClass(work) {
    if (Recall.isBlocked(work)) return "item blocked";
    if (Recall.deliveredFlags(work).length) return "item affected";
    return work.defect ? "item overdue" : "item";
  }

  function renderBoard() {
    const list = filtered();
    board.innerHTML = statuses.map(status => {
      const cards = list.filter(w => w.status === status);
      return `<section class="col">
        <h3><span>${status}</span><span>${cards.length}</span></h3>
        ${cards.length ? cards.map(w => {
          const badge = Recall.isBlocked(w)
            ? `<div class="recall-badge">召回拦截：${esc((Recall.activeIncident(w) || {}).reason || "")}</div>`
            : Recall.deliveredFlags(w).length
              ? `<div class="recall-badge delivered-flag">受影响：批次 ${esc(Recall.deliveredFlags(w)[0].batchCode)}（原结果保留）</div>`
              : "";
          return `<article class="${cardClass(w)}" onclick="showDetail('${w.id}')">
            <b>${esc(w.theme)}</b>
            <div class="meta">${esc(w.base)} · ${esc(w.line)}<br>
            在用批次：${esc(batchCode(w))}<br>
            进度 ${w.progress}% · 阴干 ${esc(w.dryDate)}<br>
            金粉：${esc(w.gold)} · 交付：${esc(w.delivery)}<br>
            ${w.defect ? "缺陷：" + esc(w.defect) : "缺陷：无"}</div>
            ${badge}
            ${traceHtml(w)}
            <div class="actions" onclick="event.stopPropagation()">${actionButtons(w, status)}</div>
          </article>`;
        }).join("") : `<div class="empty">暂无作品</div>`}
      </section>`;
    }).join("");
  }

  function renderSummaries() {
    const todayDry = works.filter(w => w.dryDate <= today && w.status === "待阴干");
    const defects = works.filter(w => w.defect);
    const blocked = works.filter(w => Recall.isBlocked(w));
    const affected = works.filter(w => Recall.deliveredFlags(w).length);
    const delivery = [...works].sort((a, b) => a.delivery.localeCompare(b.delivery)).slice(0, 4);

    document.querySelector("#todayDry").innerHTML = todayDry.length
      ? todayDry.map(w => `<div class="item" onclick="showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.base)} · ${esc(w.dryDate)}</div></div>`).join("")
      : `<div class="empty">暂无</div>`;
    document.querySelector("#defectList").innerHTML = defects.length
      ? defects.map(w => `<div class="item overdue" onclick="showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.defect)}</div></div>`).join("")
      : `<div class="empty">暂无</div>`;
    document.querySelector("#recallList").innerHTML = blocked.length || affected.length
      ? blocked.concat(affected.filter(w => !blocked.includes(w))).map(w =>
          `<div class="item ${Recall.isBlocked(w) ? "blocked" : "affected"}" onclick="showDetail('${w.id}')"><b>${esc(w.theme)}</b>` +
          `<div class="meta">${Recall.isBlocked(w)
            ? "待复核 · " + esc((Recall.activeIncident(w) || {}).batchCode || "")
            : "已交付受影响 · " + esc(Recall.deliveredFlags(w)[0].batchCode)}</div></div>`).join("")
      : `<div class="empty">暂无</div>`;
    document.querySelector("#deliveryList").innerHTML = delivery
      .map(w => `<div class="item" onclick="showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.delivery)} · ${esc(w.status)}</div></div>`).join("");
  }

  function showDetail(id) {
    activeId = id;
    const w = findWork(id);
    document.querySelector("#detailTitle").textContent = `${w.theme} · ${w.base}`;
    const incident = Recall.activeIncident(w);
    document.querySelector("#detailContent").innerHTML = `
      胎体材质：${esc(w.base)}<br>线条粗细：${esc(w.line)}<br>贴线进度：${w.progress}%<br>
      阴干日期：${esc(w.dryDate)}<br>金粉状态：${esc(w.gold)}<br>缺陷位置：${esc(w.defect || "无")}<br>
      交付日期：${esc(w.delivery)}<br>当前状态：${esc(w.status)}<br>备注：${esc(w.note || "无")}<br>
      建档批次：${esc(w.batchId)}（建档时记录 ${esc(w.batchAssignedAt)}）<br>
      当前在用批次：${esc(batchCode(w))}<br>
      批次更换史：${w.batchHistory && w.batchHistory.length
        ? w.batchHistory.map(h => `${esc(h.fromCode)} → ${esc(h.toCode)}（${esc(fmt(h.changedAt))}，复核人 ${esc(h.reviewer)}）`).join("；")
        : "无"}<br>
      召回追踪：${traceHtml(w) || "无"}<br>
      流转记录：${w.logs.map(esc).join(" / ")}
    `;
    const blockedActions = document.querySelector("#blockedActions");
    blockedActions.hidden = !incident;
    document.querySelector("#defectInput").value = "";
    dialog.showModal();
  }

  /* ---------------- 召回处理三步操作 ---------------- */

  function openReplace(id, fromDetail) {
    replacingId = id;
    replacingFromDetail = !!fromDetail;
    const w = findWork(id);
    const incident = Recall.activeIncident(w);
    const dialog2 = document.querySelector("#replaceDialog");
    document.querySelector("#replaceTitle").textContent =
      `更换合格批次 · ${w.theme}（旧批次 ${incident.batchCode}）`;
    document.querySelector("#replaceReviewer").value = "";
    const select = document.querySelector("#newBatchSelect");
    renderBatchOptions(select, true);
    dialog2.showModal();
  }

  function doReplace() {
    const w = findWork(replacingId);
    if (!w) return;
    const newBatch = batchesState.batches.find(b => b.id === document.querySelector("#newBatchSelect").value);
    const reviewer = document.querySelector("#replaceReviewer").value.trim();
    const result = Recall.replaceBatch(w, newBatch, reviewer, nowIso());
    if (!result.ok) { alert(result.error); return; }

    const idx = works.findIndex(x => x.id === replacingId);
    works[idx] = result.work;
    appendLog(works[idx], `召回换批：${Recall.activeIncident(works[idx]).batchCode} → ${newBatch.code}，复核人 ${reviewer}`);
    persist();
    replacingId = null;
    const reopen = replacingFromDetail;
    replacingFromDetail = false;
    document.querySelector("#replaceDialog").close();
    render();
    if (reopen) showDetail(activeId);
  }

  function doReinspect(id) {
    const w = findWork(id);
    const inspector = prompt("补做贴线检查，请填写复检人：");
    if (inspector === null) return;
    const result = Recall.recordReinspection(w, inspector, nowIso());
    if (!result.ok) { alert(result.error); return; }

    const idx = works.findIndex(x => x.id === id);
    works[idx] = result.work;
    appendLog(works[idx], `补做贴线检查通过，复检人 ${inspector.trim()}`);
    persist();
    render();
    if (activeId) showDetail(activeId);
  }

  function doResume(id) {
    const w = findWork(id);
    const result = Recall.resumeWork(w, nowIso());
    if (!result.ok) { alert(result.error); return; }

    const idx = works.findIndex(x => x.id === id);
    const resumed = result.work.status;
    works[idx] = result.work;
    appendLog(works[idx], `召回闭环：恢复流转至 ${resumed}`);
    persist();
    render();
    if (activeId) showDetail(activeId);
  }

  /* ---------------- 常规作品操作 ---------------- */

  function updateStatus(id, status) {
    const work = findWork(id);
    if (!work || Recall.isBlocked(work)) {
      alert("作品正处于召回待复核，需先更换合格批次并补做贴线检查。");
      return;
    }
    work.status = status;
    if (status === "待阴干") work.dryDate = today;
    if (status === "已交付") { work.gold = "已上金粉"; work.progress = 100; }
    if (status === "上金粉") work.gold = "已上金粉";
    if (status === "待交付") work.progress = 100;
    appendLog(work, `更新为 ${status}`);

    // 交付瞬间若在用批次已被停用，结果保留但标出受影响
    const beforeFlags = Recall.deliveredFlags(work).length;
    works = Recall.assess(works, batchesState.batches, nowIso());
    const updated = findWork(id);
    if (Recall.deliveredFlags(updated).length > beforeFlags) {
      appendLog(updated, `交付时发现批次已停用：保留交付结果，标出受影响`);
    }
    persist();
    render();
  }

  function recordDefect(id, text) {
    const work = findWork(id);
    const value = text || prompt("输入断线/翘线位置");
    if (!value) return;
    work.defect = work.defect ? `${work.defect}; ${value}` : value;
    appendLog(work, `缺陷：${value}`);
    persist();
    render();
  }

  function render() {
    renderBatches();
    renderBatchOptions(form.querySelector("[name=batch]"), true);
    renderSummaries();
    renderBoard();
  }

  /* ---------------- 事件绑定 ---------------- */

  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const batch = batchesState.batches.find(b => b.id === data.batch);
    if (!batch || !batch.active) { alert("请选择建档时在用的合格线材批次"); return; }
    works.unshift({
      id: crypto.randomUUID(),
      base: data.base,
      theme: data.theme,
      line: data.line,
      progress: Number(data.progress),
      dryDate: data.dryDate,
      gold: data.gold,
      defect: data.defect,
      delivery: data.delivery,
      status: data.status,
      note: data.note,
      logs: [`${nowText()} 创建作品`],
      // 建档时记下正在用的批次；旧批次字段始终保留
      batchId: batch.id,
      currentBatchId: batch.id,
      batchAssignedAt: nowText(),
      batchHistory: [],
      recallIncidents: []
    });
    Archive.saveWorks(works);
    form.reset();
    form.dryDate.value = today;
    form.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    form.querySelector("[name=batch]").value = batchesState.currentId;
    render();
  });

  document.querySelector("#saveDefect").addEventListener("click", () => {
    recordDefect(activeId, document.querySelector("#defectInput").value.trim());
    if (activeId) showDetail(activeId);
  });
  document.querySelector("#closeDialog").addEventListener("click", () => { dialog.close(); activeId = null; });
  document.querySelector("#cancelReplace").addEventListener("click", () => {
    replacingId = null;
    document.querySelector("#replaceDialog").close();
  });
  document.querySelector("#confirmReplace").addEventListener("click", doReplace);
  document.querySelector("#clearFilters").addEventListener("click", () => {
    themeFilter.value = "";
    statusFilter.value = "";
    render();
  });
  [statusFilter, themeFilter, sortMode].forEach(el => el.addEventListener("input", render));
  document.querySelector("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ batches: batchesState, works }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lacquer-thread-works.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  statusFilter.innerHTML = `<option value="">全部状态</option>` +
    statuses.map(s => `<option>${s}</option>`).join("");

  function openReplaceFromDetail() {
    const id = activeId;
    dialog.close();
    if (id) openReplace(id, true);
  }

  Object.assign(window, {
    showDetail,
    updateStatus,
    recordDefect,
    recallBatch,
    setCurrentBatch,
    openReplace,
    doReinspect,
    doResume,
    openReplaceFromDetail
  });

  persist();
  render();
})();
