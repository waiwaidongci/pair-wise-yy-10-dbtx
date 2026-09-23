/*
 * 作品存档层：localStorage 读写、旧数据迁移、种子数据。
 * 不做召回判断，也不操作页面；只保证记录“只增不删”。
 */
(function (global) {
  "use strict";

  const WORKS_KEY = "zfl42Works";
  const BATCHES_KEY = "zfl42Batches";
  const today = new Date().toISOString().slice(0, 10);

  function seedBatches() {
    return [
      {
        id: "B2026-01",
        code: "漆线 B2026-01",
        supplier: "安溪合股漆线坊",
        receivedAt: "2026-05-12",
        active: true
      },
      {
        id: "B2026-02",
        code: "漆线 B2026-02",
        supplier: "安溪合股漆线坊",
        receivedAt: "2026-06-08",
        active: true
      },
      {
        id: "B2025-09",
        code: "漆线 B2025-09",
        supplier: "永春老号线铺",
        receivedAt: "2025-11-30",
        active: true
      }
    ];
  }

  function seedWorks(currentId) {
    const now = new Date().toLocaleString();
    return [
      {
        id: crypto.randomUUID(), base: "木胎香盒", theme: "海水江崖", line: "细线", progress: 70,
        dryDate: today, gold: "未处理", defect: "", delivery: "2026-06-26", status: "待阴干",
        note: "边线需保持低浮雕感", logs: ["创建作品"],
        batchId: currentId, currentBatchId: currentId, batchAssignedAt: now,
        batchHistory: [], recallIncidents: []
      },
      {
        id: crypto.randomUUID(), base: "脱胎盘", theme: "折枝梅", line: "混合线", progress: 95,
        dryDate: "2026-06-20", gold: "试扫粉", defect: "左侧枝干翘线", delivery: "2026-06-23",
        status: "上金粉", note: "客户要求金粉偏暗", logs: ["创建作品", "记录翘线"],
        batchId: currentId, currentBatchId: currentId, batchAssignedAt: now,
        batchHistory: [], recallIncidents: []
      },
      {
        id: crypto.randomUUID(), base: "竹胎笔筒", theme: "云雷纹", line: "中线", progress: 40,
        dryDate: "2026-06-24", gold: "未处理", defect: "", delivery: "2026-06-30",
        status: "贴线中", note: "", logs: ["创建作品"],
        batchId: "B2025-09", currentBatchId: "B2025-09", batchAssignedAt: now,
        batchHistory: [], recallIncidents: []
      },
      {
        id: crypto.randomUUID(), base: "脱胎花瓶", theme: "缠枝莲", line: "细线", progress: 100,
        dryDate: "2026-05-28", gold: "已上金粉", defect: "", delivery: "2026-06-10",
        status: "已交付", note: "已入客户展柜", logs: ["创建作品", "交付客户"],
        batchId: "B2025-09", currentBatchId: "B2025-09", batchAssignedAt: now,
        batchHistory: [], recallIncidents: []
      }
    ];
  }

  function loadBatches() {
    const stored = JSON.parse(localStorage.getItem(BATCHES_KEY) || "null");
    if (stored && Array.isArray(stored.batches)) return stored;
    const batches = seedBatches();
    const state = { currentId: batches[0].id, batches };
    localStorage.setItem(BATCHES_KEY, JSON.stringify(state));
    return state;
  }

  function loadWorks(batchesState) {
    const stored = JSON.parse(localStorage.getItem(WORKS_KEY) || "null");

    // 兼容旧版存档：旧作品补上建档批次与召回档案字段
    if (stored && Array.isArray(stored)) {
      const migrated = stored.map(w => Object.assign({
        batchId: batchesState.currentId,
        currentBatchId: batchesState.currentId,
        batchAssignedAt: "历史数据迁移",
        batchHistory: [],
        recallIncidents: []
      }, w));
      localStorage.setItem(WORKS_KEY, JSON.stringify(migrated));
      return migrated;
    }

    const works = seedWorks(batchesState.currentId);
    localStorage.setItem(WORKS_KEY, JSON.stringify(works));
    return works;
  }

  function saveWorks(works) {
    localStorage.setItem(WORKS_KEY, JSON.stringify(works));
  }

  function saveBatches(state) {
    localStorage.setItem(BATCHES_KEY, JSON.stringify(state));
  }

  global.Archive = {
    WORKS_KEY,
    BATCHES_KEY,
    loadBatches,
    loadWorks,
    saveWorks,
    saveBatches
  };
})(window);
