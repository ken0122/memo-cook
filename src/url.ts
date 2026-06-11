import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as cheerio from "cheerio";
import { trimForSnippet } from "./utils.js";

export type UrlSnapshot = {
  title: string;
  finalUrl: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  contentType?: string;
  text: string;
};

const maxResponseBytes = 2 * 1024 * 1024;
const supportedContentTypes = new Set(["text/html", "text/plain", "text/markdown", "application/xhtml+xml"]);

function meta($: cheerio.CheerioAPI, name: string): string | undefined {
  return (
    $(`meta[name="${name}"]`).attr("content") ??
    $(`meta[property="${name}"]`).attr("content") ??
    $(`meta[property="og:${name}"]`).attr("content")
  )?.trim();
}

function normalizeBodyText(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 60000);
}

function privateUrlsAllowed(): boolean {
  return process.env.MEMO_COOK_ALLOW_PRIVATE_URLS === "1";
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function isPrivateIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version === 6) {
    return isPrivateIpv6(address);
  }
  return false;
}

async function assertSafeUrl(url: URL): Promise<void> {
  if (privateUrlsAllowed()) {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Private URL blocked: localhost");
  }
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Private URL blocked: ${hostname}`);
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  const privateAddress = addresses.find((entry) => isPrivateIp(entry.address));
  if (privateAddress) {
    throw new Error(`Private URL blocked: ${hostname} resolves to ${privateAddress.address}`);
  }
}

function normalizeContentType(value?: string): string | undefined {
  return value?.split(";")[0]?.trim().toLowerCase();
}

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    throw new Error(`Response too large: ${contentLength} bytes exceeds ${maxBytes} byte limit`);
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`Response too large: exceeds ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function fetchSafe(url: string, timeoutMs: number): Promise<Response> {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertSafeUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": "memo-cook/0.1 (+https://local.agent-memory)"
      }
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      await assertSafeUrl(new URL(response.url));
      return response;
    }
    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    current = new URL(location, current);
  }
  throw new Error("Too many redirects");
}

export async function fetchUrlSnapshot(url: string, timeoutMs = 12000): Promise<UrlSnapshot> {
  const response = await fetchSafe(url, timeoutMs);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  const contentType = response.headers.get("content-type") ?? undefined;
  const normalizedContentType = normalizeContentType(contentType);
  if (!normalizedContentType || !supportedContentTypes.has(normalizedContentType)) {
    throw new Error(`Unsupported content type: ${contentType ?? "unknown"}`);
  }
  const raw = await readTextLimited(response, maxResponseBytes);
  const $ = cheerio.load(raw);
  $("script, style, noscript, svg, canvas").remove();

  const title =
    meta($, "title") ??
    $("title").first().text().trim() ??
    new URL(response.url).hostname;
  const description = meta($, "description");
  const author = meta($, "author") ?? meta($, "article:author");
  const publishedAt = meta($, "article:published_time") ?? meta($, "date") ?? meta($, "pubdate");
  const text = normalizeBodyText($("body").text() || $.root().text());

  return {
    title: trimForSnippet(title, 160),
    finalUrl: response.url,
    description: description ? trimForSnippet(description, 500) : undefined,
    author,
    publishedAt,
    contentType,
    text
  };
}
