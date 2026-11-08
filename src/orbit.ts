import { config } from "./config";

/**
 * Orbit client over its MCP endpoint (POST /mcp, JSON-RPC), authenticated with the orb_ token.
 * (Newer Orbit releases also have a REST API at /api/public/v1, but this instance doesn't yet.)
 */

interface Project { id: string; key: string; name: string }
interface Status { id: string; name: string; category: string }
export interface Task { id: string; identifier?: string; url?: string; title: string }

let rpcId = 0;
let sessionId: string | null = null;

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.orbitToken}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(`${config.orbitUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const sid = res.headers.get("Mcp-Session-Id");
  if (sid) sessionId = sid;
  const text = await res.text();
  if (!res.ok) throw new Error(`[orbit] ${method} -> ${res.status}: ${text}`);

  // The server may answer as plain JSON or as a single SSE "data:" frame.
  const json = text.trimStart().startsWith("{")
    ? JSON.parse(text)
    : JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("\n"));
  if (json.error) throw new Error(`[orbit] ${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json.result as T;
}

async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await rpc<{ isError?: boolean; structuredContent?: T; content?: { text?: string }[] }>(
    "tools/call",
    { name, arguments: args },
  );
  const text = result.content?.map((c) => c.text ?? "").join("\n") ?? "";
  if (result.isError) throw new Error(`[orbit] ${name}: ${text}`);
  return (result.structuredContent ?? JSON.parse(text)) as T;
}

let target: { projectId: string; statusId: string } | null = null;

/** Finds the project and the "Feedback" status (column) once, at startup. */
export async function initOrbit(): Promise<void> {
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "sgc-feedback-bot", version: "1.0.0" },
  });
  await fetch(`${config.orbitUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.orbitToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const { items: projects } = await callTool<{ items: Project[] }>("list_projects", {});
  const key = config.orbitProjectKey.toLowerCase();
  const project = key ? projects.find((p) => p.key.toLowerCase() === key) : projects[0];
  if (!project) {
    throw new Error(
      `[orbit] project "${config.orbitProjectKey}" not found; token can see: ${projects.map((p) => p.key).join(", ") || "none"}`,
    );
  }

  const { items: statuses } = await callTool<{ items: Status[] }>("list_task_statuses", {
    project_id: project.id,
    limit: 100,
  });
  const wanted = config.orbitStatusName.toLowerCase();
  const status = statuses.find((s) => s.name.toLowerCase() === wanted);
  if (!status) {
    throw new Error(
      `[orbit] status "${config.orbitStatusName}" not found in ${project.key}; available: ${statuses.map((s) => s.name).join(", ")}`,
    );
  }

  target = { projectId: project.id, statusId: status.id };
  console.log(`[orbit] feedback goes to ${project.key} / ${status.name}`);
}

export async function createFeedbackTask(title: string, description: string): Promise<Task> {
  if (!target) throw new Error("[orbit] initOrbit() not called");
  return callTool<Task>("create_task", {
    project_id: target.projectId,
    status_id: target.statusId,
    title,
    description,
  });
}
