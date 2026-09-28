// Supabase Edge Function: HTML <-> Notion sync bridge.
// Notion is the source of truth. The browser never receives NOTION_TOKEN.

type Kind = "travel" | "expenses";

type SchemaProperty = {
  id?: string;
  name: string;
  type: string;
  [key: string]: unknown;
};

type NotionPage = {
  id: string;
  url?: string;
  last_edited_time?: string;
  created_time?: string;
  icon?: {
    type?: string;
    emoji?: string;
    custom_emoji?: { url?: string };
    external?: { url?: string };
  } | null;
  properties?: Record<string, any>;
};

const VERSION = Deno.env.get("NOTION_VERSION") || "2026-03-11";
const SOURCES: Record<Kind, string | undefined> = {
  travel: Deno.env.get("NOTION_TRAVEL_DATA_SOURCE_ID"),
  expenses: Deno.env.get("NOTION_EXPENSE_DATA_SOURCE_ID"),
};
const ORIGIN = Deno.env.get("WEB_ORIGIN") || "*";
const schemaCache = new Map<
  string,
  { expires: number; properties: SchemaProperty[] }
>();

function headers() {
  const token = Deno.env.get("NOTION_TOKEN");
  if (!token) throw new Error("NOTION_TOKEN is not configured");
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": VERSION,
    "Content-Type": "application/json",
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    Vary: "Origin",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function notion(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.message || `Notion API error: ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function sourceId(kind: Kind) {
  const id = SOURCES[kind];
  if (!id) throw new Error(`Missing data source ID for ${kind}`);
  return id;
}

async function dataSourceSchema(
  dataSourceId: string,
): Promise<SchemaProperty[]> {
  const cached = schemaCache.get(dataSourceId);
  if (cached && cached.expires > Date.now()) return cached.properties;
  const body = await notion(`/data_sources/${dataSourceId}`);
  const raw = body.properties || body.schema || {};
  const properties = Object.entries(raw).map(([id, value]: [string, any]) => ({
    id,
    ...value,
  })) as SchemaProperty[];
  schemaCache.set(dataSourceId, {
    expires: Date.now() + 5 * 60_000,
    properties,
  });
  return properties;
}

function propByName(schema: SchemaProperty[], name: string) {
  return schema.find((p) => p.name === name || p.id === name);
}

function richTextPlain(value: any) {
  return Array.isArray(value)
    ? value.map((x) => x.plain_text || x.text?.content || "").join("")
    : "";
}

function readProperty(property: any) {
  const type = property?.type;
  const value = property?.[type];
  if (type === "title") return richTextPlain(value);
  if (type === "rich_text") return richTextPlain(value);
  if (type === "select") return value?.name || "";
  if (type === "multi_select") return (value || []).map((x: any) => x.name);
  if (type === "number") return value;
  if (type === "url") return value || "";
  if (type === "email") return value || "";
  if (type === "checkbox") return Boolean(value);
  if (type === "date") return value || null;
  if (type === "place") return value || null;
  if (type === "people") return value || [];
  return value ?? null;
}

function readPage(page: NotionPage, schema: SchemaProperty[], content = "") {
  const properties: Record<string, unknown> = {};
  for (const schemaProperty of schema) {
    const key = schemaProperty.id || schemaProperty.name;
    const raw =
      page.properties?.[key] || page.properties?.[schemaProperty.name];
    properties[schemaProperty.name] = readProperty(raw);
  }
  return {
    id: page.id,
    url: page.url || `https://www.notion.so/${page.id.replaceAll("-", "")}`,
    createdTime: page.created_time || null,
    lastEditedTime: page.last_edited_time || null,
    icon: page.icon || null,
    properties,
    content,
  };
}

async function queryPages(dataSourceId: string) {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const body = await notion(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        result_type: "page",
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    pages.push(
      ...(body.results || []).filter((row: any) => row.object === "page"),
    );
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function pageMarkdown(pageId: string) {
  const body = await notion(`/pages/${pageId}/markdown`);
  return (
    body.markdown ||
    body.page_markdown?.markdown ||
    body.page_markdown?.content ||
    ""
  );
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
) {
  const output: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length || 1) }, worker),
  );
  return output;
}

