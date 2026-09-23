/*
 * app.js —— 页面操作层
 * 只负责界面渲染与交互；召回规则全部调用 Recall 层，数据读写走 Archive 层。
 */
(function () {
  "use strict";

  const R = window.Recall;
  const Store = window.Archive;
  const today = new Date().toISOString().slice(0, 10);

  const state = Store.load();
  let works = state.works;
  let batches = state.batches;
  let activeId = null;

  const form = document.querySelector("#workForm");
  const batchForm = document.querySelector("#batchForm");
  const board = document.querySelector("#board");
  const statusFilter = document.querySelector("#statusFilter");
  const themeFilter = document.querySelector("#themeFilter");
  const sortMode = document.querySelector("#sortMode");
  const batchSelect = form.querySelector("[name=batchId]");
  const detailDialog = document.querySelector("#detailDialog");
  const recallDialog = document.querySelector("#recallDialog");

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmt(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString("zh-CN", { hour12: false });
  }

  function day(iso) {
    return (iso || "").slice(0, 10);
  }

  function saveAll() {
    Store.persist(batches, works);
  }

  function findWork(id) {
    return works.find(w => w.id === id);
  }

  function findBatch(id) {
    return batches.find(b => b.id === id);
  }

  form.dryDate.value = today;
  form.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  statusFilter.innerHTML =
    `<option value="">全部状态</option>` +
    R.STATUSES.map(s => `<option>${s}</option>`).join("");

  /* ---------------- 批次区 ---------------- */

  function refreshBatchSelect(keepId) {
    const active = batches.filter(b => R.isBatchActive(b));
    batchSelect.innerHTML = active.length
      ? active.map(b => `<option value="${b.id}">${esc(b.code)} · ${esc(b.supplier)} · ${esc(b.spec)}</option>`).join("")
      : "";
    if (keepId && active.some(b => b.id === keepId)) batchSelect.value = keepId;
  }

  function renderBatches() {
    const el = document.querySelector("#batchList");
    el.innerHTML = batches.length
      ? batches.map(b => `<div class="batch-row ${b.status}">
          <div>
            <b>${esc(b.code)}</b>
            <span class="tag ${b.status === "active" ? "tag-teal" : "tag-red"}">${b.status === "active" ? "合格在用" : "已停用"}</span>
            <div class="meta">${esc(b.supplier)} · ${esc(b.spec)} · 登记 ${day(b.registeredAt)}</div>
            ${b.status === "stopped" ? `<div class="recall-red">停用：${esc(b.stopReason || "供应商召回")} · ${day(b.stoppedAt)}</div>` : ""}
          </div>
          ${b.status === "active" ? `<button class="danger" onclick="App.stopBatch('${b.id}')">停用并召回</button>` : ""}
        </div>`).join("")
      : `<div class="empty">还没有登记批次，先在左侧登记一个。</div>`;
  }

  /* ---------------- 召回小列表 ---------------- */

  function renderRecallList() {
    const el = document.querySelector("#recallList");
    const flagged = works
      .filter(w => w.recalls && w.recalls.length)
      .sort((a, b) => {
        const ta = Math.max(...a.recalls.map(x => new Date(x.recalledAt).getTime()));
        const tb = Math.max(...b.recalls.map(x => new Date(x.recalledAt).getTime()));
        return tb - ta;
      });
    el.innerHTML = flagged.length
      ? flagged.map(w => {
          const pending = R.pendingRecall(w);
          const delivered = R.deliveredRecall(w);
          const cls = pending ? "overdue" : "";
          const text = pending
            ? (pending.status === "replaced"
                ? `已换 ${pending.replacement.newBatchCode}，待贴线检查`
                : `批次 ${pending.batchCode} 召回，待复核`)
            : delivered
              ? `已交付 · 批次 ${delivered.batchCode} 受影响`
              : `已恢复 · ${w.recalls.filter(x => x.status === "resolved").length} 次复检通过`;
          return `<div class="item ${cls}" onclick="App.openRecall('${w.id}')">
            <b>${esc(w.theme)}</b><div class="meta">${esc(text)}</div>
          </div>`;
        }).join("")
      : `<div class="empty">暂无召回</div>`;
  }

  /* ---------------- 汇总小列表 ---------------- */

  function renderSummaries() {
    const todayDry = works.filter(w => w.dryDate <= today && w.status === "待阴干");
    const defects = works.filter(w => w.defect);
    const delivery = [...works]
      .sort((a, b) => (a.delivery || "").localeCompare(b.delivery || ""))
      .slice(0, 4);

    document.querySelector("#todayDry").innerHTML = todayDry.length
      ? todayDry.map(w => `<div class="item" onclick="App.showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.base)} · ${esc(w.dryDate)}</div></div>`).join("")
      : `<div class="empty">暂无</div>`;
    document.querySelector("#defectList").innerHTML = defects.length
      ? defects.map(w => `<div class="item overdue" onclick="App.showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.defect)}</div></div>`).join("")
      : `<div class="empty">暂无</div>`;
    document.querySelector("#deliveryList").innerHTML = delivery.length
      ? delivery.map(w => `<div class="item ${R.deliveredRecall(w) ? "overdue" : ""}" onclick="App.showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.delivery)} · ${esc(w.status)}</div></div>`).join("")
      : `<div class="empty">暂无</div>`;

    renderRecallList();
  }

  /* ---------------- 看板 ---------------- */

  function filtered() {
    return works
      .filter(w => !statusFilter.value || w.status === statusFilter.value)
      .filter(w => !themeFilter.value || w.theme.includes(themeFilter.value.trim()))
      .sort((a, b) => (a[sortMode.value] || "").localeCompare(b[sortMode.value] || ""));
  }

  function recallBlock(w) {
    const pending = R.pendingRecall(w);
    if (pending) {
      if (pending.status === "replaced") {
        const rep = pending.replacement;
        return `<div class="recall-amber">已换批 ${esc(rep.oldBatchCode)} → ${esc(rep.newBatchCode)}
          （${day(rep.replacedAt)}，复核人 ${esc(rep.reviewer)}）<br>补做贴线检查后才能恢复流转</div>`;
      }
      return `<div class="recall-red">被拦：批次 ${esc(pending.batchCode)} 已停用
        ${pending.reason ? "（" + esc(pending.reason) + "）" : ""}<br>${day(pending.recalledAt)} 起停在待复核，原状态 ${esc(w.pausedStatus)}</div>`;
    }
    const delivered = R.deliveredRecall(w);
    if (delivered) {
      return `<div class="recall-red">已交付受影响：批次 ${esc(delivered.batchCode)} 已停用
        ${delivered.reason ? "（" + esc(delivered.reason) + "）" : ""}<br>结果保留，仅标记备查</div>`;
    }
    const resolved = (w.recalls || []).filter(x => x.status === "resolved");
    if (resolved.length) {
      const last = resolved[resolved.length - 1];
      return `<div class="recall-muted">召回已恢复：${day(last.resolution.checkedAt)} 贴线复检通过 → ${esc(last.resolution.restoredStatus)}</div>`;
    }
    return "";
  }

  function cardActions(w, status) {
    if (status === R.HELD) {
      return `<button class="danger" onclick="App.openRecall('${w.id}')">召回处理</button>
        <button class="warn" onclick="App.recordDefect('${w.id}')">记缺陷</button>`;
    }
    if (status === R.DELIVERED) return "";
    return R.FLOW_STATUSES.map(s =>
      `<button class="${s === status ? "secondary" : ""}" onclick="App.updateStatus('${w.id}', '${s}')">${s}</button>`
    ).join("") +
      `<button class="violet" onclick="App.deliver('${w.id}')">确认交付</button>` +
      `<button class="warn" onclick="App.recordDefect('${w.id}')">记缺陷</button>`;
  }

  function renderBoard() {
    const list = filtered();
    board.innerHTML = R.STATUSES.map(status => {
      const cards = list.filter(w => w.status === status);
      return `<section class="col">
        <h3><span>${status}</span><span>${cards.length}</span></h3>
        ${cards.length ? cards.map(w => {
          const batchCode = w.batch ? w.batch.code : "未登记批次";
          const blocked = R.pendingRecall(w);
          const affected = R.deliveredRecall(w);
          const cls = blocked || affected || w.defect ? "overdue" : "";
          return `<article class="item ${cls}" onclick="App.showDetail('${w.id}')">
            <b>${esc(w.theme)}</b>
            <div class="tags">
              <span class="tag ${blocked ? "tag-red" : affected ? "tag-amber" : "tag-teal"}">线材 ${esc(batchCode)}</span>
              ${blocked ? `<span class="tag tag-red">召回待复核</span>` : ""}
              ${affected ? `<span class="tag tag-amber">交付受影响</span>` : ""}
            </div>
            <div class="meta">${esc(w.base)} · ${esc(w.line)}<br>进度 ${w.progress}% · 阴干 ${esc(w.dryDate)}<br>金粉：${esc(w.gold)} · 交付：${esc(w.delivery)}<br>${w.defect ? "缺陷：" + esc(w.defect) : "缺陷：无"}</div>
            ${recallBlock(w)}
            <div class="actions" onclick="event.stopPropagation()">
              ${cardActions(w, status)}
            </div>
          </article>`;
        }).join("") : `<div class="empty">暂无作品</div>`}
      </section>`;
    }).join("");
  }

  function render() {
    refreshBatchSelect();
    renderBatches();
    renderSummaries();
    renderBoard();
  }

  /* ---------------- 详情弹窗 ---------------- */

  function showDetail(id) {
    activeId = id;
    const w = findWork(id);
    const historyHtml = (w.batchHistory || []).length
      ? `<ul class="history-list">${w.batchHistory.map(h =>
          `<li>${esc(h.batchCode)}（${esc(h.supplier)}）建档启用 → ${day(h.replacedAt)} 因召回换下，复核人 ${esc(h.reviewer)}</li>`
        ).join("")}</ul>`
      : "无换批记录";
    const recallsHtml = (w.recalls || []).length
      ? `<ul class="history-list">${w.recalls.map(x => {
          const stateText = x.kind === "delivered"
            ? "交付后标记受影响（结果保留）"
            : x.status === "resolved"
              ? `已恢复：${fmt(x.resolution.checkedAt)} 贴线复检通过（检查人 ${esc(x.resolution.inspector)}）→ ${esc(x.resolution.restoredStatus)}`
              : x.status === "replaced"
                ? `已换批待复检：${esc(x.replacement.newBatchCode)}，${fmt(x.replacement.replacedAt)}，复核人 ${esc(x.replacement.reviewer)}`
                : "拦截中，待复核";
          return `<li>${fmt(x.recalledAt)} · 批次 ${esc(x.batchCode)}${x.reason ? "（" + esc(x.reason) + "）" : ""}：${stateText}</li>`;
        }).join("")}</ul>`
      : "无召回记录";

    document.querySelector("#detailTitle").textContent = `${w.theme} · ${w.base}`;
    document.querySelector("#detailContent").innerHTML = `
      胎体材质：${esc(w.base)}<br>线条粗细：${esc(w.line)}<br>贴线进度：${w.progress}%<br>
      阴干日期：${esc(w.dryDate)}<br>金粉状态：${esc(w.gold)}<br>缺陷位置：${esc(w.defect) || "无"}<br>
      交付日期：${esc(w.delivery)}${w.deliveredAt ? "（" + fmt(w.deliveredAt) + " 交付）" : ""}<br>
      当前状态：${esc(w.status)}<br>备注：${esc(w.note) || "无"}<hr>
      <b>在用批次</b>：${w.batch ? esc(w.batch.code) + " · " + esc(w.batch.supplier) + " · " + esc(w.batch.spec) : "旧作品未登记批次"}<br>
      <b>批次沿革（旧批次始终保留）</b>：${historyHtml}
      <b>召回与恢复</b>：${recallsHtml}
      <b>流转记录</b>：${w.logs.map(esc).join(" / ")}
    `;
    document.querySelector("#defectInput").value = "";
    detailDialog.showModal();
  }

  /* ---------------- 召回处理弹窗（换批 + 贴线复检） ---------------- */

  function openRecall(id) {
    activeId = id;
    const w = findWork(id);
    document.querySelector("#recallTitle").textContent = `召回处理 · ${w.theme}`;
    renderRecallDialog();
    recallDialog.showModal();
  }

  function renderRecallDialog() {
    const w = findWork(activeId);
    const pending = R.pendingRecall(w);
    const delivered = R.deliveredRecall(w);

    let html = "";
    if (delivered && !pending) {
      html = `<div class="recall-red">该作品已交付，批次 ${esc(delivered.batchCode)} 停用${delivered.reason ? "（" + esc(delivered.reason) + "）" : ""}。
        交付结果保留不改动，此处仅标出受影响，停用时间 ${fmt(delivered.recalledAt)}。</div>`;
    } else if (pending) {
      const active = batches.filter(b => R.isBatchActive(b));
      const batchOptions = active
        .map(b => `<option value="${b.id}">${esc(b.code)} · ${esc(b.supplier)} · ${esc(b.spec)}</option>`)
        .join("");

      html = `<div class="recall-red">拦截原因：批次 ${esc(pending.batchCode)} 已停用${pending.reason ? "（" + esc(pending.reason) + "）" : ""}
        ，${fmt(pending.recalledAt)} 起停在待复核，召回前状态 ${esc(w.pausedStatus)}。</div>`;

      if (pending.status === "pending") {
        html += `<div class="step">
          <h4>第一步：更换合格批次（留下旧批次、替换时间与复核人）</h4>
          <label>新批次
            <select id="newBatchSelect">${batchOptions || `<option value="">无合格批次，请先登记</option>`}</select>
          </label>
          <label>复核人<input id="reviewerInput" placeholder="姓名"></label>
          <button class="violet" onclick="App.replaceBatch()">确认换批（仍停留待复核）</button>
        </div>`;
      } else {
        const rep = pending.replacement;
        html += `<div class="step">
          <h4>已换批：${esc(rep.oldBatchCode)} → ${esc(rep.newBatchCode)}</h4>
          <div class="meta">替换时间 ${fmt(rep.replacedAt)} · 复核人 ${esc(rep.reviewer)}</div>
        </div>
        <div class="step">
          <h4>第二步：补做贴线检查</h4>
          <label>检查人<input id="inspectorInput" placeholder="姓名"></label>
          <label>检查备注<input id="checkNoteInput" placeholder="断线/翘线复查情况"></label>
          <label style="grid-auto-flow: column; grid-template-columns: auto 1fr; align-items: center; gap: 8px;">
            <input type="checkbox" id="checkPassed" style="width:auto" checked> 贴线检查合格，恢复流转到「${esc(w.pausedStatus)}」
          </label>
          <button class="violet" onclick="App.completeCheck()">提交检查并恢复</button>
        </div>`;
      }
    } else {
      html = `<div class="meta">该作品没有待处理的召回。</div>`;
    }

    document.querySelector("#recallContent").innerHTML = html;
  }

  function replaceBatch() {
    const w = findWork(activeId);
    const result = R.applyBatchReplacement({
      work: w,
      batches,
      newBatchId: document.querySelector("#newBatchSelect").value,
      reviewer: document.querySelector("#reviewerInput").value
    });
    if (!result.ok) return alert(result.error);
    saveAll();
    render();
    renderRecallDialog();
  }

  function completeCheck() {
    const w = findWork(activeId);
    const result = R.applyLineCheck({
      work: w,
      inspector: document.querySelector("#inspectorInput").value,
      note: document.querySelector("#checkNoteInput").value,
      passed: document.querySelector("#checkPassed").checked
    });
    if (!result.ok) return alert(result.error);
    saveAll();
    render();
    alert(`贴线检查通过，作品已恢复到「${result.recall.resolution.restoredStatus}」`);
    recallDialog.close();
  }

  /* ---------------- 状态操作 ---------------- */

  function updateStatus(id, status) {
    const w = findWork(id);
    const guard = R.canChangeStatus(w, status);
    if (!guard.ok) return alert(guard.error);
    w.status = status;
    if (status === "待阴干") w.dryDate = today;
    if (status === "上金粉") w.gold = "已上金粉";
    if (status === "待交付") w.progress = 100;
    w.logs.push(`${R.nowIso()} 更新为 ${status}`);
    saveAll();
    render();
  }

  function deliver(id) {
    const w = findWork(id);
    const result = R.markDelivered({ work: w });
    if (!result.ok) return alert(result.error);
    saveAll();
    render();
  }

  function recordDefect(id, text) {
    const w = findWork(id);
    const value = text || prompt("输入断线/翘线位置");
    if (!value || !value.trim()) return;
    w.defect = w.defect ? `${w.defect}; ${value.trim()}` : value.trim();
    w.logs.push(`${R.nowIso()} 缺陷：${value.trim()}`);
    saveAll();
    render();
  }

  /* ---------------- 批次操作 ---------------- */

  function stopBatch(id) {
    const b = findBatch(id);
    const reason = prompt(`停用批次 ${b.code} 的原因（供应商召回说明）？`, "供应商通知该批次停用");
    if (reason === null) return;
    const result = R.applyRecall({
      batches,
      works,
      batchId: id,
      reason: reason.trim()
    });
    if (!result.ok) return alert(result.error);
    saveAll();
    render();
    alert(`批次 ${b.code} 已停用：${result.held.length} 件未交付作品停在待复核，${result.affected.length} 件已交付作品标记受影响。`);
  }

  /* ---------------- 表单与导出 ---------------- */

  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const batch = findBatch(data.batchId);
    if (!batch || !R.isBatchActive(batch)) {
      return alert("请先登记并选择一个合格在用批次，再建档。");
    }
    const work = Store.normalizeWork({
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
      batch: R.batchSnapshot(batch),
      logs: [`${R.nowIso()} 创建作品，建档批次 ${batch.code}`]
    });
    works.unshift(work);
    form.reset();
    form.dryDate.value = today;
    form.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    refreshBatchSelect(batch.id);
    saveAll();
    render();
  });

  batchForm.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(batchForm).entries());
    if (batches.some(b => b.code === data.code.trim())) {
      return alert("该批次号已登记");
    }
    const result = R.createBatch(data);
    if (!result.ok) return alert(result.error);
    batches.push(result.batch);
    batchForm.reset();
    saveAll();
    render();
  });

  document.querySelector("#saveDefect").addEventListener("click", () => {
    const input = document.querySelector("#defectInput");
    recordDefect(activeId, input.value.trim());
    if (detailDialog.open) showDetail(activeId);
  });
  document.querySelector("#closeDialog").addEventListener("click", () => detailDialog.close());
  document.querySelector("#recallClose").addEventListener("click", () => recallDialog.close());

  document.querySelector("#clearFilters").addEventListener("click", () => {
    themeFilter.value = "";
    statusFilter.value = "";
    render();
  });
  [statusFilter, themeFilter, sortMode].forEach(el => el.addEventListener("input", render));

  document.querySelector("#exportBtn").addEventListener("click", () => {
    const payload = {
      exportedAt: R.nowIso(),
      batches,
      works
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lacquer-thread-works.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  window.App = {
    showDetail,
    openRecall,
    replaceBatch,
    completeCheck,
    updateStatus,
    deliver,
    recordDefect,
    stopBatch
  };

  saveAll();
  render();
})();
