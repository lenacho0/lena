const ACTIVE_TASK_STATUSES = new Set(["DRAFT", "QUEUED", "RUNNING"]);
const POLL_INTERVAL_MS = 3000;
const TASK_HISTORY_FILTERS = {
  ALL: "all",
  ACTIVE: "active",
  FAILED: "failed",
  RETRYING: "retrying",
};

const state = {
  batches: [],
  selectedBatchId: null,
  selectedBatch: null,
  trackedTaskId: null,
  taskHistoryFilter: TASK_HISTORY_FILTERS.ALL,
  pollingTimer: null,
  pollingInFlight: false,
};

const refs = {
  batchList: document.getElementById("batchList"),
  batchListState: document.getElementById("batchListState"),
  refreshBatchesBtn: document.getElementById("refreshBatchesBtn"),
  globalMessage: document.getElementById("globalMessage"),
  detailEmpty: document.getElementById("detailEmpty"),
  detailContent: document.getElementById("detailContent"),
  batchTitle: document.getElementById("batchTitle"),
  batchStatus: document.getElementById("batchStatus"),
  batchMeta: document.getElementById("batchMeta"),
  scriptTargetCount: document.getElementById("scriptTargetCount"),
  scriptGeneratedCount: document.getElementById("scriptGeneratedCount"),
  failedTaskCount: document.getElementById("failedTaskCount"),
  progressPercent: document.getElementById("progressPercent"),
  productProfileSummary: document.getElementById("productProfileSummary"),
  selectedReferenceSummary: document.getElementById("selectedReferenceSummary"),
  desiredCountInput: document.getElementById("desiredCountInput"),
  triggerTaskBtn: document.getElementById("triggerTaskBtn"),
  stopPollingBtn: document.getElementById("stopPollingBtn"),
  pollingIndicator: document.getElementById("pollingIndicator"),
  taskState: document.getElementById("taskState"),
  taskPayload: document.getElementById("taskPayload"),
  taskHistoryFilter: document.getElementById("taskHistoryFilter"),
  taskHistoryCount: document.getElementById("taskHistoryCount"),
  taskHistory: document.getElementById("taskHistory"),
  scriptsContainer: document.getElementById("scriptsContainer"),
};

class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusClass(status) {
  if (!status) {
    return "";
  }

  if (ACTIVE_TASK_STATUSES.has(status) || status === "GENERATING_SCRIPTS") {
    return "status-active";
  }

  if (status === "SUCCEEDED" || status === "SCRIPTS_READY") {
    return "status-success";
  }

  if (status === "FAILED" || status === "PARTIAL_SUCCESS") {
    return "status-failed";
  }

  return "status-warning";
}

function getScriptTaskList(batch) {
  if (!batch || !Array.isArray(batch.tasks)) {
    return [];
  }

  return batch.tasks.filter((task) => task.taskType === "SCRIPT_GENERATION");
}

function isRetryingTask(task) {
  return ACTIVE_TASK_STATUSES.has(task.status) && Number(task.retryCount ?? 0) > 0;
}

function getTaskHistoryFilter(value) {
  if (value === TASK_HISTORY_FILTERS.ACTIVE) {
    return TASK_HISTORY_FILTERS.ACTIVE;
  }

  if (value === TASK_HISTORY_FILTERS.FAILED) {
    return TASK_HISTORY_FILTERS.FAILED;
  }

  if (value === TASK_HISTORY_FILTERS.RETRYING) {
    return TASK_HISTORY_FILTERS.RETRYING;
  }

  return TASK_HISTORY_FILTERS.ALL;
}

function filterTaskHistory(tasks, filterType) {
  if (filterType === TASK_HISTORY_FILTERS.ACTIVE) {
    return tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  }

  if (filterType === TASK_HISTORY_FILTERS.FAILED) {
    return tasks.filter((task) => task.status === "FAILED");
  }

  if (filterType === TASK_HISTORY_FILTERS.RETRYING) {
    return tasks.filter((task) => isRetryingTask(task));
  }

  return tasks;
}

