const API_BASE_URL = "";

const loginOpenButton = document.querySelector("#loginOpenButton");
const logoutButton = document.querySelector("#logoutButton");
const loginModal = document.querySelector("#loginModal");
const loginBackdrop = document.querySelector("#loginBackdrop");
const loginCloseButton = document.querySelector("#loginCloseButton");
const showLoginButton = document.querySelector("#showLoginButton");
const showSignupButton = document.querySelector("#showSignupButton");
const authTitle = document.querySelector("#authTitle");
const authHelp = document.querySelector("#authHelp");
const loginForm = document.querySelector("#loginForm");
const signupForm = document.querySelector("#signupForm");
const emailInput = document.querySelector("#emailInput");
const passwordInput = document.querySelector("#passwordInput");
const signupEmailInput = document.querySelector("#signupEmailInput");
const signupPasswordInput = document.querySelector("#signupPasswordInput");
const signupNameInput = document.querySelector("#signupNameInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const fileTabButton = document.querySelector("#fileTabButton");
const historyTabButton = document.querySelector("#historyTabButton");
const uploadPanel = document.querySelector("#uploadPanel");
const historyPanel = document.querySelector("#historyPanel");
const historyRefreshButton = document.querySelector("#historyRefreshButton");
const historyLoginButton = document.querySelector("#historyLoginButton");
const historyLoginNotice = document.querySelector("#historyLoginNotice");
const historyLoading = document.querySelector("#historyLoading");
const historyEmpty = document.querySelector("#historyEmpty");
const historyTable = document.querySelector("#historyTable");
const historyTableBody = document.querySelector("#historyTableBody");
const fileInput = document.querySelector("#fileInput");
const selectedFileName = document.querySelector("#selectedFileName");
const analyzeButton = document.querySelector("#analyzeButton");
const requestSummary = document.querySelector("#requestSummary");
const resultCard = document.querySelector("#resultCard");
const paidUsageSection = document.querySelector("#paidUsageSection");
const usageCards = document.querySelector("#usageCards");

let activeUser = null;
let selectedFile = null;
let guestUsageCount = Number(localStorage.getItem("svg_guest_usage_count") || "0");

const GUEST_USAGE_LIMIT = 3;

const queueLabels = {
  FREE_QUEUE: "일반 분석 대기열",
  PAID_QUEUE: "우선 분석 대기열"
};

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatMs(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${formatNumber(value)} ms`;
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return `${Math.round(Number(value) * 100)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("ko-KR");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isSignedInUser() {
  return Boolean(
    activeUser &&
      activeUser.access_token &&
      activeUser.display_name !== "비로그인 체험 사용자"
  );
}

function showMessage(message, isError = true) {
  loginMessage.textContent = message;
  loginMessage.style.color = isError ? "#c43737" : "#0f8a5f";
}

function setAuthMode(mode) {
  const isSignup = mode === "signup";
  signupForm.classList.toggle("hidden", !isSignup);
  loginForm.classList.toggle("hidden", isSignup);
  showSignupButton.classList.toggle("active", isSignup);
  showLoginButton.classList.toggle("active", !isSignup);
  authTitle.textContent = isSignup
    ? "SecureVoiceGuard 회원가입"
    : "SecureVoiceGuard 로그인";
  authHelp.textContent = isSignup
    ? "무료 계정을 만들면 비로그인 체험 제한 없이 기본 분석 기능을 사용할 수 있습니다."
    : "비로그인 상태에서도 바로 분석을 체험할 수 있습니다. 더 많은 분석과 고객사 대시보드는 계정 로그인 후 사용할 수 있습니다.";
  loginMessage.textContent = "";
}

function openLoginModal(mode = "login") {
  setAuthMode(mode);
  loginModal.classList.remove("hidden");
  if (mode === "signup") {
    signupEmailInput.focus();
  } else {
    emailInput.focus();
  }
}

function closeLoginModal() {
  loginModal.classList.add("hidden");
}

function clearResultPanels() {
  requestSummary.classList.add("hidden");
  resultCard.classList.add("hidden");
  requestSummary.innerHTML = "";
  resultCard.innerHTML = "";
}

function setWorkspaceTab(tabName) {
  const showHistory = tabName === "history";

  fileTabButton.classList.toggle("active", !showHistory);
  historyTabButton.classList.toggle("active", showHistory);
  fileTabButton.setAttribute("aria-selected", String(!showHistory));
  historyTabButton.setAttribute("aria-selected", String(showHistory));
  uploadPanel.classList.toggle("hidden", showHistory);
  historyPanel.classList.toggle("hidden", !showHistory);

  if (showHistory) {
    loadMyRequests();
  }
}

function resetHistoryPanel() {
  historyLoginNotice.classList.add("hidden");
  historyLoading.classList.add("hidden");
  historyEmpty.classList.add("hidden");
  historyTable.classList.add("hidden");
  historyTableBody.innerHTML = "";
}

async function requestJson(url, options = {}) {
  const isFormData = options.body instanceof FormData;

  const authHeaders =
    activeUser && activeUser.access_token
      ? { Authorization: `Bearer ${activeUser.access_token}` }
      : {};

  const response = await fetch(url, {
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...authHeaders,
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.detail || "요청 처리 중 오류가 발생했습니다.");
  }

  return data;
}

function setUser(user, options = {}) {
  activeUser = user;
  const isGuest = user.display_name === "비로그인 체험 사용자";
  currentUser.classList.remove("hidden");
  currentUser.innerHTML = renderCurrentUserMessage(user);
  loginOpenButton.innerHTML = `
    <span class="login-icon" aria-hidden="true">◎</span>
    ${isGuest ? "Sign in" : user.display_name}
  `;
  logoutButton.classList.toggle("hidden", isGuest);

  if (!options.silent) {
    showMessage("로그인되었습니다.", false);
    closeLoginModal();
  }

  renderRoleSpecificPanels();

  if (!historyPanel.classList.contains("hidden")) {
    loadMyRequests();
  }
}

function renderCurrentUserMessage(user) {
  if (user.display_name === "비로그인 체험 사용자") {
    const remaining = Math.max(GUEST_USAGE_LIMIT - guestUsageCount, 0);
    return `
      <strong>비로그인 체험 모드</strong><br />
      오늘 남은 체험 분석 ${remaining}회 · 더 많은 분석은 로그인 후 이용할 수 있습니다.
    `;
  }

  if (user.display_name === "유료 고객") {
    return `
      <strong>유료 고객 계정</strong><br />
      우선 분석과 고객사 사용량 대시보드를 사용할 수 있습니다.
    `;
  }

  return `
    <strong>${user.display_name}</strong><br />
    기본 분석 기능을 사용할 수 있습니다.
  `;
}

loginOpenButton.addEventListener("click", () => openLoginModal("login"));
logoutButton.addEventListener("click", async () => {
  clearResultPanels();
  paidUsageSection.classList.add("hidden");
  usageCards.innerHTML = "";
  await initializeGuestSession();
});
loginBackdrop.addEventListener("click", closeLoginModal);
loginCloseButton.addEventListener("click", closeLoginModal);
showLoginButton.addEventListener("click", () => setAuthMode("login"));
showSignupButton.addEventListener("click", () => setAuthMode("signup"));
fileTabButton.addEventListener("click", () => setWorkspaceTab("file"));
historyTabButton.addEventListener("click", () => setWorkspaceTab("history"));
historyRefreshButton.addEventListener("click", () => loadMyRequests());
historyLoginButton.addEventListener("click", () => openLoginModal("login"));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLoginModal();
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearResultPanels();

  try {
    const user = await requestJson(`${API_BASE_URL}/api/login`, {
      method: "POST",
      body: JSON.stringify({
        email: emailInput.value.trim(),
        password: passwordInput.value
      })
    });

    setUser(user);
  } catch (error) {
    showMessage(error.message);
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearResultPanels();

  try {
    // 실제 구현 시 Cognito 또는 회원 DB API로 가입 요청
    const user = await requestJson(`${API_BASE_URL}/api/signup`, {
      method: "POST",
      body: JSON.stringify({
        email: signupEmailInput.value.trim(),
        password: signupPasswordInput.value,
        display_name: signupNameInput.value.trim() || "무료 사용자"
      })
    });

    emailInput.value = signupEmailInput.value.trim();
    passwordInput.value = signupPasswordInput.value;
    signupForm.reset();
    setUser(user);
  } catch (error) {
    showMessage(error.message);
  }
});

const dropZone = document.querySelector(".drop-zone");

dropZone.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  selectedFile = fileInput.files[0] || null;
  selectedFileName.textContent = selectedFile
    ? `선택한 파일: ${selectedFile.name}`
    : "선택된 파일이 없습니다.";
});