function requestProperty(schemaProperty: SchemaProperty, value: unknown) {
  const type = schemaProperty.type;
  if (type === "title")
    return {
      title: value ? [{ type: "text", text: { content: String(value) } }] : [],
    };
  if (type === "rich_text")
    return {
      rich_text: value
        ? [{ type: "text", text: { content: String(value) } }]
        : [],
    };
  if (type === "select")
    return { select: value ? { name: String(value) } : null };
  if (type === "multi_select")
    return {
      multi_select: Array.isArray(value)
        ? value.map((name) => ({ name: String(name) }))
        : [],
    };
  if (type === "number")
    return { number: value === "" || value == null ? null : Number(value) };
  if (type === "url") return { url: value ? String(value) : null };
  if (type === "email") return { email: value ? String(value) : null };
  if (type === "checkbox") return { checkbox: Boolean(value) };
  if (type === "date") {
    if (!value) return { date: null };
    if (typeof value === "object") return { date: value };
    return { date: { start: String(value) } };
  }
  if (type === "place") {
    if (!value) return { place: null };
    if (typeof value === "object") return { place: value };
    return { place: { address: String(value) } };
  }
  return undefined;
}

function buildProperties(
  schema: SchemaProperty[],
  values: Record<string, unknown>,
) {
  const properties: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values || {})) {
    const schemaProperty = propByName(schema, name);
    if (!schemaProperty) continue;
    const encoded = requestProperty(schemaProperty, value);
    if (encoded) properties[schemaProperty.id || schemaProperty.name] = encoded;
  }
  return properties;
}

async function writePage(kind: Kind, payload: any, method: "POST" | "PATCH") {
  const dataSourceId = sourceId(kind);
  const schema = await dataSourceSchema(dataSourceId);
  const properties = buildProperties(schema, payload.properties || {});
  let page: NotionPage;
  if (method === "POST") {
    page = await notion("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { data_source_id: dataSourceId },
        properties,
        ...(payload.content ? { markdown: payload.content } : {}),
      }),
    });
  } else {
    if (!payload.id) throw new Error("PATCH requires id");
    page = await notion(`/pages/${payload.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    if (payload.content !== undefined) {
      await notion(`/pages/${payload.id}/markdown`, {
        method: "PATCH",
        body: JSON.stringify({
          type: "replace_content",
          replace_content: { new_str: String(payload.content) },
        }),
      });
    }
  }
  return readPage(page, schema, payload.content || "");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders() });
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/health"))
      return json({ ok: true, service: "notion-sync" });
    const kind = (url.searchParams.get("kind") || "travel") as Kind;
    if (!["travel", "expenses"].includes(kind))
      return json({ error: "kind must be travel or expenses" }, 400);
    const dataSourceId = sourceId(kind);
    const schema = await dataSourceSchema(dataSourceId);

    if (request.method === "GET") {
      const pages = await queryPages(dataSourceId);
      const includeContent = url.searchParams.get("content") !== "false";
      const records = await mapLimit(pages, 5, async (page) =>
        readPage(
          page,
          schema,
          includeContent ? await pageMarkdown(page.id) : "",
        ),
      );
      return json({
        ok: true,
        kind,
        syncedAt: new Date().toISOString(),
        records,
      });
    }

    if (request.method === "POST" || request.method === "PATCH") {
      const payload = await request.json();
      const record = await writePage(kind, payload, request.method);
      return json({ ok: true, record }, request.method === "POST" ? 201 : 200);
    }

    if (request.method === "DELETE") {
      const payload = await request.json();
      if (!payload.id) return json({ error: "DELETE requires id" }, 400);
      await notion(`/pages/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      return json({ ok: true, id: payload.id, archived: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