function getTaskHistoryHighlightClass(task) {
  if (task.status === "FAILED") {
    return "highlight-failed";
  }

  if (isRetryingTask(task)) {
    return "highlight-retrying";
  }

  return "";
}

function getDisplayedTask(batch, taskList = null) {
  const scriptTasks = Array.isArray(taskList) ? taskList : getScriptTaskList(batch);
  if (scriptTasks.length === 0) {
    return null;
  }

  if (state.trackedTaskId) {
    const tracked = scriptTasks.find((task) => task.id === state.trackedTaskId);
    if (tracked) {
      return tracked;
    }
  }

  return scriptTasks[0];
}

function setGlobalMessage(type, message) {
  if (!message) {
    refs.globalMessage.hidden = true;
    refs.globalMessage.textContent = "";
    refs.globalMessage.className = "message";
    return;
  }

  refs.globalMessage.hidden = false;
  refs.globalMessage.textContent = message;
  refs.globalMessage.className = `message ${type}`;
}

function clampDesiredCount(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 1), 50);
}

async function request(path, options = {}) {
  const requestInit = {
    method: options.method ?? "GET",
    headers: {
      ...options.headers,
    },
  };

  if (options.body !== undefined) {
    requestInit.headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, requestInit);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const errorMessage =
      typeof body === "object" && body && "error" in body && body.error?.message
        ? body.error.message
        : `HTTP ${response.status}`;
    throw new ApiError(errorMessage, { status: response.status, body });
  }

  return body;
}

function renderBatchList() {
  refs.batchList.innerHTML = "";

  if (state.batches.length === 0) {
    refs.batchList.innerHTML = '<li class="empty">暂无批次数据</li>';
    return;
  }

  const itemsHtml = state.batches
    .map((batch) => {
      const activeClass = state.selectedBatchId === batch.id ? "active" : "";
      const refText = batch.selectedReferenceVideo
        ? `参考视频：${escapeHtml(batch.selectedReferenceVideo.title)}`
        : "参考视频：未选择";

      return `
        <li class="batch-item">
          <button type="button" data-batch-id="${escapeHtml(batch.id)}" class="${activeClass}">
            <div class="batch-main">
              <span class="batch-name">${escapeHtml(batch.name)}</span>
              <span class="status-badge ${statusClass(batch.status)}">${escapeHtml(batch.status)}</span>
            </div>
            <div class="batch-meta">
              <div>脚本 ${batch.scriptGeneratedCount}/${batch.scriptTargetCount} · 失败 ${batch.failedTaskCount}</div>
              <div>${refText}</div>
            </div>
          </button>
        </li>
      `;
    })
    .join("");

  refs.batchList.innerHTML = itemsHtml;
}

function renderScripts(scripts) {
  if (!Array.isArray(scripts) || scripts.length === 0) {
    refs.scriptsContainer.innerHTML = '<div class="empty-inline">暂无脚本结果</div>';
    return;
  }

  const cardsHtml = scripts
    .map((script) => {
      const tags = Array.isArray(script.generationTags)
        ? script.generationTags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(" ")
        : "";

      return `
        <article class="script-card">
          <div class="script-card-head">
            <strong>#${script.sequenceNo} ${escapeHtml(script.title || "未命名脚本")}</strong>
            <span class="tag">${escapeHtml(script.styleBase || "UNKNOWN")}</span>
          </div>
          <p class="script-text">${escapeHtml(script.scriptText || "")}</p>
          <p class="script-meta">标签：${tags || "-"}</p>
        </article>
      `;
    })
    .join("");

  refs.scriptsContainer.innerHTML = cardsHtml;
}

