import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const openaiModel = process.env.OPENAI_MODEL || "gpt-5-mini";
const structuredFallbackModel = process.env.OPENAI_STRUCTURED_MODEL || "gpt-4.1-mini";

function getOpenAIKey() {
  const candidates = [
    "OPENAI_API_KEY",
    "OPENAI_KEY",
    "OPENAI_APIKEY",
    "OpenAI_API_KEY",
  ];
  for (const name of candidates) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return {
        name,
        value: value.trim(),
      };
    }
  }
  return {
    name: null,
    value: "",
  };
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function extractPdfText(base64) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, 8); pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ");
    pages.push(text);
  }
  return {
    pageCount: pdf.numPages,
    text: pages.join("\n\n").replace(/\s+/g, " ").trim(),
  };
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const chunks = [];
  for (const item of payload.output || []) {
    if (item.type === "message" && typeof item.content === "string") {
      chunks.push(item.content);
    }
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.value === "string") chunks.push(content.value);
      if (typeof content.json === "object") chunks.push(JSON.stringify(content.json));
    }
  }
  return chunks.join("\n").trim();
}

function parseJsonLoose(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Model returned an empty response");
  }
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model response did not contain JSON");
    return JSON.parse(match[0]);
  }
}

const profileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    region: { type: "string" },
    age: { type: ["number", "null"] },
    desiredJob: { type: "string" },
    currentStatus: { type: "string" },
    education: { type: "string" },
    major: { type: "string" },
    experience: { type: "array", items: { type: "string" } },
    confirmedSkills: { type: "array", items: { type: "string" } },
    inferredSkills: { type: "array", items: { type: "string" } },
    missingSkills: { type: "array", items: { type: "string" } },
    constraints: { type: "array", items: { type: "string" } },
    careerGoal: { type: "string" },
    resumeSummary: { type: "string" },
    resumeStrengths: { type: "array", items: { type: "string" } },
    resumeGaps: { type: "array", items: { type: "string" } },
    suggestedAdjacentJobs: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
  required: [
    "region",
    "age",
    "desiredJob",
    "currentStatus",
    "education",
    "major",
    "experience",
    "confirmedSkills",
    "inferredSkills",
    "missingSkills",
    "constraints",
    "careerGoal",
    "resumeSummary",
    "resumeStrengths",
    "resumeGaps",
    "suggestedAdjacentJobs",
    "confidence",
  ],
};

function normalizeProfile(profile, body) {
  const safeArray = (value) => (Array.isArray(value) ? value.filter(Boolean).map(String) : []);
  return {
    region: String(profile.region || body.region || ""),
    age: typeof profile.age === "number" ? profile.age : Number(body.age || 0) || null,
    desiredJob: String(profile.desiredJob || body.desiredJob || ""),
    currentStatus: String(profile.currentStatus || "구직 중"),
    education: String(profile.education || ""),
    major: String(profile.major || ""),
    experience: safeArray(profile.experience),
    confirmedSkills: safeArray(profile.confirmedSkills),
    inferredSkills: safeArray(profile.inferredSkills),
    missingSkills: safeArray(profile.missingSkills),
    constraints: safeArray(profile.constraints),
    careerGoal: String(profile.careerGoal || ""),
    resumeSummary: String(profile.resumeSummary || ""),
    resumeStrengths: safeArray(profile.resumeStrengths),
    resumeGaps: safeArray(profile.resumeGaps),
    suggestedAdjacentJobs: safeArray(profile.suggestedAdjacentJobs),
    confidence: Number.isFinite(Number(profile.confidence)) ? Number(profile.confidence) : 0.5,
  };
}

