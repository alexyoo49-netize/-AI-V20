let dataStore;

const $ = (id) => document.getElementById(id);

const routes = [
  { key: "direct", name: "A. 바로 구직", desc: "현재 역량으로 바로 지원서를 넣는 경로" },
  { key: "counsel", name: "B. 국민취업지원", desc: "운영기관 상담과 구직활동 계획을 먼저 잡는 경로" },
  { key: "training", name: "C. 훈련 후 구직", desc: "내일배움카드/NCS 기반 부족역량 보완 후 지원" },
  { key: "subsidy", name: "D. 장려금 기업", desc: "청년일자리도약장려금 가능 기업군 중심 지원" },
  { key: "integrated", name: "E. 통합 경로", desc: "상담, 훈련, 장려금 기업 지원을 순서대로 결합" },
];

const skillLexicon = {
  Excel: ["excel", "엑셀", "스프레드시트", "vlookup", "피벗"],
  SQL: ["sql", "쿼리", "db", "database", "데이터베이스"],
  Python: ["python", "파이썬", "pandas", "numpy"],
  "데이터 시각화": ["tableau", "태블로", "power bi", "시각화", "dashboard", "대시보드"],
  "기초 통계": ["통계", "회귀", "분석", "spss", "r "],
  문서작성: ["워드", "문서", "보고서", "한글", "기획서"],
  커뮤니케이션: ["커뮤니케이션", "고객", "상담", "협업", "소통"],
  JavaScript: ["javascript", "js", "react", "node", "프론트"],
  Git: ["git", "github", "깃"],
  Figma: ["figma", "피그마", "ux", "ui"],
  포트폴리오: ["포트폴리오", "작품", "프로젝트"],
  "콘텐츠 기획": ["콘텐츠", "블로그", "sns", "카피"],
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function seededRandom(seed) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function pickRegionOptions() {
  const region = $("region");
  region.innerHTML = Object.keys(dataStore.market)
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("");
  region.value = "부산";

  const desiredJob = $("desiredJob");
  desiredJob.innerHTML = Object.keys(dataStore.jobProfiles)
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("");
  desiredJob.value = "데이터 분석";
}

function renderDatasets() {
  const rawLabel = dataStore.source.rawDataLoaded
    ? `, 로컬 원천 ${dataStore.source.localSourceFiles || "n/a"}개, 산출 묶음 ${dataStore.source.rawDatasetCount}개`
    : "";
  $("dataBadge").textContent = `224개 목록 검토, 실제 산출 ${dataStore.source.selectedRows}개 핵심 데이터${rawLabel}`;
  $("datasetList").innerHTML = dataStore.datasets
    .map(
      (d) => `
      <article class="dataset-item">
        <b>${d.id} · ${d.title.replace("고용노동부_", "")}</b>
        <p>${d.role}</p>
      </article>`,
    )
    .join("");
}

function inferFromText(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [skill, tokens] of Object.entries(skillLexicon)) {
    if (tokens.some((token) => lower.includes(token.toLowerCase()))) found.push(skill);
  }
  return [...new Set(found)];
}

function inferConstraints(story) {
  const text = story.toLowerCase();
  const constraints = [];
  if (story.includes("빨리") || story.includes("당장") || story.includes("급") || text.includes("asap")) {
    constraints.push("빠른 취업 선호");
  }
  if (story.includes("돈") || story.includes("생활비") || story.includes("월급") || story.includes("임금")) {
    constraints.push("소득 안정성 중요");
  }
  if (story.includes("훈련") || story.includes("학원") || story.includes("배우")) {
    constraints.push("훈련 고려 중");
  }
  if (story.includes("부산") || story.includes("대전") || story.includes("서울") || story.includes("지역")) {
    constraints.push("지역 조건 중요");
  }
  return constraints.length ? constraints : ["선택지 비교 필요"];
}

function fallbackProfile() {
  const story = $("story").value.trim();
  const resume = $("resumeText").value.trim();
  const desiredJob = $("desiredJob").value;
  const job = dataStore.jobProfiles[desiredJob];
  const skills = inferFromText(`${story}\n${resume}`);
  const confirmed = skills.length ? skills : ["Excel"];
  const missing = job.required.filter((skill) => !confirmed.includes(skill));
  const skillFit = (job.required.length - missing.length) / job.required.length;

  return {
    story,
    resume,
    region: $("region").value,
    age: Number($("age").value || 27),
    desiredJob,
    ncs: job.ncs,
    trainingMonths: Number($("trainingMonths").value || 0),
    confirmedSkills: confirmed,
    missingSkills: missing,
    adjacentJobs: job.adjacent,
    constraints: inferConstraints(story),
    skillFit: clamp(skillFit, 0.08, 0.98),
    aiSource: "규칙 기반",
    aiNote: "OpenAI API를 사용할 수 없어 키워드 기반으로 분석했습니다.",
  };
}

