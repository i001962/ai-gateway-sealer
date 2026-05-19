interface Env {
  CW_BASE_URL: string;
  CW_API_KEY?: string;
}

interface PortkeyWebhookPayload {
  eventType?: string;
  request?: PortkeyDataContainer;
  response?: PortkeyDataContainer;
  metadata?: Record<string, unknown>;
  body?: {
    request?: PortkeyDataContainer;
    response?: PortkeyDataContainer;
  };
}

interface PortkeyDataContainer extends Record<string, unknown> {
  json?: Record<string, unknown>;
  body?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface CryptowerkMetadata extends Record<string, unknown> {
  verify?: unknown;
  requestHashSource?: unknown;
  requestHashAlgorithm?: unknown;
  requestHashSerialization?: unknown;
  requestSha256?: unknown;
  responseHashSource?: unknown;
  responseHashAlgorithm?: unknown;
  responseHashSerialization?: unknown;
  responseSha256?: unknown;
  retrievalId?: unknown;
}

interface CryptowerkRegisterResponse {
  retrievalId?: string;
  documents?: Array<{
    retrievalId?: string;
  }>;
}

interface SealResult {
  retrievalId: string;
  sha256: string;
  verify: string;
  hashSource: string;
  hashAlgorithm: "SHA-256";
  hashSerialization: "canonical-json-stable-key-order";
}

const REGISTER_TIMEOUT_MS = 2400;
const HASH_ALGORITHM = "SHA-256" as const;
const HASH_SERIALIZATION = "canonical-json-stable-key-order" as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse({ verdict: true });
    }

    let payload: PortkeyWebhookPayload;

    try {
      payload = (await request.json()) as PortkeyWebhookPayload;
    } catch {
      return jsonResponse({ verdict: true });
    }

    if (payload.eventType === "beforeRequestHook") {
      return handleBeforeRequestHook(payload, env);
    }

    if (payload.eventType === "afterRequestHook") {
      return handleAfterRequestHook(payload, env);
    }

    return jsonResponse({ verdict: true });
  },
};

async function handleBeforeRequestHook(
  payload: PortkeyWebhookPayload,
  env: Env,
): Promise<Response> {
  const requestContainer = getRequestContainer(payload);
  const requestDocument = getRequestDocument(payload);
  if (!isPlainObject(requestDocument)) {
    return jsonResponse({ verdict: true });
  }

  const requestMetadata = getContainerMetadata(requestContainer) ?? payload.metadata;
  const requestSeal = await sealDocument(
    env,
    requestDocument,
    requestMetadata,
    getRequestDocumentSource(payload),
  );

  if (!requestSeal) {
    return jsonResponse({ verdict: true });
  }

  return jsonResponse({
    verdict: true,
    transformedData: {
      request: updateContainerMetadata(
        requestContainer,
        requestDocument,
        buildRequestMetadata(requestMetadata, requestSeal),
      ),
    },
  });
}

async function handleAfterRequestHook(
  payload: PortkeyWebhookPayload,
  env: Env,
): Promise<Response> {
  const requestContainer = getRequestContainer(payload);
  const requestDocument = getRequestDocument(payload);
  const responseContainer = getResponseContainer(payload);
  const responseDocument = getResponseDocument(payload);

  if (!isPlainObject(responseDocument)) {
    return jsonResponse({ verdict: true });
  }

  const requestMetadata = getContainerMetadata(requestContainer) ?? payload.metadata;
  const responseMetadata = getContainerMetadata(responseContainer) ?? payload.metadata;
  const carriedRequestSeal = getRequestSealFromMetadata(requestContainer);

  const requestSealPromise = isPlainObject(requestDocument)
    ? carriedRequestSeal
      ? Promise.resolve(carriedRequestSeal)
      : sealDocument(env, requestDocument, requestMetadata, getRequestDocumentSource(payload))
    : Promise.resolve<SealResult | null>(null);

  const responseSealPromise = sealDocument(
    env,
    responseDocument,
    responseMetadata,
    getResponseDocumentSource(payload),
  );

  const [requestSeal, responseSeal] = await Promise.all([
    requestSealPromise,
    responseSealPromise,
  ]);

  if (!responseSeal) {
    return jsonResponse({ verdict: true });
  }

  return jsonResponse({
    verdict: true,
    transformedData: {
      response: {
        ...updateContainerMetadata(
          responseContainer,
          responseDocument,
          buildResponseMetadata(responseMetadata, responseSeal),
        ),
        json: {
          ...responseDocument,
          cryptowerk: buildVisibleCryptowerkResponse(requestSeal, responseSeal),
        },
      },
    },
  });
}

