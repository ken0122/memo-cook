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

export async function fetchUrlSnapshot(url: string, timeoutMs = 12000): Promise<UrlSnapshot> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": "memo-cook/0.1 (+https://local.agent-memory)"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  const contentType = response.headers.get("content-type") ?? undefined;
  const raw = await response.text();
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