async function analyzeProfileWithAI() {
  const story = $("story").value.trim();
  const resume = $("resumeText").value.trim();
  const desiredJob = $("desiredJob").value;
  const job = dataStore.jobProfiles[desiredJob];
  const fallback = fallbackProfile();

  if (window.location.protocol === "file:") {
    return {
      ...fallback,
      aiNote: "standalone 파일로 실행 중이라 생성형 AI 서버 호출은 비활성화되어 있습니다. 서버 버전에서 OpenAI 분석을 사용할 수 있습니다.",
    };
  }

  try {
    const response = await fetch("/api/analyze-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        story,
        resumeText: resume,
        region: $("region").value,
        age: Number($("age").value || 27),
        desiredJob,
        trainingMonths: Number($("trainingMonths").value || 0),
        jobProfiles: dataStore.jobProfiles,
      }),
    });
    const raw = await response.text();
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return {
        ...fallback,
        aiNote: `AI 분석 API가 JSON을 반환하지 않았습니다. 서버를 최신 버전으로 다시 실행해 주세요. 응답: ${raw.slice(0, 80)}`,
      };
    }
    if (result.source !== "openai" || !result.profile) {
      return { ...fallback, aiNote: result.error || fallback.aiNote };
    }

    const ai = result.profile;
    const confirmed = [...new Set([...(ai.confirmedSkills || []), ...(ai.inferredSkills || [])])]
      .filter(Boolean)
      .slice(0, 10);
    const missing =
      Array.isArray(ai.missingSkills) && ai.missingSkills.length
        ? ai.missingSkills
        : job.required.filter((skill) => !confirmed.includes(skill));
    const skillFit = clamp((job.required.length - missing.filter((s) => job.required.includes(s)).length) / job.required.length, 0.08, 0.98);

    return {
      ...fallback,
      region: ai.region || fallback.region,
      age: Number(ai.age || fallback.age),
      desiredJob: ai.desiredJob || fallback.desiredJob,
      ncs: job.ncs,
      confirmedSkills: confirmed.length ? confirmed : fallback.confirmedSkills,
      missingSkills: missing.length ? missing : fallback.missingSkills,
      adjacentJobs: (ai.suggestedAdjacentJobs || []).length ? ai.suggestedAdjacentJobs : fallback.adjacentJobs,
      constraints: (ai.constraints || []).length ? ai.constraints : fallback.constraints,
      skillFit,
      aiSource: "생성형 AI 분석",
      aiNote: ai.resumeSummary || "생성형 AI가 자연어 고민과 이력서 내용을 구조화했습니다.",
      resumeStrengths: ai.resumeStrengths || [],
      resumeGaps: ai.resumeGaps || [],
      careerGoal: ai.careerGoal || "",
    };
  } catch (error) {
    return { ...fallback, aiNote: `AI 분석 호출 실패: ${error.message}` };
  }
}