async function sealDocument(
  env: Env,
  document: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
  hashSource: string,
): Promise<SealResult | null> {
  const sha256 = await sha256Hex(stableStringify(document));
  const retrievalId = await registerDocument(env, sha256, document, metadata);

  if (!retrievalId) {
    return null;
  }

  return {
    retrievalId,
    sha256,
    verify: buildCertificateUrl(retrievalId),
    hashSource,
    hashAlgorithm: HASH_ALGORITHM,
    hashSerialization: HASH_SERIALIZATION,
  };
}

async function registerDocument(
  env: Env,
  hash: string,
  _document: Record<string, unknown>,
  _metadata?: Record<string, unknown>,
): Promise<string | null> {
  if (!env.CW_BASE_URL) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REGISTER_TIMEOUT_MS);

  try {
    const headers = new Headers();

    if (env.CW_API_KEY) {
      headers.set("X-API-Key", env.CW_API_KEY);
    }

    const registerUrl = new URL(`${trimTrailingSlash(env.CW_BASE_URL)}/register`);
    registerUrl.searchParams.set("hashes", hash);
    registerUrl.searchParams.set("publiclyRetrievable", "true");

    const response = await fetch(registerUrl.toString(), {
      method: "POST",
      headers,
      signal: controller.signal,
    });

    if (response.status !== 200) {
      return null;
    }

    const data = (await response.json()) as CryptowerkRegisterResponse;
    return extractRetrievalId(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildRequestMetadata(
  baseMetadata: Record<string, unknown> | undefined,
  seal: SealResult,
): Record<string, unknown> {
  return {
    ...(baseMetadata ?? {}),
    cryptowerkTest: "before-request-metadata-transform",
    verify: seal.verify,
    requestHashSource: seal.hashSource,
    requestHashAlgorithm: seal.hashAlgorithm,
    requestHashSerialization: seal.hashSerialization,
    retrievalId: seal.retrievalId,
    requestSha256: seal.sha256,
  };
}

function buildResponseMetadata(
  baseMetadata: Record<string, unknown> | undefined,
  seal: SealResult,
): Record<string, unknown> {
  return {
    ...(baseMetadata ?? {}),
    verify: seal.verify,
    responseHashSource: seal.hashSource,
    responseHashAlgorithm: seal.hashAlgorithm,
    responseHashSerialization: seal.hashSerialization,
    retrievalId: seal.retrievalId,
    responseSha256: seal.sha256,
  };
}

function buildVisibleCryptowerkResponse(
  requestSeal: SealResult | null,
  responseSeal: SealResult,
): Record<string, unknown> {
  return {
    verify: responseSeal.verify,
    request: requestSeal
      ? {
          retrievalId: requestSeal.retrievalId,
          sha256: requestSeal.sha256,
          verify: requestSeal.verify,
          hashSource: requestSeal.hashSource,
          hashAlgorithm: requestSeal.hashAlgorithm,
          hashSerialization: requestSeal.hashSerialization,
        }
      : {
          hashSource: "request.json",
          hashAlgorithm: HASH_ALGORITHM,
          hashSerialization: HASH_SERIALIZATION,
        },
    response: {
      retrievalId: responseSeal.retrievalId,
      sha256: responseSeal.sha256,
      verify: responseSeal.verify,
      hashSource: responseSeal.hashSource,
      hashAlgorithm: responseSeal.hashAlgorithm,
      hashSerialization: responseSeal.hashSerialization,
    },
  };
}

function updateContainerMetadata(
  container: PortkeyDataContainer | null,
  json: Record<string, unknown>,
  metadata: Record<string, unknown>,
): PortkeyDataContainer {
  return container
    ? {
        ...container,
        json,
        metadata,
      }
    : {
        json,
        metadata,
      };
}

function getRequestSealFromMetadata(
  container: PortkeyDataContainer | null,
): SealResult | null {
  const metadata = getCryptowerkMetadata(container);
  const retrievalId = asNonEmptyString(metadata?.retrievalId);
  const sha256 = asNonEmptyString(metadata?.requestSha256);
  const verify = asNonEmptyString(metadata?.verify);
  const hashSource = asNonEmptyString(metadata?.requestHashSource);
  const hashAlgorithm = asNonEmptyString(metadata?.requestHashAlgorithm);
  const hashSerialization = asNonEmptyString(metadata?.requestHashSerialization);

  if (!retrievalId || !sha256 || !verify || !hashSource || !hashAlgorithm || !hashSerialization) {
    return null;
  }

  return {
    retrievalId,
    sha256,
    verify,
    hashSource,
    hashAlgorithm: HASH_ALGORITHM,
    hashSerialization: HASH_SERIALIZATION,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function getRequestContainer(payload: PortkeyWebhookPayload): PortkeyDataContainer | null {
  if (isPlainObject(payload.body?.request)) {
    return payload.body.request;
  }

  if (isPlainObject(payload.request)) {
    return payload.request;
  }

  return null;
}

function getResponseContainer(payload: PortkeyWebhookPayload): PortkeyDataContainer | null {
  if (isPlainObject(payload.body?.response)) {
    return payload.body.response;
  }

  if (isPlainObject(payload.response)) {
    return payload.response;
  }

  return null;
}

function getContainerMetadata(
  container: PortkeyDataContainer | null,
): Record<string, unknown> | undefined {
  return container && isPlainObject(container.metadata)
    ? container.metadata
    : undefined;
}

function getCryptowerkMetadata(
  container: PortkeyDataContainer | null,
): CryptowerkMetadata | undefined {
  const metadata = getContainerMetadata(container);
  return metadata && isPlainObject(metadata) ? metadata as CryptowerkMetadata : undefined;
}

function buildCertificateUrl(retrievalId: string): string {
  return `https://aiagent.cryptowerk.com/platform/portal/CertificateDownload?mode=html&retrievalId=${encodeURIComponent(retrievalId)}`;
}

function getRequestDocument(payload: PortkeyWebhookPayload): Record<string, unknown> | null {
  return getDocumentFromContainer(getRequestContainer(payload));
}

function getResponseDocument(payload: PortkeyWebhookPayload): Record<string, unknown> | null {
  return getDocumentFromContainer(getResponseContainer(payload));
}

function getRequestDocumentSource(payload: PortkeyWebhookPayload): string {
  if (isPlainObject(payload.body?.request?.json)) {
    return "body.request.json";
  }

  if (isPlainObject(payload.body?.request?.body)) {
    return "body.request.body";
  }

  if (isPlainObject(payload.request?.json)) {
    return "request.json";
  }

  if (isPlainObject(payload.request?.body)) {
    return "request.body";
  }

  return "request";
}

function getResponseDocumentSource(payload: PortkeyWebhookPayload): string {
  if (isPlainObject(payload.body?.response?.json)) {
    return "body.response.json";
  }

  if (isPlainObject(payload.body?.response?.body)) {
    return "body.response.body";
  }

  if (isPlainObject(payload.response?.json)) {
    return "response.json";
  }

  if (isPlainObject(payload.response?.body)) {
    return "response.body";
  }

  return "response";
}

function getDocumentFromContainer(container: unknown): Record<string, unknown> | null {
  if (!isPlainObject(container)) {
    return null;
  }

  if (isPlainObject(container.json)) {
    return container.json;
  }

  if (isPlainObject(container.body)) {
    return container.body;
  }

  return container;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (isPlainObject(value)) {
    const sortedEntries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortValue(nestedValue)]);

    return Object.fromEntries(sortedEntries);
  }

  return value;
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function extractRetrievalId(data: CryptowerkRegisterResponse): string | null {
  if (typeof data.retrievalId === "string" && data.retrievalId.length > 0) {
    return data.retrievalId;
  }

  const nestedRetrievalId = data.documents?.[0]?.retrievalId;
  return typeof nestedRetrievalId === "string" && nestedRetrievalId.length > 0
    ? nestedRetrievalId
    : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
  });
}
