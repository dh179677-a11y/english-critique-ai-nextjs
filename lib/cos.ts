import crypto from "crypto";

const DEFAULT_UPLOAD_EXPIRES = 900;
const DEFAULT_DOWNLOAD_EXPIRES = 3600;

type HttpMethod = "GET" | "PUT";

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured on server`);
  }

  return value;
};

const getCosConfig = () => {
  const secretId = getRequiredEnv("COS_SECRET_ID");
  const secretKey = getRequiredEnv("COS_SECRET_KEY");
  const bucket = getRequiredEnv("COS_BUCKET");
  const region = getRequiredEnv("COS_REGION");
  const objectPrefix = (process.env.COS_OBJECT_PREFIX || "videos").trim();

  return {
    secretId,
    secretKey,
    bucket,
    region,
    objectPrefix: objectPrefix.replace(/^\/+|\/+$/g, ""),
  };
};

const uriEncode = (value: string, encodeSlash = true) => {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return encodeSlash ? encoded : encoded.replace(/%2F/g, "/");
};

const buildCanonicalQuery = (params: Record<string, string>) =>
  Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${uriEncode(key)}=${uriEncode(value)}`)
    .join("&");

const hmac = (key: Buffer | string, value: string) =>
  crypto.createHmac("sha256", key).update(value, "utf8").digest();

const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value, "utf8").digest("hex");

const formatAmzDate = (date: Date) => {
  const iso = date.toISOString();
  return {
    amzDate: iso.replace(/[:-]|\.\d{3}/g, ""),
    shortDate: iso.slice(0, 10).replace(/-/g, ""),
  };
};

const buildHost = (bucket: string, region: string) =>
  `${bucket}.cos.${region}.myqcloud.com`;

const buildSigningKey = (
  secretKey: string,
  shortDate: string,
  region: string,
  service = "s3"
) => {
  const kDate = hmac(`AWS4${secretKey}`, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
};

const buildSignedUrl = (
  method: HttpMethod,
  objectKey: string,
  expiresIn: number
) => {
  const { secretId, secretKey, bucket, region } = getCosConfig();
  const host = buildHost(bucket, region);
  const now = new Date();
  const { amzDate, shortDate } = formatAmzDate(now);
  const credentialScope = `${shortDate}/${region}/s3/aws4_request`;
  const canonicalUri = `/${uriEncode(objectKey, false)}`;

  const queryParams = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${secretId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQuery = buildCanonicalQuery(queryParams);
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  const signingKey = buildSigningKey(secretKey, shortDate, region);
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
};

const sanitizeFileName = (fileName: string, fallback = "file.bin") => {
  const normalized = fileName.replace(/\\/g, "/").split("/").pop() || fallback;
  const cleaned = normalized.replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned || fallback;
};

export const createCosObjectKey = (folder: string, fileName: string) => {
  const { objectPrefix } = getCosConfig();
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const timestamp = now.getTime();
  const random = crypto.randomBytes(4).toString("hex");
  const safeFolder = folder.replace(/^\/+|\/+$/g, "");
  const safeName = sanitizeFileName(fileName);

  return `${objectPrefix}/${safeFolder}/${yyyy}/${mm}/${timestamp}-${random}-${safeName}`;
};

export const createVideoObjectKey = (fileName: string) =>
  createCosObjectKey("videos", fileName);

export const createSignedUploadUrl = (objectKey: string) =>
  buildSignedUrl("PUT", objectKey, DEFAULT_UPLOAD_EXPIRES);

export const createSignedDownloadUrl = (objectKey: string) =>
  buildSignedUrl("GET", objectKey, DEFAULT_DOWNLOAD_EXPIRES);