function renderTask(task) {
  if (!task) {
    refs.taskState.className = "empty-inline";
    refs.taskState.textContent = "暂无脚本生成任务";
    refs.taskPayload.hidden = true;
    refs.taskPayload.textContent = "";
    return;
  }

  refs.taskState.className = "task-state-line";
  refs.taskState.innerHTML = `
    <span class="status-badge ${statusClass(task.status)}">${escapeHtml(task.status)}</span>
    <span>批次 ID：${escapeHtml(task.batchId || "-")}</span>
    <span>类型：${escapeHtml(task.taskType || "-")}</span>
    <span>任务 ID：${escapeHtml(task.id || "-")}</span>
    <span>错误码：${escapeHtml(task.errorCode || "-")}</span>
    <span>错误信息：${escapeHtml(task.errorMessage || "-")}</span>
    <span>重试：${task.retryCount ?? "-"}/${task.maxRetries ?? "-"}</span>
    <span>排队时间：${escapeHtml(formatTime(task.queuedAt))}</span>
    <span>开始时间：${escapeHtml(formatTime(task.startedAt))}</span>
    <span>结束时间：${escapeHtml(formatTime(task.finishedAt))}</span>
    <span>创建时间：${escapeHtml(formatTime(task.createdAt))}</span>
    <span>更新时间：${escapeHtml(formatTime(task.updatedAt))}</span>
  `;

  refs.taskPayload.hidden = false;
  refs.taskPayload.textContent = JSON.stringify(
    {
      id: task.id ?? null,
      batchId: task.batchId ?? null,
      taskType: task.taskType ?? null,
      status: task.status ?? null,
      requestPayload: task.requestPayload ?? null,
      resultPayload: task.resultPayload ?? null,
      errorCode: task.errorCode ?? null,
      errorMessage: task.errorMessage ?? null,
      retryCount: task.retryCount ?? null,
      maxRetries: task.maxRetries ?? null,
      queuedAt: task.queuedAt ?? null,
      startedAt: task.startedAt ?? null,
      finishedAt: task.finishedAt ?? null,
      createdAt: task.createdAt ?? null,
      updatedAt: task.updatedAt ?? null,
    },
    null,
    2,
  );
}

function renderTaskHistory(tasks) {
  const allTasks = Array.isArray(tasks) ? tasks : [];
  const filterType = getTaskHistoryFilter(state.taskHistoryFilter);
  const filteredTasks = filterTaskHistory(allTasks, filterType);
  refs.taskHistoryCount.textContent = `${filteredTasks.length}/${allTasks.length}`;

  if (filteredTasks.length === 0) {
    refs.taskHistory.innerHTML =
      allTasks.length === 0
        ? '<div class="empty-inline">暂无任务历史</div>'
        : '<div class="empty-inline">当前筛选无任务</div>';
    return;
  }

  refs.taskHistory.innerHTML = filteredTasks
    .map((task) => {
      const activeClass = task.id === state.trackedTaskId ? "active" : "";
      const highlightClass = getTaskHistoryHighlightClass(task);

      return `
        <article class="task-history-item">
          <button type="button" data-task-id="${escapeHtml(task.id)}" class="${activeClass} ${highlightClass}">
            <div class="task-history-main">
              <span class="status-badge ${statusClass(task.status)}">${escapeHtml(task.status || "-")}</span>
              <span class="hint">${escapeHtml(formatTime(task.createdAt))}</span>
            </div>
            <div class="task-history-meta">
              <div>ID: ${escapeHtml(task.id || "-")}</div>
              <div>重试: ${task.retryCount ?? "-"}/${task.maxRetries ?? "-"}</div>
              <div>错误: ${escapeHtml(task.errorCode || "-")}</div>
            </div>
          </button>
        </article>
      `;
    })
    .join("");
}

function syncPollingUi(enabled) {
  refs.pollingIndicator.textContent = enabled ? "轮询：开启（3 秒）" : "轮询：关闭";
  refs.stopPollingBtn.disabled = !enabled;
}