async function analyzeProfileWithOpenAI(body) {
  const { value: apiKey } = getOpenAIKey();
  if (!apiKey) {
    return {
      source: "fallback",
      error: "OPENAI_API_KEY is not configured on the server.",
    };
  }

  const jobProfiles = body.jobProfiles || {};
  const job = jobProfiles[body.desiredJob] || {};
  const requiredSkills = Array.isArray(job.required) ? job.required : [];
  const adjacentJobs = Array.isArray(job.adjacent) ? job.adjacent : [];

  const instructions = [
    "CRITICAL OUTPUT RULE: 요청한 JSON 형식으로만 답해. 다른 텍스트를 끼워 넣으면 시스템이 실패한다.",
    "Your first character must be { and your last character must be }.",
    "Do not include reasoning, markdown, comments, labels, apologies, or explanatory prose.",
    "You are a Korean youth employment counselor for a public-service MVP.",
    "Read the user's Korean natural-language concern and resume text.",
    "Return JSON only. No markdown, no explanations, no prose outside JSON.",
    "Do not invent numeric simulation results. Only structure profile, skills, constraints, and resume insights.",
    "Use the provided required skills as the main skill vocabulary when possible.",
    "Every required field must be present. Use empty strings or empty arrays when unknown.",
  ].join(" ");

  const input = {
    userInput: {
      story: body.story || "",
      resumeText: body.resumeText || "",
      region: body.region || "",
      age: body.age || null,
      desiredJob: body.desiredJob || "",
      trainingMonths: body.trainingMonths || 0,
    },
    targetJobProfile: {
      desiredJob: body.desiredJob || "",
      ncs: job.ncs || "",
      requiredSkills,
      adjacentJobs,
    },
    outputSchema: {
      region: "string",
      age: "number|null",
      desiredJob: "string",
      currentStatus: "string",
      education: "string",
      major: "string",
      experience: ["string"],
      confirmedSkills: ["string"],
      inferredSkills: ["string"],
      missingSkills: ["string"],
      constraints: ["string"],
      careerGoal: "string",
      resumeSummary: "string",
      resumeStrengths: ["string"],
      resumeGaps: ["string"],
      suggestedAdjacentJobs: ["string"],
      confidence: "number from 0 to 1",
    },
  };

  try {
    const profile = await analyzeProfileWithChatCompletions(apiKey, instructions, input, "primary structured extraction");
    return {
      source: "openai",
      model: profile.__model || structuredFallbackModel,
      profile: normalizeProfile(profile, body),
    };
  } catch (error) {
    return {
      source: "fallback",
      error: `Structured AI extraction failed: ${error.message}`,
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "system",
          content: instructions,
        },
        {
          role: "user",
          content: `JSON으로만 응답하세요. 다음 입력을 구조화하세요.\n${JSON.stringify(input)}`,
        },
      ],
      reasoning: {
        effort: "minimal",
      },
      text: {
        format: {
          type: "json_schema",
          name: "youth_profile_analysis",
          strict: true,
          schema: profileSchema,
        }
      },
      max_output_tokens: 4000,
      store: false,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      source: "fallback",
      error: payload.error?.message || `OpenAI request failed with ${response.status}`,
    };
  }

  let profile;
  try {
    const text = extractResponseText(payload);
    profile = parseJsonLoose(text);
  } catch (error) {
    profile = await analyzeProfileWithChatCompletions(apiKey, instructions, input, error.message);
  }
  return {
    source: "openai",
    model: profile.__model || openaiModel,
    profile: normalizeProfile(profile, body),
  };
}

