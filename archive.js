/*
 * archive.js —— 作品存档层
 * 负责 localStorage 读写、旧版本数据兼容。批次沿革（batchHistory）和
 * 召回记录（recalls）始终原样保留，任何页面操作都不删除这些历史。
 */
(function () {
  "use strict";

  const WORK_KEY = "zfl42Works";
  const BATCH_KEY = "zfl42Batches";
  const SCHEMA_VERSION = 2;

  function normalizeWork(work) {
    // 旧版本作品没有批次与召回字段，补齐但不臆造批次
    return Object.assign(
      {
        batch: null,
        batchHistory: [],
        recalls: [],
        pausedStatus: null,
        pausedAt: null,
        deliveredAt: null
      },
      work,
      {
        batchHistory: Array.isArray(work.batchHistory) ? work.batchHistory : [],
        recalls: Array.isArray(work.recalls) ? work.recalls : [],
        logs: Array.isArray(work.logs) ? work.logs : []
      }
    );
  }

  function normalizeBatch(batch) {
    return Object.assign(
      { status: "active", stoppedAt: null, stopReason: "" },
      batch
    );
  }

  function buildSeed() {
    const R = window.Recall;
    // 固定基准时间，避免演示数据每次加载都变
    const base = "2026-09-23T09:00:00.000Z";

    const batches = [
      { id: "b-2606", code: "QX-2606", supplier: "同安线材坊", spec: "细线", status: "active", registeredAt: base, stoppedAt: null, stopReason: "" },
      { id: "b-2608", code: "QX-2608", supplier: "同安线材坊", spec: "混合线", status: "active", registeredAt: base, stoppedAt: null, stopReason: "" },
      { id: "b-2512", code: "QX-2512", supplier: "海沧漆线行", spec: "中线", status: "stopped", registeredAt: base, stoppedAt: "2026-09-22T10:00:00.000Z", stopReason: "含胶量不达标" },
      { id: "b-2609", code: "QX-2609", supplier: "集美线材坊", spec: "细线", status: "active", registeredAt: base, stoppedAt: null, stopReason: "" },
      { id: "b-2503", code: "QX-2503", supplier: "海沧漆线行", spec: "粗线", status: "stopped", registeredAt: base, stoppedAt: "2026-09-20T15:00:00.000Z", stopReason: "供应商停产该型号" }
    ];

    const works = [
      {
        id: crypto.randomUUID(),
        base: "木胎香盒", theme: "海水江崖", line: "细线", progress: 70,
        dryDate: "2026-09-23", gold: "未处理", defect: "",
        delivery: "2026-09-26", status: "待阴干",
        note: "边线需保持低浮雕感",
        batch: R.batchSnapshot(batches[0], base),
        logs: ["2026-09-21 09:00 创建作品"]
      },
      {
        id: crypto.randomUUID(),
        base: "竹胎笔筒", theme: "云雷纹", line: "中线", progress: 40,
        dryDate: "2026-09-25", gold: "未处理", defect: "",
        delivery: "2026-09-30", status: "贴线中",
        note: "",
        batch: R.batchSnapshot(batches[2], base),
        logs: ["2026-09-21 09:00 创建作品"]
      },
      {
        id: crypto.randomUUID(),
        base: "脱胎盘", theme: "折枝梅", line: "混合线", progress: 95,
        dryDate: "2026-09-20", gold: "试扫粉", defect: "左侧枝干翘线",
        delivery: "2026-09-22", status: "待交付",
        note: "客户要求金粉偏暗",
        batch: R.batchSnapshot(batches[1], base),
        logs: ["2026-09-19 09:00 创建作品", "2026-09-20 记录翘线"]
      },
      {
        id: crypto.randomUUID(),
        base: "瓷胎插屏", theme: "双龙戏珠", line: "细线", progress: 100,
        dryDate: "2026-09-15", gold: "已上金粉", defect: "",
        delivery: "2026-09-18", status: "已交付",
        note: "已装箱发出", deliveredAt: "2026-09-18T16:00:00.000Z",
        batch: R.batchSnapshot(batches[3], base),
        logs: ["2026-09-10 09:00 创建作品", "2026-09-18 16:00 确认交付"]
      },
      {
        id: crypto.randomUUID(),
        base: "木胎挂屏", theme: "松鹤延年", line: "粗线", progress: 100,
        dryDate: "2026-09-12", gold: "已上金粉", defect: "",
        delivery: "2026-09-16", status: "已交付",
        note: "", deliveredAt: "2026-09-16T14:00:00.000Z",
        batch: R.batchSnapshot(batches[4], base),
        logs: ["2026-09-08 09:00 创建作品", "2026-09-16 14:00 确认交付"]
      }
    ].map(normalizeWork);

    // 用召回判断层生成真实拦截/标记状态
    R.applyRecall({ batches, works, batchId: "b-2512", reason: "含胶量不达标" });
    R.applyRecall({ batches, works, batchId: "b-2503", reason: "供应商停产该型号" });

    return { batches, works };
  }

  function load() {
    let batches = JSON.parse(localStorage.getItem(BATCH_KEY) || "null");
    let works = JSON.parse(localStorage.getItem(WORK_KEY) || "null");

    // 首次使用（或仅有旧版作品数据）时落入演示数据
    if (!Array.isArray(batches) || !Array.isArray(works)) {
      const legacy = JSON.parse(localStorage.getItem(WORK_KEY) || "null");
      if (Array.isArray(legacy) && !Array.isArray(batches)) {
        // 旧版本：保留原作品，批次留空，由页面提示补登记
        batches = [];
        works = legacy.map(normalizeWork);
      } else {
        const seed = buildSeed();
        batches = seed.batches;
        works = seed.works;
      }
      persist(batches, works);
    }

    return {
      version: SCHEMA_VERSION,
      batches: batches.map(normalizeBatch),
      works: works.map(normalizeWork)
    };
  }

  function persist(batches, works) {
    localStorage.setItem(BATCH_KEY, JSON.stringify(batches));
    localStorage.setItem(WORK_KEY, JSON.stringify(works));
  }

  function saveBatches(batches) {
    localStorage.setItem(BATCH_KEY, JSON.stringify(batches));
  }

  function saveWorks(works) {
    localStorage.setItem(WORK_KEY, JSON.stringify(works));
  }

  function reset() {
    localStorage.removeItem(BATCH_KEY);
    localStorage.removeItem(WORK_KEY);
  }

  window.Archive = {
    WORK_KEY,
    BATCH_KEY,
    normalizeWork,
    normalizeBatch,
    load,
    persist,
    saveBatches,
    saveWorks,
    reset
  };
})();
