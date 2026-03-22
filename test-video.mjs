import fs from "fs";
import path from "path";
import OpenAI from "openai";

const DEFAULT_MODEL = "gemini-3.1-pro-preview-cli";
const DEFAULT_FILE = "./test.mp4";

const getRequiredEnv = (name) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing`);
  }

  return value;
};

const inferMimeType = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".mp4") return "video/mp4";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mkv") return "video/x-matroska";
  if (extension === ".ogg") return "video/ogg";

  return "application/octet-stream";
};

async function main() {
  const apiKey = getRequiredEnv("LLM_API_KEY");
  const baseURL = getRequiredEnv("LLM_BASE_URL");
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  const filePath = process.argv[2] || DEFAULT_FILE;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Test video not found: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString("base64");
  const filename = path.basename(filePath);
  const mimeType = inferMimeType(filePath);

  const client = new OpenAI({
    apiKey,
    baseURL,
  });

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
你是一位专业的英语口语测评老师。
请直接分析这个视频中的英文口语表现，并且只返回 JSON。
JSON 格式严格为：
{
  "fluency": { "score": 0, "comment": "" },
  "pronunciation": { "score": 0, "comment": "" },
  "intonation": { "score": 0, "comment": "" },
  "vocabulary": { "score": 0, "comment": "" },
  "emotion": { "score": 0, "comment": "" },
  "overallComment": "",
  "suggestions": ["", "", ""],
  "grammarSummary": ""
}
所有 comment 必须用中文。
不要返回 markdown，不要加解释文字。
            `.trim(),
          },
          {
            type: "input_file",
            filename,
            file_data: `data:${mimeType};base64,${base64Data}`,
          },
        ],
      },
    ],
  });

  console.log(JSON.stringify(response, null, 2));
}

main().catch((error) => {
  console.error("TEST FAILED:");
  console.error(error);
  process.exitCode = 1;
});