function renderBatchDetail() {
  const batch = state.selectedBatch;

  if (!batch) {
    refs.detailEmpty.hidden = false;
    refs.detailContent.hidden = true;
    return;
  }

  refs.detailEmpty.hidden = true;
  refs.detailContent.hidden = false;

  refs.batchTitle.textContent = batch.name;
  refs.batchStatus.textContent = batch.status;
  refs.batchStatus.className = `status-badge ${statusClass(batch.status)}`;
  refs.batchMeta.textContent = `批次 ID: ${batch.id} · 更新时间: ${formatTime(batch.updatedAt)}`;

  refs.scriptTargetCount.textContent = String(batch.scriptTargetCount ?? 0);
  refs.scriptGeneratedCount.textContent = String(batch.scriptGeneratedCount ?? 0);
  refs.failedTaskCount.textContent = String(batch.failedTaskCount ?? 0);
  refs.progressPercent.textContent = `${Number(batch.progressPercent ?? 0)}%`;
  refs.desiredCountInput.value = String(batch.scriptTargetCount ?? 1);

  if (batch.productProfile) {
    refs.productProfileSummary.textContent = `产品：${batch.productProfile.productName || "-"}（${batch.productProfile.productCategory || "未分类"}）`;
  } else {
    refs.productProfileSummary.textContent = "产品资料：未配置（无法触发脚本生成任务）";
  }

  const selectedReference = (batch.referenceVideos || []).find((item) => item.isSelected);
  if (selectedReference?.referenceVideo) {
    refs.selectedReferenceSummary.textContent = `已选参考视频：${selectedReference.referenceVideo.title} / ${selectedReference.referenceVideo.platform}`;
  } else {
    refs.selectedReferenceSummary.textContent = "已选参考视频：未选择（无法触发脚本生成任务）";
  }

  const scriptTasks = getScriptTaskList(batch);
  const filteredTasks = filterTaskHistory(scriptTasks, getTaskHistoryFilter(state.taskHistoryFilter));
  refs.taskHistoryFilter.value = state.taskHistoryFilter;

  if (!filteredTasks.some((item) => item.id === state.trackedTaskId)) {
    state.trackedTaskId = filteredTasks[0]?.id ?? null;
  }

  const task = getDisplayedTask(batch, filteredTasks);
  if (task) {
    state.trackedTaskId = task.id;
  } else {
    state.trackedTaskId = null;
  }

  renderTask(task);
  renderTaskHistory(scriptTasks);
  renderScripts(batch.scripts || []);

  const hasActiveScriptTask = scriptTasks.some((item) => ACTIVE_TASK_STATUSES.has(item.status));
  if (hasActiveScriptTask) {
    startPolling();
  } else {
    stopPolling();
  }
}

async function loadBatchDetail(batchId, { silent = false } = {}) {
  if (!batchId) {
    return;
  }

  if (!silent) {
    refs.batchMeta.textContent = "加载批次详情中...";
  }

  const response = await request(`/api/batches/${batchId}`);
  if (state.selectedBatchId !== batchId) {
    return;
  }

  state.selectedBatch = response.data;
  renderBatchDetail();
}

async function selectBatch(batchId) {
  if (!batchId) {
    return;
  }

  if (state.selectedBatchId !== batchId) {
    stopPolling();
    state.trackedTaskId = null;
  }

  state.selectedBatchId = batchId;
  renderBatchList();

  try {
    await loadBatchDetail(batchId);
    setGlobalMessage("", "");
  } catch (error) {
    state.selectedBatch = null;
    renderBatchDetail();
    setGlobalMessage("error", `加载批次详情失败：${error.message}`);
  }
}

async function loadBatches() {
  refs.batchListState.textContent = "加载中...";

  try {
    const response = await request("/api/batches?page=1&pageSize=50");
    state.batches = response.data ?? [];
    refs.batchListState.textContent = `共 ${state.batches.length} 条`;

    if (state.batches.length === 0) {
      state.selectedBatchId = null;
      state.selectedBatch = null;
      renderBatchList();
      renderBatchDetail();
      return;
    }

    const exists = state.batches.some((batch) => batch.id === state.selectedBatchId);
    const nextId = exists ? state.selectedBatchId : state.batches[0].id;
    await selectBatch(nextId);
  } catch (error) {
    refs.batchListState.textContent = "加载失败";
    setGlobalMessage("error", `加载批次列表失败：${error.message}`);
    state.batches = [];
    renderBatchList();
  }
}