function simulateRoute(profile, route, seedOffset = 0) {
  const region = dataStore.market[profile.region];
  const job = dataStore.jobProfiles[profile.desiredJob];
  const jobRegion =
    dataStore.jobMarket?.[profile.region]?.[profile.desiredJob] || null;
  const baseDemand = jobRegion ? region.demand * 0.5 + jobRegion.demand * 0.5 : region.demand;
  const baseCompetition = jobRegion ? region.competition * 0.55 + jobRegion.competition * 0.45 : region.competition;
  const effects = dataStore.policyEffects;
  const rng = seededRandom(20260508 + seedOffset);
  const runs = 500;
  const agents = 1000;
  let employed = 0;
  let retained = 0;
  let totalMonths = 0;
  let wageSum = 0;
  let dropout = 0;

  for (let run = 0; run < runs; run += 1) {
    for (let i = 0; i < agents; i += 1) {
      const localDemand = clamp(baseDemand + (rng() - 0.5) * 0.18, 0.18, 0.92);
      const competition = clamp(baseCompetition + (rng() - 0.5) * 0.16, 0.15, 0.9);
      let skillFit = clamp(profile.skillFit + (rng() - 0.5) * 0.18, 0.05, 0.98);
      let counseling = 0;
      let subsidy = 0;
      let training = 0;
      let monthsBeforeApply = 0;
      let routeDropPenalty = 0;

      if (route.key === "counsel") counseling = effects.counseling;
      if (route.key === "subsidy") subsidy = effects.subsidy;
      if (route.key === "training") {
        training = job.trainingBoost;
        monthsBeforeApply = Math.min(4, Math.max(2, profile.trainingMonths || 3));
        routeDropPenalty = profile.trainingMonths === 0 ? 0.1 : 0.03;
      }
      if (route.key === "integrated") {
        counseling = effects.counseling;
        subsidy = effects.subsidy * 0.75;
        training = job.trainingBoost * 0.9;
        monthsBeforeApply = Math.min(3, Math.max(2, profile.trainingMonths || 3));
      }

      const supportAccess = region.supportAccess || 0.5;
      counseling *= 0.75 + supportAccess * 0.5;
      subsidy *= 0.8 + supportAccess * 0.35;

      if (training > 0) skillFit = clamp(skillFit + training, 0.05, 0.99);

      let gotJob = false;
      let month = 12;
      for (let m = 1; m <= 12; m += 1) {
        const pressure = profile.constraints.includes("빠른 취업 선호") ? effects.jobSearchPressure || 0.025 : 0;
        const dropoutProb = clamp(0.035 + routeDropPenalty + m * 0.002 + (effects.distancePenalty || 0) * (1 - supportAccess) - counseling * 0.3, 0.01, 0.22);
        if (rng() < dropoutProb && m > 2) {
          dropout += 1;
          break;
        }
        if (m <= monthsBeforeApply) continue;
        const x =
          -1.25 +
          1.25 * localDemand +
          1.8 * skillFit -
          1.05 * competition +
          counseling +
          subsidy +
          (route.key === "integrated" ? effects.integratedSynergy : 0) +
          pressure;
        const monthlyJobProb = clamp(sigmoid(x) * 0.22, 0.01, 0.42);
        if (rng() < monthlyJobProb) {
          gotJob = true;
          month = m;
          break;
        }
      }

      if (gotJob) {
        employed += 1;
        totalMonths += month;
        const wage = job.baseWage * region.wage * (0.9 + skillFit * 0.28 + (rng() - 0.5) * 0.1);
        wageSum += wage;
        const retentionProb = clamp(0.46 + skillFit * 0.28 + counseling * 0.8 + training * 0.45 - competition * 0.08, 0.25, 0.9);
        if (rng() < retentionProb) retained += 1;
      }
    }
  }

  const denominator = runs * agents;
  const employmentRate = employed / denominator;
  const retentionRate = employed ? retained / employed : 0;
  const avgMonths = employed ? totalMonths / employed : 12;
  const avgWage = employed ? wageSum / employed : 0;
  const dropoutRate = dropout / denominator;
  const score = employmentRate * 45 + retentionRate * 25 + clamp(avgWage / 300, 0, 1.3) * 20 + (1 - avgMonths / 12) * 10;

  return {
    ...route,
    employmentRate,
    retentionRate,
    avgMonths,
    avgWage,
    dropoutRate,
    score,
  };
}

