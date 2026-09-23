/*
 * recall.js —— 召回判断层
 * 只负责线材批次召回的业务规则：批次停用后的拦截判定、已交付标记、
 * 换批留痕、贴线复检通过后恢复流转。不读取 DOM，不碰 localStorage。
 */
(function () {
  "use strict";

  const HELD = "待复核";
  const DELIVERED = "已交付";
  // 未交付、仍在工坊流转的状态
  const FLOW_STATUSES = ["贴线中", "待阴干", "上金粉", "待交付"];
  const STATUSES = FLOW_STATUSES.concat([HELD, DELIVERED]);

  function nowIso() {
    return new Date().toISOString();
  }

  function isBatchActive(batch) {
    return !!batch && batch.status === "active";
  }

  function isDelivered(work) {
    return work.status === DELIVERED;
  }

  function isHeld(work) {
    return work.status === HELD;
  }

  // 作品是否正使用某个批次（旧批次已换走后不再受该批次拦截）
  function usesBatch(work, batchId) {
    return work.batch && work.batch.id === batchId;
  }

  function batchSnapshot(batch, assignedAt) {
    return {
      id: batch.id,
      code: batch.code,
      supplier: batch.supplier,
      spec: batch.spec,
      assignedAt: assignedAt || nowIso()
    };
  }

  function createBatch(input) {
    if (!input || !input.code || !input.code.trim()) {
      return { ok: false, error: "批次号不能为空" };
    }
    if (!input.supplier || !input.supplier.trim()) {
      return { ok: false, error: "供应商不能为空" };
    }
    return {
      ok: true,
      batch: {
        id: crypto.randomUUID(),
        code: input.code.trim(),
        supplier: input.supplier.trim(),
        spec: input.spec || "中线",
        status: "active",
        registeredAt: nowIso(),
        stoppedAt: null,
        stopReason: ""
      }
    };
  }

  /**
   * 停用（召回）一个批次。
   * - 未交付且仍在用该批次的作品：停在「待复核」，记下召回；
   * - 已交付作品：保留原结果，只标出受影响，不改变状态；
   * - 已换批的作品：不再受本次召回影响；
   * - 重复停用同一批次视为幂等，不产生重复召回记录。
   */
  function applyRecall(payload) {
    const batches = payload.batches || [];
    const works = payload.works || [];
    const batch = batches.find(b => b.id === payload.batchId);
    if (!batch) return { ok: false, error: "批次不存在" };

    const alreadyStopped = batch.status === "stopped";
    if (!alreadyStopped) {
      batch.status = "stopped";
      batch.stoppedAt = nowIso();
      batch.stopReason = (payload.reason || "").trim();
    }

    const affected = [];
    const held = [];
    const notes = [];

    works.forEach(work => {
      if (!usesBatch(work, batch.id)) return;
      // 已存在同一批次的召回记录（幂等 / 对账场景），不重复拦截
      if ((work.recalls || []).some(r => r.batchId === batch.id)) return;

      const entry = {
        id: crypto.randomUUID(),
        batchId: batch.id,
        batchCode: batch.code,
        reason: batch.stopReason,
        recalledAt: batch.stoppedAt || nowIso(),
        kind: isDelivered(work) ? "delivered" : "held",
        status: isDelivered(work) ? "affected" : "pending"
      };

      work.recalls = (work.recalls || []).concat(entry);

      if (entry.kind === "delivered") {
        affected.push(work);
        notes.push(`${entry.recalledAt} 交付后标记：批次 ${batch.code} 已停用（${entry.reason || "供应商召回"}）`);
      } else {
        work.pausedStatus = work.status;
        work.pausedAt = entry.recalledAt;
        work.status = HELD;
        held.push(work);
        notes.push(`${entry.recalledAt} 召回拦截：批次 ${batch.code} 停用（${entry.reason || "供应商召回"}），停在待复核`);
      }
      work.logs = (work.logs || []).concat(notes[notes.length - 1]);
    });

    return {
      ok: true,
      batch,
      held,
      affected,
      alreadyStopped,
      // 受影响作品总数（含已交付），供页面提示
      affectedCount: held.length + affected.length
    };
  }

  /**
   * 更换合格批次：必须留下旧批次、替换时间和复核人。
   * 只登记换批结果，作品仍停在待复核；要等贴线检查补做通过后才能恢复流转。
   */
  function applyBatchReplacement(payload) {
    const work = payload.work;
    const batches = payload.batches || [];
    const newBatch = batches.find(b => b.id === payload.newBatchId);
    const reviewer = (payload.reviewer || "").trim();

    if (!work) return { ok: false, error: "作品不存在" };
    if (!isHeld(work)) return { ok: false, error: "作品不在待复核状态，不能换批" };
    const recall = (work.recalls || []).find(r => r.status === "pending" && usesBatch(work, r.batchId));
    if (!recall) return { ok: false, error: "没有待处理的召回记录" };
    if (!newBatch) return { ok: false, error: "请选择新批次" };
    if (newBatch.id === recall.batchId) return { ok: false, error: "新批次不能仍是被召回批次" };
    if (!isBatchActive(newBatch)) return { ok: false, error: `批次 ${newBatch.code} 已停用，不能替换为该批次` };
    if (!reviewer) return { ok: false, error: "请填写复核人" };

    const replacedAt = nowIso();
    const oldBatch = work.batch;

    // 批次沿革：旧批次记录始终保留，只向历史追加
    work.batchHistory = (work.batchHistory || []).concat({
      batchId: oldBatch.id,
      batchCode: oldBatch.code,
      supplier: oldBatch.supplier,
      spec: oldBatch.spec,
      assignedAt: oldBatch.assignedAt,
      replacedAt: replacedAt,
      recallId: recall.id,
      reviewer: reviewer
    });
    work.batch = batchSnapshot(newBatch, replacedAt);

    recall.replacement = {
      oldBatchId: oldBatch.id,
      oldBatchCode: oldBatch.code,
      newBatchId: newBatch.id,
      newBatchCode: newBatch.code,
      replacedAt: replacedAt,
      reviewer: reviewer
    };
    recall.status = "replaced";
    work.logs = (work.logs || []).concat(
      `${replacedAt} 换批：${oldBatch.code} → ${newBatch.code}，复核人 ${reviewer}，待补做贴线检查`
    );

    return { ok: true, work, recall };
  }

  /**
   * 补做贴线检查并通过后，恢复到召回前的流转状态。
   * 未换批或检查不通过时不得恢复。
   */
  function applyLineCheck(payload) {
    const work = payload.work;
    const inspector = (payload.inspector || "").trim();
    const passed = payload.passed !== false;
    const note = (payload.note || "").trim();

    if (!work) return { ok: false, error: "作品不存在" };
    if (!isHeld(work)) return { ok: false, error: "作品不在待复核状态" };
    const recall = (work.recalls || []).find(r => r.status === "replaced");
    if (!recall) return { ok: false, error: "尚未更换合格批次" };
    if (!passed) return { ok: false, error: "贴线检查未通过，继续停在待复核" };
    if (!inspector) return { ok: false, error: "请填写检查人" };

    const checkedAt = nowIso();
    recall.status = "resolved";
    recall.resolution = {
      checkedAt: checkedAt,
      inspector: inspector,
      note: note,
      restoredStatus: work.pausedStatus
    };
    work.logs = (work.logs || []).concat(
      `${checkedAt} 贴线检查通过（检查人 ${inspector}${note ? "：" + note : ""}），恢复到 ${work.pausedStatus}`
    );
    // 恢复召回前的流转状态；旧批次记录与召回记录全部保留
    work.status = work.pausedStatus;
    work.pausedStatus = null;
    work.pausedAt = null;

    return { ok: true, work, recall };
  }

  /**
   * 确认交付。待复核中的作品不能交付，必须先换批并通过贴线检查。
   */
  function markDelivered(payload) {
    const work = payload.work;
    if (!work) return { ok: false, error: "作品不存在" };
    if (isDelivered(work)) return { ok: false, error: "作品已交付" };
    if (isHeld(work)) return { ok: false, error: "作品处于召回待复核，不能交付" };
    work.status = DELIVERED;
    work.deliveredAt = nowIso();
    work.logs = (work.logs || []).concat(`${work.deliveredAt} 确认交付`);
    return { ok: true, work };
  }

  // 看板状态流转前的拦截
  function canChangeStatus(work, next) {
    if (isHeld(work)) {
      return { ok: false, error: "召回待复核：先换批并补做贴线检查" };
    }
    if (isDelivered(work)) {
      return { ok: false, error: "已交付作品结果锁定" };
    }
    if (next === HELD) return { ok: false, error: "待复核只能由批次召回触发" };
    return { ok: true };
  }

  // 当前待处理的召回（未交付拦截）
  function pendingRecall(work) {
    if (!work.recalls) return null;
    return work.recalls.find(r => r.kind === "held" && r.status !== "resolved") || null;
  }

  // 交付后被标出受影响的召回
  function deliveredRecall(work) {
    if (!work.recalls) return null;
    return work.recalls.find(r => r.kind === "delivered") || null;
  }

  // 作品被拦/恢复的说明，供列表展示「为何被拦、何时恢复」
  function holdSummary(work) {
    const held = (work.recalls || []).filter(r => r.kind === "held");
    return held.map(r => {
      const reason = `${r.batchCode} 停用${r.reason ? "（" + r.reason + "）" : ""}`;
      const from = `拦于 ${r.recalledAt}`;
      if (r.status === "resolved" && r.resolution) {
        return `${reason}；${from}，${r.resolution.checkedAt} 贴线复检通过，恢复 ${r.resolution.restoredStatus}`;
      }
      if (r.status === "replaced") {
        const rep = r.replacement;
        return `${reason}；${from}，已换 ${rep.newBatchCode}（${rep.replacedAt}，复核人 ${rep.reviewer}），待贴线检查`;
      }
      return `${reason}；${from}，停在待复核`;
    });
  }

  window.Recall = {
    HELD,
    DELIVERED,
    FLOW_STATUSES,
    STATUSES,
    nowIso,
    isBatchActive,
    isDelivered,
    isHeld,
    usesBatch,
    batchSnapshot,
    createBatch,
    applyRecall,
    applyBatchReplacement,
    applyLineCheck,
    markDelivered,
    canChangeStatus,
    pendingRecall,
    deliveredRecall,
    holdSummary
  };
})();