analyzeButton.addEventListener("click", async () => {
  if (!activeUser) {
    showMessage("체험 세션을 준비 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  if (!selectedFile) {
    showMessage("분석할 음성 파일을 선택해주세요.");
    return;
  }

  if (
    activeUser.display_name === "비로그인 체험 사용자" &&
    guestUsageCount >= GUEST_USAGE_LIMIT
  ) {
    openLoginModal("signup");
    showMessage("비로그인 체험 분석 횟수를 모두 사용했습니다. 무료 계정을 만들고 계속 이용해주세요.");
    return;
  }

  analyzeButton.disabled = true;
  analyzeButton.textContent = "Analyzing...";
  clearResultPanels();

  try {
    // 실제 구현 시 S3 Presigned URL 발급 API 호출 후 S3 직접 업로드
    const formData = new FormData();
    formData.append("file", selectedFile);

    const request = await requestJson(`${API_BASE_URL}/api/analysis/request`, {
      method: "POST",
      body: formData
    });

    if (activeUser.display_name === "비로그인 체험 사용자") {
      guestUsageCount += 1;
      localStorage.setItem("svg_guest_usage_count", String(guestUsageCount));
      currentUser.innerHTML = renderCurrentUserMessage(activeUser);
    }

    renderRequestSummary(request);
    await pollAnalysisResult(request.request_id);

    if (!historyPanel.classList.contains("hidden") && isSignedInUser()) {
      await loadMyRequests();
    }
  } catch (error) {
    resultCard.classList.remove("hidden");
    resultCard.innerHTML = `
      <h2>분석 요청 실패</h2>
      <p class="message">${error.message}</p>
    `;
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.textContent = "Analyze";
  }
});

function renderRequestSummary(request) {
  requestSummary.classList.remove("hidden");
  requestSummary.innerHTML = `
    <h2>분석 접수 정보</h2>
    <div class="summary-list">
      <div class="row"><span>요청 ID</span><strong>${request.request_id}</strong></div>
      <div class="row"><span>분석 경로</span><strong>${queueLabels[request.queue_type]}</strong></div>
      <div class="row"><span>접수 시각</span><strong>${new Date(request.created_at).toLocaleString("ko-KR")}</strong></div>
    </div>
  `;

  resultCard.classList.remove("hidden");
  resultCard.innerHTML = `
    <h2>분석 진행</h2>
    <p>분석이 진행 중입니다. 결과가 준비되면 자동으로 표시됩니다.</p>
  `;
}

async function pollAnalysisResult(requestId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));

    // 실제 구현 시 GET /api/analysis/{request_id}/result 호출
    const result = await requestJson(
      `${API_BASE_URL}/api/analysis/${requestId}/result`
    );

    if (result.status === "FAILED" || result.result) {
      renderAnalysisResult(result);
      return;
    }
  }

  resultCard.classList.remove("hidden");
  resultCard.innerHTML = `
    <h2>분석 지연</h2>
    <p>결과 조회 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.</p>
  `;
}