function startPolling() {
  if (state.pollingTimer || !state.selectedBatchId) {
    return;
  }

  syncPollingUi(true);
  state.pollingTimer = window.setInterval(async () => {
    if (state.pollingInFlight || !state.selectedBatchId) {
      return;
    }

    state.pollingInFlight = true;
    try {
      await loadBatchDetail(state.selectedBatchId, { silent: true });
    } catch (error) {
      setGlobalMessage("error", `轮询失败：${error.message}`);
      stopPolling();
    } finally {
      state.pollingInFlight = false;
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (state.pollingTimer) {
    window.clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }

  state.pollingInFlight = false;
  syncPollingUi(false);
}

async function triggerScriptGeneration() {
  if (!state.selectedBatchId) {
    return;
  }

  const batch = state.selectedBatch;
  const fallbackCount = batch?.scriptTargetCount ?? 1;
  const desiredCount = clampDesiredCount(refs.desiredCountInput.value, fallbackCount);

  refs.triggerTaskBtn.disabled = true;

  try {
    const response = await request(`/api/batches/${state.selectedBatchId}/script-generation-tasks`, {
      method: "POST",
      body: {
        desiredCount,
        executionMode: "llm_mvp",
        triggerSource: "mvp_ui",
      },
    });

    const task = response.data?.task ?? null;
    state.trackedTaskId = task?.id ?? null;
    refs.desiredCountInput.value = String(desiredCount);

    const deduplicated = response.data?.deduplicated === true;
    setGlobalMessage(
      "success",
      deduplicated
        ? "检测到相同活动任务，已复用现有任务并开始轮询。"
        : "脚本生成任务已创建，正在轮询任务状态。",
    );

    await loadBatchDetail(state.selectedBatchId);
    if (task && ACTIVE_TASK_STATUSES.has(task.status)) {
      startPolling();
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      setGlobalMessage("error", `触发冲突（409）：${error.message}`);
      try {
        await loadBatchDetail(state.selectedBatchId);
      } catch (refreshError) {
        setGlobalMessage("error", `触发冲突后刷新详情失败：${refreshError.message}`);
      }
      return;
    }

    setGlobalMessage("error", `触发脚本生成失败：${error.message}`);
  } finally {
    refs.triggerTaskBtn.disabled = false;
  }
}

function bindEvents() {
  refs.refreshBatchesBtn.addEventListener("click", () => {
    void loadBatches();
  });

  refs.batchList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-batch-id]");
    if (!button) {
      return;
    }

    const batchId = button.getAttribute("data-batch-id");
    void selectBatch(batchId);
  });

  refs.triggerTaskBtn.addEventListener("click", () => {
    void triggerScriptGeneration();
  });

  refs.stopPollingBtn.addEventListener("click", () => {
    stopPolling();
  });

  refs.taskHistoryFilter.addEventListener("change", (event) => {
    const filterValue = getTaskHistoryFilter(event.target.value);
    state.taskHistoryFilter = filterValue;
    if (state.selectedBatch) {
      renderBatchDetail();
    }
  });

  refs.taskHistory.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-task-id]");
    if (!button || !state.selectedBatch) {
      return;
    }

    const taskId = button.getAttribute("data-task-id");
    if (!taskId) {
      return;
    }

    state.trackedTaskId = taskId;
    const displayedTask = getDisplayedTask(state.selectedBatch);
    renderTask(displayedTask);
    renderTaskHistory(getScriptTaskList(state.selectedBatch));
  });
}

bindEvents();
void loadBatches();
