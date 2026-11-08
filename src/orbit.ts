import { config } from "./config";

/**
 * Orbit client over its public REST API (/api/public/v1), authenticated with an orb_ token.
 * Docs: https://github.com/coollabsio/orbit/blob/main/docs/public-api.md
 */

interface Project { id: string; key: string; name: string }
interface Status { id: string; name: string; category: string }
interface Me { workspace: { id: string; name: string } }
export interface Task { id: string; identifier: string; url: string; title: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.orbitUrl}/api/public/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.orbitToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get("Retry-After")) || 5;
      console.warn(`[orbit] rate limited, retrying in ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) {
      // Errors are RFC 9457 problem documents: { code, detail, errors?, ... }
      const text = await res.text();
      let detail = text;
      try {
        const p = JSON.parse(text);
        detail = [p.code, p.detail, p.errors && JSON.stringify(p.errors)].filter(Boolean).join(": ");
      } catch {}
      throw new Error(`[orbit] ${method} ${path} -> ${res.status} ${detail}`);
    }
    return (await res.json()) as T;
  }
}

let target: { workspaceId: string; projectId: string; statusId: string } | null = null;

/** Finds the workspace, project and the "Feedback" status (column) once, at startup. */
export async function initOrbit(): Promise<void> {
  const { workspace } = await request<Me>("GET", "/me");
  const ws = `/workspaces/${workspace.id}`;

  const { items: projects } = await request<{ items: Project[] }>("GET", `${ws}/projects`);
  const key = config.orbitProjectKey.toLowerCase();
  const project = key ? projects.find((p) => p.key.toLowerCase() === key) : projects[0];
  if (!project) {
    throw new Error(
      `[orbit] project "${config.orbitProjectKey}" not found; token can see: ${projects.map((p) => p.key).join(", ") || "none"}`,
    );
  }

  const { items: statuses } = await request<{ items: Status[] }>(
    "GET",
    `${ws}/projects/${project.id}/statuses?limit=100`,
  );
  const wanted = config.orbitStatusName.toLowerCase();
  const status = statuses.find((s) => s.name.toLowerCase() === wanted);
  if (!status) {
    throw new Error(
      `[orbit] status "${config.orbitStatusName}" not found in ${project.key}; available: ${statuses.map((s) => s.name).join(", ")}`,
    );
  }

  target = { workspaceId: workspace.id, projectId: project.id, statusId: status.id };
  console.log(`[orbit] feedback goes to ${workspace.name} / ${project.key} / ${status.name}`);
}

export async function createFeedbackTask(title: string, description: string): Promise<Task> {
  if (!target) throw new Error("[orbit] initOrbit() not called");
  return request<Task>("POST", `/workspaces/${target.workspaceId}/tasks`, {
    project_id: target.projectId,
    status_id: target.statusId,
    title,
    description,
  });
}
