/*
 * 召回判断层（纯逻辑，不碰 DOM、不碰 localStorage）
 * 只负责：批次停用、受影响作品判定、拦截/换批/复检/恢复的状态流转。
 */
(function (global) {
  "use strict";

  const REVIEW = "待复核";
  const DELIVERED = "已交付";

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function batchInUse(work) {
    return work.currentBatchId || work.batchId;
  }

  function isDelivered(work) {
    return work.status === DELIVERED;
  }

  // 当前未闭环的召回事件：未交付且尚未恢复
  function activeIncident(work) {
    const list = work.recallIncidents || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const incident = list[i];
      if (!incident.delivered && !incident.resumedAt) return incident;
    }
    return null;
  }

  function isBlocked(work) {
    return !!activeIncident(work);
  }

  // 已交付作品上保留的受影响标记
  function deliveredFlags(work) {
    return (work.recallIncidents || []).filter(i => i.delivered);
  }

  /*
   * 供应商停用批次后，对全部作品做一次召回判定（幂等）：
   * - 当前用批正是被停用批次、且未交付：记下原状态，马上停在「待复核」
   * - 已交付：保留原状态与成品结果，只追加一条受影响标记
   * 已存在的同批次事件不会重复生成。
   */
  function assess(works, batches, nowIso) {
    return works.map(work => {
      const usingId = batchInUse(work);
      const batch = batches.find(b => b.id === usingId);
      if (!batch || batch.active) return work;

      const list = work.recallIncidents || [];
      const delivered = isDelivered(work);
      const duplicated = list.some(i => i.batchId === batch.id &&
        (delivered ? i.delivered : (!i.delivered && !i.resumedAt)));
      if (duplicated) return work;

      const incident = {
        batchId: batch.id,
        batchCode: batch.code,
        reason: batch.recallReason || "供应商停用该批次线材",
        blockedAt: nowIso,
        delivered,
        previousStatus: delivered ? null : work.status,
        replacement: null,   // { fromBatchId/Code, toBatchId/Code, replacedAt, reviewer }
        reinspection: null,  // { at, inspector }
        resumedAt: null
      };
      const next = Object.assign({}, work, { recallIncidents: list.concat(incident) });
      if (!delivered) next.status = REVIEW;
      return next;
    });
  }

  // 供应商停用批次：批次记录只追加停用信息，永不删除
  function deactivateBatch(batch, reason, nowIso) {
    return Object.assign({}, batch, {
      active: false,
      recalledAt: nowIso,
      recallReason: (reason || "供应商通知停用").trim()
    });
  }

  // 第一步：更换为合格批次，留下旧批次、替换时间、复核人
  function replaceBatch(work, newBatch, reviewer, nowIso) {
    const incident = activeIncident(work);
    if (!incident) return { ok: false, error: "作品未处于召回拦截状态" };
    if (!newBatch || !newBatch.active) return { ok: false, error: "只能更换为在用的合格批次" };
    if (newBatch.id === batchInUse(work)) return { ok: false, error: "新批次与被召回批次相同" };
    if (!reviewer || !reviewer.trim()) return { ok: false, error: "必须填写复核人" };

    const next = clone(work);
    const target = activeIncident(next);
    const fromId = batchInUse(next);
    const entry = {
      fromBatchId: fromId,
      fromCode: target.batchCode,
      toBatchId: newBatch.id,
      toCode: newBatch.code,
      changedAt: nowIso,
      reviewer: reviewer.trim()
    };
    target.replacement = {
      fromBatchId: entry.fromBatchId,
      fromCode: entry.fromCode,
      toBatchId: entry.toBatchId,
      toCode: entry.toCode,
      replacedAt: nowIso,
      reviewer: reviewer.trim()
    };
    next.currentBatchId = newBatch.id;
    next.batchHistory = (next.batchHistory || []).concat(entry);
    return { ok: true, work: next };
  }

  // 第二步：补做贴线检查（必须先换好合格批次）
  function recordReinspection(work, inspector, nowIso) {
    const incident = activeIncident(work);
    if (!incident) return { ok: false, error: "作品未处于召回拦截状态" };
    if (!incident.replacement) return { ok: false, error: "请先更换合格批次，再补做贴线检查" };
    if (!inspector || !inspector.trim()) return { ok: false, error: "必须填写复检人" };

    const next = clone(work);
    activeIncident(next).reinspection = { at: nowIso, inspector: inspector.trim() };
    return { ok: true, work: next };
  }

  // 两步齐备后才能恢复流转，回到拦截前所处工序
  function resumeWork(work, nowIso) {
    const incident = activeIncident(work);
    if (!incident) return { ok: false, error: "作品未处于召回拦截状态" };
    if (!incident.replacement) return { ok: false, error: "尚未更换合格批次" };
    if (!incident.reinspection) return { ok: false, error: "尚未补做贴线检查" };

    const next = clone(work);
    const target = activeIncident(next);
    target.resumedAt = nowIso;
    next.status = target.previousStatus || "贴线中";
    return { ok: true, work: next };
  }

  global.Recall = {
    REVIEW,
    DELIVERED,
    batchInUse,
    isDelivered,
    isBlocked,
    activeIncident,
    deliveredFlags,
    assess,
    deactivateBatch,
    replaceBatch,
    recordReinspection,
    resumeWork
  };
})(window);