function runSimulation(profile) {
  return routes
    .map((route, idx) => simulateRoute(profile, route, idx * 1009))
    .sort((a, b) => b.score - a.score);
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function renderProfile(profile) {
  $("profileCards").classList.remove("empty");
  $("profileCards").innerHTML = `
    <article class="profile-card">
      <strong>구조화된 목표</strong>
      <p>${profile.region} · ${profile.age}세 · ${profile.desiredJob}<br>${profile.ncs}</p>
    </article>
    <article class="profile-card">
      <strong>제약조건</strong>
      <p>${profile.constraints.join(", ")}</p>
    </article>
    <article class="profile-card">
      <strong>AI 분석 방식</strong>
      <p>${profile.aiSource}<br>${profile.aiNote}</p>
    </article>
    <article class="profile-card">
      <strong>확인된 역량</strong>
      <div class="skill-list">${profile.confirmedSkills.map((s) => `<span class="chip">${s}</span>`).join("")}</div>
    </article>
    <article class="profile-card">
      <strong>부족역량</strong>
      <div class="skill-list">${profile.missingSkills.slice(0, 6).map((s) => `<span class="chip warn">${s}</span>`).join("")}</div>
    </article>
  `;
}

function renderRoutes(results) {
  const best = results[0].key;
  $("routeResults").classList.remove("empty");
  $("routeResults").innerHTML = results
    .map(
      (r) => `
      <article class="route-card ${r.key === best ? "best" : ""}">
        <div>
          <h3 class="route-title">${r.name}</h3>
          <p class="route-desc">${r.desc}</p>
        </div>
        <div class="bars">
          ${bar("취업확률", r.employmentRate)}
          ${bar("12개월 유지", r.retentionRate)}
          ${bar("이탈 낮음", 1 - r.dropoutRate)}
          <div class="bar-row"><span>예상 초임</span><div class="bar"><span style="width:${clamp(r.avgWage / 320, 0, 1) * 100}%"></span></div><b>${Math.round(r.avgWage)}만</b></div>
        </div>
        <div class="score"><div><span>${Math.round(r.score)}</span>점${r.key === best ? "<br>추천" : ""}</div></div>
      </article>`,
    )
    .join("");
}

function bar(label, value) {
  return `<div class="bar-row"><span>${label}</span><div class="bar"><span style="width:${clamp(value, 0, 1) * 100}%"></span></div><b>${percent(value)}</b></div>`;
}

function renderPlan(profile, best) {
  const skillText = profile.missingSkills.slice(0, 3).join(", ") || "직무 경험";
  const adjacent = profile.adjacentJobs.slice(0, 3).join(", ");
  $("actionPlan").classList.remove("empty");
  $("actionPlan").innerHTML = `
    <article class="plan-block">
      <strong>추천 결론</strong>
      <p>${best.name}가 현재 조건에서 가장 유리합니다. 예상 취업확률은 ${percent(best.employmentRate)}, 평균 소요기간은 ${best.avgMonths.toFixed(1)}개월입니다.</p>
    </article>
    <article class="plan-block">
      <strong>이번 주 할 일 5개</strong>
      <ul>
        <li>${profile.region} 지역 고용복지플러스센터 또는 국민취업지원 운영기관 상담 가능 여부 확인</li>
        <li>${profile.desiredJob} 직무의 NCS 능력단위와 내 이력서 경험을 1:1로 매핑</li>
        <li>${skillText} 보완용 2~3개월 훈련과정 후보 3개 비교</li>
        <li>청년일자리도약장려금 가능성이 높은 기업군을 별도 지원 리스트로 분리</li>
        <li>이력서 첫 문단을 '${profile.desiredJob} 직무 전환 가능성' 중심으로 수정</li>
      </ul>
    </article>
    <article class="plan-block">
      <strong>이력서 보완 포인트</strong>
      <ul>
        <li>현재 역량: ${profile.confirmedSkills.join(", ")}</li>
        <li>부족역량: ${profile.missingSkills.slice(0, 5).join(", ")}</li>
        <li>바로 지원 가능한 인접 직무: ${adjacent}</li>
      </ul>
    </article>
    <article class="plan-block">
      <strong>공공데이터 근거</strong>
      <p>고용24 취업동향, NCS, 국민내일배움카드, 국민취업지원 운영기관, 청년일자리도약장려금 데이터를 경로 생성과 확률 보정에 사용했습니다.</p>
    </article>
  `;
}

async function extractPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const res = await fetch("/api/extract-pdf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base64 }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "PDF 추출 실패");
  return json;
}

function fillDemo() {
  $("story").value =
    "부산 사는 27살 문과 졸업생입니다. 데이터 분석 쪽으로 가고 싶은데 바로 취업해야 할지, 내일배움카드 훈련을 먼저 들어야 할지 모르겠어요. 생활비 때문에 너무 오래 쉬기는 어렵고 6개월 안에는 취업하고 싶습니다.";
  $("region").value = "부산";
  $("age").value = 27;
  $("desiredJob").value = "데이터 분석";
  $("trainingMonths").value = "3";
  $("resumeText").value =
    "경영학 전공. 영업지원 인턴 6개월. Excel로 매출 데이터를 정리하고 피벗테이블로 월간 보고서를 작성했습니다. 고객 응대와 문서작성 경험이 있고 SQL과 Python은 아직 배운 적이 없습니다.";
}

async function boot() {
  const res = await fetch("/data/datasets.json");
  dataStore = await res.json();
  pickRegionOptions();
  renderDatasets();

  $("demoFillBtn").addEventListener("click", fillDemo);
  $("pdfFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    $("pdfStatus").textContent = "PDF 텍스트 추출 중입니다...";
    try {
      const result = await extractPdf(file);
      $("resumeText").value = `${$("resumeText").value}\n\n${result.text}`.trim();
      $("pdfStatus").textContent = `PDF ${result.pageCount}쪽에서 텍스트를 추출했습니다.`;
    } catch (error) {
      $("pdfStatus").textContent = error.message;
    }
  });

  $("profileForm").addEventListener("submit", (event) => {
    event.preventDefault();
    $("profileCards").classList.add("empty");
    $("profileCards").innerHTML = "생성형 AI가 자연어와 이력서 내용을 분석하는 중입니다...";
    $("routeResults").classList.add("empty");
    $("routeResults").innerHTML = "프로필 구조화 후 ABM 시뮬레이션을 실행합니다.";
    $("actionPlan").classList.add("empty");
    $("actionPlan").innerHTML = "추천 경로가 나오면 실행계획과 이력서 보완 포인트가 생성됩니다.";
    analyzeProfileWithAI().then((profile) => {
      renderProfile(profile);
      const results = runSimulation(profile);
      renderRoutes(results);
      renderPlan(profile, results[0]);
    });
  });

  fillDemo();
}

boot();