async function analyzeProfileWithChatCompletions(apiKey, instructions, input, previousError) {
  const body = {
    model: structuredFallbackModel,
    messages: [
      {
        role: "system",
        content: `${instructions} You must output one JSON object that matches the schema exactly.`,
      },
      {
        role: "user",
        content: `(요청한 json 형식으로만 답해. 다른거 끼면 자꾸 뻑나. 첫 글자는 {, 마지막 글자는 } 여야 해.)\n다음 입력을 구조화하세요.\n${JSON.stringify(input)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "youth_profile_analysis",
        strict: true,
        schema: profileSchema,
      },
    },
    max_tokens: 4000,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return analyzeProfileWithJsonObject(apiKey, instructions, input, `${previousError}; chat schema failed: ${payload.error?.message || response.status}`);
  }

  const content = payload.choices?.[0]?.message?.content || "";
  try {
    return {
      ...parseJsonLoose(content),
      __model: structuredFallbackModel,
    };
  } catch (error) {
    return repairProfileJson(apiKey, instructions, input, content, `${previousError}; chat parse failed: ${error.message}`);
  }
}

async function analyzeProfileWithJsonObject(apiKey, instructions, input, previousError) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: structuredFallbackModel,
      messages: [
        {
          role: "system",
          content: `${instructions} Output valid JSON only. The word JSON is required: JSON.`,
        },
        {
          role: "user",
          content: `(요청한 json 형식으로만 답해. 다른거 끼면 자꾸 뻑나. 첫 글자는 {, 마지막 글자는 } 여야 해.)\n키는 region, age, desiredJob, currentStatus, education, major, experience, confirmedSkills, inferredSkills, missingSkills, constraints, careerGoal, resumeSummary, resumeStrengths, resumeGaps, suggestedAdjacentJobs, confidence만 사용하세요.\n${JSON.stringify(input)}`,
        },
      ],
      response_format: {
        type: "json_object",
      },
      max_tokens: 4000,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${previousError}; json_object failed: ${payload.error?.message || response.status}`);
  }
  const content = payload.choices?.[0]?.message?.content || "";
  try {
    return {
      ...parseJsonLoose(content),
      __model: `${structuredFallbackModel} json_object`,
    };
  } catch (error) {
    return repairProfileJson(apiKey, instructions, input, content, `${previousError}; json_object parse failed: ${error.message}`);
  }
}

async function repairProfileJson(apiKey, instructions, input, badOutput, previousError) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: structuredFallbackModel,
      messages: [
        {
          role: "system",
          content: `${instructions} You are repairing an invalid response. Output valid JSON only. No markdown. First character {, last character }.`,
        },
        {
          role: "user",
          content: `(요청한 json 형식으로만 답해. 다른거 끼면 자꾸 뻑나.)\n아래 원래 입력과 잘못된 응답을 참고해서, 스키마에 맞는 JSON 객체 하나만 다시 작성하세요.\n\n원래 입력:\n${JSON.stringify(input)}\n\n잘못된 응답:\n${String(badOutput || "").slice(0, 4000)}`,
        },
      ],
      response_format: {
        type: "json_object",
      },
      max_tokens: 4000,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${previousError}; repair failed: ${payload.error?.message || response.status}`);
  }
  const content = payload.choices?.[0]?.message?.content || "";
  return {
    ...parseJsonLoose(content),
    __model: `${structuredFallbackModel} repaired_json`,
  };
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.url === "/api/health" && req.method === "GET") {
    const key = getOpenAIKey();
    return send(
      res,
      200,
      JSON.stringify({
        ok: true,
        app: "nae-il-path-ai",
        version: "openai-profile-v13-hard-json-prompt",
        openaiConfigured: Boolean(key.value),
        openaiKeyName: key.name,
        openaiKeyLength: key.value.length,
        model: openaiModel,
        structuredFallbackModel,
      }),
    );
  }

  if (req.url === "/api/env-check" && req.method === "GET") {
    const keys = Object.keys(process.env)
      .filter((name) => name.toLowerCase().includes("openai"))
      .sort()
      .map((name) => ({
        name,
        length: String(process.env[name] || "").length,
        hasValue: Boolean(String(process.env[name] || "").trim()),
      }));
    return send(
      res,
      200,
      JSON.stringify({
        ok: true,
        version: "openai-profile-v13-hard-json-prompt",
        matchingEnvironmentKeys: keys,
      }),
    );
  }

  if (req.url === "/api/extract-pdf" && req.method === "POST") {
    try {
      const body = await readJson(req);
      if (!body.base64) return send(res, 400, JSON.stringify({ error: "base64 is required" }));
      const result = await extractPdfText(body.base64);
      return send(res, 200, JSON.stringify(result));
    } catch (error) {
      return send(
        res,
        500,
        JSON.stringify({
          error: "PDF 텍스트 추출에 실패했습니다. 이력서 내용을 텍스트로 붙여넣어 주세요.",
          detail: error.message,
        }),
      );
    }
  }

  if (req.url === "/api/analyze-profile" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const result = await analyzeProfileWithOpenAI(body);
      return send(res, 200, JSON.stringify(result));
    } catch (error) {
      return send(
        res,
        200,
        JSON.stringify({
          source: "fallback",
          error: error.message,
        }),
      );
    }
  }

  return send(res, 404, JSON.stringify({ error: "not found" }));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const target = path.normalize(path.join(publicDir, pathname));
  if (!target.startsWith(publicDir)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");

  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    const body = await fs.readFile(target);
    send(res, 200, body, mime[path.extname(target)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) return handleApi(req, res);
  return serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`내일경로 AI MVP: http://localhost:${port}`);
});