function renderAnalysisResult(result) {
  const isSuccess = result.status === "SUCCESS";
  const confidence = result.confidence ? `${Math.round(result.confidence * 100)}%` : "-";

  resultCard.classList.remove("hidden");
  resultCard.innerHTML = `
    <h2>분석 결과</h2>
    <div class="result-list">
      <div class="row">
        <span>상태</span>
        <strong class="status-pill ${isSuccess ? "status-success" : "status-failed"}">
          ${result.status}
        </strong>
      </div>
      ${
        isSuccess
          ? `<div class="row"><span>판정 결과</span><strong>${result.result}</strong></div>`
          : `<div class="row"><span>실패 사유</span><strong>mock 분석 처리 중 오류가 발생했습니다.</strong></div>`
      }
      <div class="row"><span>신뢰도</span><strong>${confidence}</strong></div>
      <div class="row"><span>모델 버전</span><strong>${result.model_version}</strong></div>
      <div class="row"><span>처리 시간</span><strong>${formatMs(result.processing_time_ms)}</strong></div>
      <div class="row"><span>요청 ID</span><strong>${result.request_id}</strong></div>
    </div>
  `;
}

async function loadMyRequests() {
  resetHistoryPanel();

  if (!isSignedInUser()) {
    historyLoginNotice.classList.remove("hidden");
    openLoginModal("login");
    showMessage("로그인 후 내가 올린 분석 이력을 조회할 수 있습니다.");
    return;
  }

  historyLoading.classList.remove("hidden");

  try {
    const requests = await requestJson(`${API_BASE_URL}/api/requests?limit=20`);
    historyLoading.classList.add("hidden");

    if (!Array.isArray(requests) || requests.length === 0) {
      historyEmpty.classList.remove("hidden");
      return;
    }

    historyTable.classList.remove("hidden");
    historyTableBody.innerHTML = requests
      .map((request) => {
        const status = request.status || "-";
        const normalizedStatus = status === "SUCCEEDED" ? "SUCCESS" : status;
        const label = request.label ? String(request.label).toUpperCase() : request.result || "-";

        return `
          <tr>
            <td class="request-id-cell">${escapeHtml(request.request_id)}</td>
            <td><span class="status-pill ${normalizedStatus === "SUCCESS" ? "status-success" : ""}">${escapeHtml(normalizedStatus)}</span></td>
            <td>${escapeHtml(label)}</td>
            <td>${formatPercent(request.confidence)}</td>
            <td>${formatDateTime(request.created_at)}</td>
            <td>
              <button class="history-result-button" type="button" data-request-id="${escapeHtml(request.request_id)}">
                결과 보기
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (error) {
    historyLoading.classList.add("hidden");
    historyEmpty.classList.remove("hidden");
    historyEmpty.textContent = error.message;
  }
}

historyTableBody.addEventListener("click", async (event) => {
  const button = event.target.closest(".history-result-button");
  if (!button) {
    return;
  }

  const requestId = button.dataset.requestId;
  if (!requestId) {
    return;
  }

  clearResultPanels();
  button.disabled = true;
  button.textContent = "조회 중...";

  try {
    const result = await requestJson(`${API_BASE_URL}/api/analysis/${requestId}/result`);
    renderAnalysisResult(result);
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    resultCard.classList.remove("hidden");
    resultCard.innerHTML = `
      <h2>결과 조회 실패</h2>
      <p class="message">${escapeHtml(error.message)}</p>
    `;
  } finally {
    button.disabled = false;
    button.textContent = "결과 보기";
  }
});

async function renderRoleSpecificPanels() {
  paidUsageSection.classList.add("hidden");
  usageCards.innerHTML = "";

  if (!activeUser) {
    return;
  }

  if (activeUser.display_name === "유료 고객" && activeUser.tenant_id) {
    await loadUsage(activeUser.tenant_id);
  }
}

async function loadUsage(tenantId) {
  try {
    // 실제 구현 시 GET /api/usage/{tenant_id} 호출
    const usage = await requestJson(`${API_BASE_URL}/api/usage/${tenantId}`);
    paidUsageSection.classList.remove("hidden");
    usageCards.innerHTML = `
      ${metricCard("고객사", usage.tenant_display_name)}
      ${metricCard("이번 달 분석 요청 수", formatNumber(usage.monthly_request_count))}
      ${metricCard("성공 건수", formatNumber(usage.success_count))}
      ${metricCard("실패 건수", formatNumber(usage.failed_count))}
      ${metricCard("평균 처리 시간", formatMs(usage.average_processing_time_ms))}
    `;
  } catch (error) {
    paidUsageSection.classList.remove("hidden");
    usageCards.innerHTML = metricCard("사용량 조회", error.message);
  }
}

function metricCard(label, value) {
  return `
    <div class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

async function initializeGuestSession() {
  try {
    const user = await requestJson(`${API_BASE_URL}/api/guest`, {
      method: "POST"
    });
    setUser(user, { silent: true });
    loginMessage.textContent = "";
  } catch (error) {
    currentUser.classList.remove("hidden");
    currentUser.innerHTML = `
      <strong>체험 세션 연결 대기</strong><br />
      백엔드 서버가 실행 중인지 확인해주세요.
    `;
  }
}

initializeGuestSession();

