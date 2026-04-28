"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HelpTooltip } from "@/components/ui/tooltip";
import { adminFetch, ApiError, listProviders, type ProviderItem } from "@/lib/api";

// ── Types matching the backend JSON schema ──────────────────────────────────

type TargetMode = "weighted" | "failover" | "conditional";
type SelectionStrategy = "auto" | "weighted" | "failover" | "conditional";

interface RouteTarget {
  provider_id: string;
  mode: TargetMode;
  weight?: number;
  priority?: number;
  disabled?: boolean;
}

interface RouteMatch {
  host?: string;
  path_prefix?: string;
  methods?: string[];
}

interface Route {
  id: string;
  name: string;
  description: string;
  disabled: boolean;
  read_only?: boolean;
  llm_api?: string;
  match?: RouteMatch;
  targets: RouteTarget[];
  policy: {
    auth: { require_local_api_key: boolean };
    selection: { strategy: SelectionStrategy };
    timeout_seconds: number;
    retry: { max_attempts: number };
    allow_streaming?: boolean | null;
    allow_tools?: boolean | null;
  };
  created_at: string;
  updated_at: string;
}

// ── API helpers ─────────────────────────────────────────────────────────────

async function fetchRoutes(): Promise<Route[]> {
  const data = await adminFetch<{ items: Route[] }>("/admin/routes");
  return data.items ?? [];
}

interface LlmApiHandlerEntry { llm_api_handler_type: string; enabled: boolean }

async function fetchLlmApiHandlerTypes(): Promise<LlmApiHandlerEntry[]> {
  const data = await adminFetch<{ items: LlmApiHandlerEntry[] }>("/admin/llm_api_handler_types");
  return data.items ?? [];
}

async function createRoute(route: Omit<Route, "created_at" | "updated_at">): Promise<Route> {
  return adminFetch<Route>("/admin/routes", {
    method: "POST",
    body: JSON.stringify(route),
  });
}

async function updateRoute(id: string, route: Route): Promise<Route> {
  return adminFetch<Route>(`/admin/routes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(route),
  });
}

async function deleteRoute(id: string): Promise<void> {
  await adminFetch(`/admin/routes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Style maps ──────────────────────────────────────────────────────────────

const STRATEGY_COLORS: Record<SelectionStrategy, string> = {
  auto: "bg-blue-500/15 text-blue-300",
  weighted: "bg-violet-500/15 text-violet-300",
  failover: "bg-amber-500/15 text-amber-300",
  conditional: "bg-cyan-500/15 text-cyan-300",
};

const MODE_COLORS: Record<TargetMode, string> = {
  weighted: "bg-violet-500/15 text-violet-300",
  failover: "bg-amber-500/15 text-amber-300",
  conditional: "bg-cyan-500/15 text-cyan-300",
};

// ── Target draft (string values for controlled inputs) ───────────────────────

interface TargetDraft {
  provider_id: string;
  mode: TargetMode;
  weight: string;
  priority: string;
}

type CapabilityChoice = "unset" | "allow" | "block";

function capabilityToValue(c: CapabilityChoice): boolean | null {
  if (c === "allow") return true;
  if (c === "block") return false;
  return null;
}

const defaultTarget = (): TargetDraft => ({ provider_id: "", mode: "weighted", weight: "100", priority: "1" });

// ── Page component ───────────────────────────────────────────────────────────

export default function RoutesPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  // Create form state
  const [formId, setFormId] = useState<string>("");
  const [formDesc, setFormDesc] = useState("");
  const [formStrategy, setFormStrategy] = useState<SelectionStrategy>("auto");
  const [formRequireKey, setFormRequireKey] = useState(true);
  const [formTimeout, setFormTimeout] = useState("120");
  const [formRetryMax, setFormRetryMax] = useState("1");
  const [formAllowStreaming, setFormAllowStreaming] = useState<CapabilityChoice>("unset");
  const [formAllowTools, setFormAllowTools] = useState<CapabilityChoice>("unset");
  const [formTargets, setFormTargets] = useState<TargetDraft[]>([defaultTarget()]);
  const [formLlmApiHandler, setFormLlmApiHandler] = useState("");
  const [llmApiHandlerNames, setLlmApiHandlerNames] = useState<LlmApiHandlerEntry[]>([]);
  const [loadingHandlers, setLoadingHandlers] = useState(false);
  const [providerOptions, setProviderOptions] = useState<ProviderItem[]>([]);
  const [formMatchHost, setFormMatchHost] = useState("");
  const [formMatchPathPrefix, setFormMatchPathPrefix] = useState("");
  const [formMatchMethods, setFormMatchMethods] = useState("");

  const loadRoutes = useCallback(async () => {
    setLoading(true);
    try {
      setRoutes(await fetchRoutes());
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to load routes";
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRoutes();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRoutes]);

  const activeCount = routes.filter((r) => !r.disabled).length;
  const totalTargets = routes.reduce((s, r) => s + (r.targets?.length ?? 0), 0);

  const openCreate = async () => {
    setFormId(""); setFormDesc("");
    setFormStrategy("auto"); setFormRequireKey(true); setFormTimeout("120");
    setFormRetryMax("1"); setFormAllowStreaming("unset"); setFormAllowTools("unset");
    setFormTargets([defaultTarget()]); setFormLlmApiHandler(""); setLlmApiHandlerNames([]); setProviderOptions([]);
    setFormMatchHost(""); setFormMatchPathPrefix(""); setFormMatchMethods("");
    setIsCreateOpen(true);
    setLoadingHandlers(true);
    try {
      const [names, providers] = await Promise.all([fetchLlmApiHandlerTypes(), listProviders()]);
      setLlmApiHandlerNames(names);
      setProviderOptions(providers);
      const first = names.find((n) => n.enabled) ?? names[0];
      if (first) setFormLlmApiHandler(first.llm_api_handler_type);
    } catch {
      setLlmApiHandlerNames([]);
      setProviderOptions([]);
    } finally {
      setLoadingHandlers(false);
    }
  };

  const openEdit = async (route: Route) => {
    setEditingRoute(route);
    setFormId(route.id);
    setFormDesc(route.description ?? "");
    setFormStrategy(route.policy?.selection?.strategy ?? "auto");
    setFormRequireKey(route.policy?.auth?.require_local_api_key ?? true);
    setFormTimeout(String(route.policy?.timeout_seconds ?? 120));
    setFormRetryMax(String(route.policy?.retry?.max_attempts ?? 1));
    const sv = route.policy?.allow_streaming;
    setFormAllowStreaming(sv == null ? "unset" : sv ? "allow" : "block");
    const tv = route.policy?.allow_tools;
    setFormAllowTools(tv == null ? "unset" : tv ? "allow" : "block");
    setFormTargets(
      (route.targets ?? []).length > 0
        ? route.targets.map((t) => ({
            provider_id: t.provider_id,
            mode: t.mode,
            weight: String(t.weight ?? 100),
            priority: String(t.priority ?? 1),
          }))
        : [defaultTarget()]
    );
    setFormLlmApiHandler(route.llm_api ?? "");
    setFormMatchHost(route.match?.host ?? "");
    setFormMatchPathPrefix(route.match?.path_prefix ?? "");
    setFormMatchMethods((route.match?.methods ?? []).join(" "));
    setIsEditOpen(true);
    setLoadingHandlers(true);
    try {
      const [names, providers] = await Promise.all([fetchLlmApiHandlerTypes(), listProviders()]);
      setLlmApiHandlerNames(names);
      setProviderOptions(providers);
    } catch {
      setLlmApiHandlerNames([]);
      setProviderOptions([]);
    } finally {
      setLoadingHandlers(false);
    }
  };

  const handleEdit = async () => {
    if (!editingRoute) return;
    if (!formId.trim()) { showToast("Route ID is required", "error"); return; }
    const filledTargets = formTargets.filter((t) => t.provider_id.trim());
    if (filledTargets.length === 0) { showToast("At least one target provider is required", "error"); return; }

    const targets: RouteTarget[] = filledTargets.map((t) => {
      const base: RouteTarget = { provider_id: t.provider_id.trim(), mode: t.mode };
      if (t.mode === "weighted") base.weight = parseInt(t.weight, 10) || 100;
      if (t.mode === "failover") base.priority = parseInt(t.priority, 10) || 1;
      return base;
    });

    const allowStreaming = capabilityToValue(formAllowStreaming);
    const allowTools = capabilityToValue(formAllowTools);

    const parsedMethods = formMatchMethods.trim()
      ? formMatchMethods.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
      : undefined;
    const matchConf: RouteMatch | undefined =
      (formMatchHost.trim() || formMatchPathPrefix.trim() || parsedMethods)
        ? {
            ...(formMatchHost.trim() && { host: formMatchHost.trim() }),
            ...(formMatchPathPrefix.trim() && { path_prefix: formMatchPathPrefix.trim() }),
            ...(parsedMethods && { methods: parsedMethods }),
          }
        : undefined;

    const payload: Route = {
      ...editingRoute,
      name: formId.trim(),
      description: formDesc.trim(),
      ...(formLlmApiHandler ? { llm_api: formLlmApiHandler } : {}),
      ...(matchConf ? { match: matchConf } : { match: undefined }),
      targets,
      policy: {
        auth: { require_local_api_key: formRequireKey },
        selection: { strategy: formStrategy },
        timeout_seconds: parseInt(formTimeout, 10) || 120,
        retry: { max_attempts: parseInt(formRetryMax, 10) || 1 },
        ...(allowStreaming !== null && { allow_streaming: allowStreaming }),
        ...(allowTools !== null && { allow_tools: allowTools }),
      },
    };

    setSaving(true);
    try {
      const updated = await updateRoute(editingRoute.id, payload);
      setRoutes((prev) => prev.map((r) => r.id === editingRoute.id ? updated : r));
      setIsEditOpen(false);
      setEditingRoute(null);
      showToast("Route updated", "success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update route";
      showToast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const updateTarget = (idx: number, patch: Partial<TargetDraft>) =>
    setFormTargets((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));

  const handleCreate = async () => {
    if (!formId.trim()) { showToast("Route ID is required", "error"); return; }
    if (!formLlmApiHandler) { showToast("LLM API handler is required", "error"); return; }
    const filledTargets = formTargets.filter((t) => t.provider_id.trim());
    if (filledTargets.length === 0) { showToast("At least one target provider is required", "error"); return; }

    const targets: RouteTarget[] = filledTargets.map((t) => {
      const base: RouteTarget = { provider_id: t.provider_id.trim(), mode: t.mode };
      if (t.mode === "weighted") base.weight = parseInt(t.weight, 10) || 100;
      if (t.mode === "failover") base.priority = parseInt(t.priority, 10) || 1;
      return base;
    });

    const allowStreaming = capabilityToValue(formAllowStreaming);
    const allowTools = capabilityToValue(formAllowTools);

    const parsedMethods = formMatchMethods.trim() ? formMatchMethods.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined;
    const matchConf: RouteMatch | undefined =
      (formMatchHost.trim() || formMatchPathPrefix.trim() || parsedMethods)
        ? {
            ...(formMatchHost.trim() && { host: formMatchHost.trim() }),
            ...(formMatchPathPrefix.trim() && { path_prefix: formMatchPathPrefix.trim() }),
            ...(parsedMethods && { methods: parsedMethods }),
          }
        : undefined;

    const payload: Omit<Route, "created_at" | "updated_at"> = {
      id: formId.trim(),
      name: formId.trim(),
      description: formDesc.trim(),
      disabled: false,
      ...(formLlmApiHandler && { llm_api: formLlmApiHandler }),
      ...(matchConf && { match: matchConf }),
      targets,
      policy: {
        auth: { require_local_api_key: formRequireKey },
        selection: { strategy: formStrategy },
        timeout_seconds: parseInt(formTimeout, 10) || 120,
        retry: { max_attempts: parseInt(formRetryMax, 10) || 1 },
        ...(allowStreaming !== null && { allow_streaming: allowStreaming }),
        ...(allowTools !== null && { allow_tools: allowTools }),
      },
    };
    setSaving(true);
    try {
      const created = await createRoute(payload);
      setRoutes((prev) => [...prev, created]);
      setIsCreateOpen(false);
      showToast("Route created", "success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create route";
      showToast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDisabled = async (id: string) => {
    const route = routes.find((r) => r.id === id);
    if (!route) return;
    const updated = { ...route, disabled: !route.disabled };
    try {
      const result = await updateRoute(id, updated);
      setRoutes((prev) => prev.map((r) => r.id === id ? result : r));
      showToast(result.disabled ? "Route disabled" : "Route enabled", "success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update route";
      showToast(msg, "error");
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    setSaving(true);
    try {
      await deleteRoute(pendingDeleteId);
      setRoutes((prev) => prev.filter((r) => r.id !== pendingDeleteId));
      setExpandedId(null);
      showToast("Route deleted", "success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to delete route";
      showToast(msg, "error");
    } finally {
      setSaving(false);
      setShowConfirm(false);
      setPendingDeleteId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">Routes</h1>
            <p className="mt-1 text-xs text-slate-400">
              Define routing rules that map incoming requests to upstream LLM providers.
              <HelpTooltip content="Each route owns target selection, auth policy, rate limits, and retry behavior." />
            </p>
          </div>
          <Button onClick={openCreate} className="px-2.5 py-1 text-xs">
            Create Route
          </Button>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: "Total Routes", value: routes.length },
          { label: "Active", value: activeCount },
          { label: "Disabled", value: routes.length - activeCount },
          { label: "Total Targets", value: totalTargets },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </section>

      {/* Route list */}
      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">Loading routes…</p>
        </div>
      ) : routes.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">No routes yet. Create one to start routing traffic.</p>
          <Button onClick={openCreate} className="mt-4 px-3 py-1.5 text-xs">Create Route</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {routes.map((route) => {
            const isExpanded = expandedId === route.id;
            const strategy = route.policy?.selection?.strategy ?? "auto";
            return (
              <section
                key={route.id}
                className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40"
              >
                {/* Row */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => setExpandedId(isExpanded ? null : route.id)}
                    aria-expanded={isExpanded}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-100">{route.name || route.id}</span>
                      <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${STRATEGY_COLORS[strategy]}`}>
                        {strategy}
                      </span>
                      {route.llm_api && (
                        <span className="inline-flex rounded-sm bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
                          {route.llm_api}
                        </span>
                      )}
                      {route.disabled && (
                        <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                          disabled
                        </span>
                      )}
                    </div>
                    {route.description && (
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{route.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(route.targets ?? []).map((t, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-sm border border-slate-700/60 bg-slate-800/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                          {t.provider_id}
                          <span className={`rounded-sm px-1 py-px text-[9px] ${MODE_COLORS[t.mode]}`}>{t.mode}</span>
                          {t.mode === "weighted" && t.weight != null && (
                            <span className="text-slate-500">{t.weight}%</span>
                          )}
                          {t.mode === "failover" && t.priority != null && (
                            <span className="text-slate-500">p{t.priority}</span>
                          )}
                        </span>
                      ))}
                      {(!route.targets || route.targets.length === 0) && (
                        <span className="text-[10px] text-slate-600">no targets</span>
                      )}
                    </div>
                    {(route.match?.host || route.match?.path_prefix || route.match?.methods?.length) ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {route.match?.host && (
                          <span className="inline-flex items-center gap-1 rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                            <span className="text-slate-600">host:</span>{route.match.host}
                          </span>
                        )}
                        {route.match?.path_prefix && (
                          <span className="inline-flex items-center gap-1 rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                            <span className="text-slate-600">prefix:</span>{route.match.path_prefix}
                          </span>
                        )}
                        {(route.match?.methods ?? []).map((m, i) => (
                          <span key={i} className="inline-flex rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                            {m}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!!route.read_only}
                      onClick={() => handleToggleDisabled(route.id)}
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        route.disabled
                          ? "border-slate-600/60 bg-slate-800/40 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-slate-600/60 hover:bg-slate-800/40 hover:text-slate-400"
                      }`}
                      title={route.read_only ? "Read-only route — not editable" : route.disabled ? "Enable route" : "Disable route"}
                    >
                      {route.disabled ? "Enable" : "Active"}
                    </button>
                    <span title={route.read_only ? "Read-only route — not editable" : undefined}>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-[10px]"
                        disabled={!!route.read_only}
                        onClick={() => openEdit(route)}
                      >
                        Edit
                      </Button>
                    </span>
                    <span title={route.read_only ? "Read-only route — not editable" : undefined}>
                      <Button
                        variant="danger"
                        className="px-2 py-1 text-[10px]"
                        disabled={!!route.read_only}
                        onClick={() => { setPendingDeleteId(route.id); setShowConfirm(true); }}
                      >
                        Delete
                      </Button>
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : route.id)}
                      className="rounded-md border border-slate-700/60 bg-slate-800/40 p-1 text-slate-400 transition-colors hover:bg-slate-700/60 hover:text-slate-200"
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      <svg
                        className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Detail panel */}
                {isExpanded && (
                  <div className="border-t border-slate-700/60 bg-slate-950/30 px-3 py-3">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {/* Auth & Policy */}
                      <div>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Auth & Policy</p>
                        <div className="space-y-1 text-[11px] text-slate-300">
                          {route.llm_api && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">LLM API handler</span>
                              <span className="font-mono text-indigo-300">{route.llm_api}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-slate-500">Require local key</span>
                            <span className={route.policy?.auth?.require_local_api_key ? "text-emerald-300" : "text-slate-400"}>
                              {route.policy?.auth?.require_local_api_key ? "Yes" : "No"}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Selection strategy</span>
                            <span className={`rounded-sm px-1 py-px text-[10px] ${STRATEGY_COLORS[strategy]}`}>
                              {strategy}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Timeout</span>
                            <span>{route.policy?.timeout_seconds ?? "—"}s</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Max retries</span>
                            <span>{route.policy?.retry?.max_attempts ?? "—"}</span>
                          </div>
                        </div>
                      </div>

                      {/* Capabilities */}
                      <div>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Capabilities</p>
                        <div className="space-y-1 text-[11px]">
                          {[
                            { label: "Streaming", value: route.policy?.allow_streaming },
                            { label: "Tools / Function calls", value: route.policy?.allow_tools },
                          ].map(({ label, value }) => (
                            <div key={label} className="flex justify-between">
                              <span className="text-slate-500">{label}</span>
                              {value == null ? (
                                <span className="text-slate-600">—</span>
                              ) : (
                                <span className={value ? "text-emerald-300" : "text-slate-400"}>{value ? "Allowed" : "Blocked"}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Targets detail */}
                      <div>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          Targets ({route.targets?.length ?? 0})
                        </p>
                        {(!route.targets || route.targets.length === 0) ? (
                          <p className="text-[11px] text-slate-600">No targets configured.</p>
                        ) : (
                          <div className="space-y-1">
                            {route.targets.map((t, i) => (
                              <div key={i} className="flex items-center justify-between rounded-sm border border-slate-700/50 bg-slate-900/40 px-2 py-1">
                                <span className="font-mono text-[11px] text-slate-200">{t.provider_id}</span>
                                <div className="flex items-center gap-1.5">
                                  <span className={`rounded-sm px-1.5 py-px text-[9px] font-medium ${MODE_COLORS[t.mode]}`}>{t.mode}</span>
                                  {t.mode === "weighted" && t.weight != null && (
                                    <span className="text-[10px] text-slate-400">w={t.weight}</span>
                                  )}
                                  {t.mode === "failover" && t.priority != null && (
                                    <span className="text-[10px] text-slate-400">p={t.priority}</span>
                                  )}
                                  {t.disabled && (
                                    <span className="text-[9px] text-slate-600">off</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Match */}
                      <div>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Match</p>
                        {(!route.match?.host && !route.match?.path_prefix && !route.match?.methods?.length) ? (
                          <p className="text-[11px] text-slate-600">Match all requests.</p>
                        ) : (
                          <div className="space-y-1 text-[11px]">
                            {route.match?.host && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Host</span>
                                <span className="font-mono text-slate-200">{route.match.host}</span>
                              </div>
                            )}
                            {route.match?.path_prefix && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Path Prefix</span>
                                <span className="font-mono text-slate-200">{route.match.path_prefix}</span>
                              </div>
                            )}
                            {route.match?.methods?.length ? (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Methods</span>
                                <span className="flex gap-1">
                                  {route.match.methods.map((m, i) => (
                                    <span key={i} className="rounded-sm bg-slate-800/60 px-1.5 py-px font-mono text-[10px] text-slate-300">{m}</span>
                                  ))}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-700/50 pt-2">
                      <span className="text-[10px] text-slate-600">
                        ID: <span className="font-mono text-slate-500">{route.id}</span>
                        {" · "}Created {new Date(route.created_at).toLocaleDateString()}
                        {" · "}Updated {new Date(route.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
        <ModalHeader><ModalTitle>Create Route</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-5">

            {/* Basic info */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Basic Info</p>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Route ID <span className="text-red-400">*</span>
                </label>
                <Input name="name" value={formId} onChange={setFormId} placeholder="e.g. default, ha-fallback" />
                <p className="mt-1 text-xs text-slate-500">Used in Caddyfile and API requests.</p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">Description</label>
                <Input name="description" value={formDesc} onChange={setFormDesc} placeholder="Optional description" />
              </div>
            </div>

            {/* Match */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Match
                <HelpTooltip content="Restrict this route to a specific host, path prefix, or HTTP methods. Leave blank to match all requests." />
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Host</label>
                  <Input name="match-host" value={formMatchHost} onChange={setFormMatchHost} placeholder="api.example.com" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Path Prefix</label>
                  <Input name="match-path-prefix" value={formMatchPathPrefix} onChange={setFormMatchPathPrefix} placeholder="/v1/" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Methods
                  <HelpTooltip content="Comma or space separated, e.g. GET POST. Leave blank to allow all methods." />
                </label>
                <Input name="match-methods" value={formMatchMethods} onChange={setFormMatchMethods} placeholder="GET POST" />
              </div>
            </div>

            {/* LLM API Handler */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                LLM API Handler <span className="text-red-400">*</span>
                <HelpTooltip content="The API protocol this route exposes to callers (e.g. openai, anthropic). Determines the request/response format." />
              </p>
              <select
                value={formLlmApiHandler}
                onChange={(e) => setFormLlmApiHandler(e.target.value)}
                disabled={loadingHandlers}
                className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none disabled:opacity-50"
              >
                {loadingHandlers ? (
                  <option value="">Loading…</option>
                ) : (
                  <>
                    <option value="">— none —</option>
                    {llmApiHandlerNames.map((entry) => (
                      <option key={entry.llm_api_handler_type} value={entry.llm_api_handler_type} disabled={!entry.enabled}>
                        {entry.llm_api_handler_type}{!entry.enabled ? " (disabled)" : ""}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            {/* Targets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Targets <span className="text-red-400">*</span>
                  <HelpTooltip content="Each target points to a provider. Mode and weight/priority control how traffic is distributed." />
                </p>
                <button
                  type="button"
                  onClick={() => setFormTargets((prev) => [...prev, defaultTarget()])}
                  className="rounded border border-slate-600/60 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300 hover:border-blue-500/40 hover:text-blue-300"
                >
                  + Add Target
                </button>
              </div>
              {formTargets.map((t, idx) => (
                <div key={idx} className="rounded-md border border-slate-700/60 bg-slate-900/50 p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <select
                        value={t.provider_id}
                        onChange={(e) => updateTarget(idx, { provider_id: e.target.value })}
                        className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none disabled:opacity-50"
                      >
                        <option value="">— select provider —</option>
                        {providerOptions.map((p) => (
                          <option key={p.id} value={p.id}>{p.id}</option>
                        ))}
                      </select>
                    </div>
                    <select
                      value={t.mode}
                      onChange={(e) => updateTarget(idx, { mode: e.target.value as TargetMode })}
                      className="rounded-md border border-slate-700/70 bg-slate-900/60 px-2 py-2 text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none"
                    >
                      <option value="weighted">weighted</option>
                      <option value="failover">failover</option>
                      <option value="conditional">conditional</option>
                    </select>
                    {formTargets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setFormTargets((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded border border-slate-700/50 bg-slate-800/40 px-1.5 py-1 text-[10px] text-slate-500 hover:border-red-500/40 hover:text-red-400"
                        title="Remove target"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {t.mode === "weighted" && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-400 whitespace-nowrap">Weight (%)</label>
                      <Input
                        name={`target-weight-${idx}`}
                        value={t.weight}
                        onChange={(v) => updateTarget(idx, { weight: v })}
                        placeholder="100"
                      />
                    </div>
                  )}
                  {t.mode === "failover" && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-400 whitespace-nowrap">Priority</label>
                      <Input
                        name={`target-priority-${idx}`}
                        value={t.priority}
                        onChange={(v) => updateTarget(idx, { priority: v })}
                        placeholder="1"
                      />
                      <p className="text-[10px] text-slate-600">Lower = higher priority</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Selection & Timeout */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Routing Policy</p>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Selection Strategy
                  <HelpTooltip content="auto: conditional → weighted; weighted: distribute by weight; failover: by priority; conditional: capability-based" />
                </label>
                <select
                  value={formStrategy}
                  onChange={(e) => setFormStrategy(e.target.value as SelectionStrategy)}
                  className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
                >
                  <option value="auto">auto</option>
                  <option value="weighted">weighted</option>
                  <option value="failover">failover</option>
                  <option value="conditional">conditional</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Timeout (seconds)</label>
                  <Input name="timeout" value={formTimeout} onChange={setFormTimeout} placeholder="120" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">
                    Max Retries
                    <HelpTooltip content="Maximum retry attempts before returning an error to the caller." />
                  </label>
                  <Input name="retry" value={formRetryMax} onChange={setFormRetryMax} placeholder="1" />
                </div>
              </div>
            </div>

            {/* Capabilities */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Capabilities
                <HelpTooltip content="Unset means the gateway does not enforce a restriction; allow/block explicitly permits or denies the feature." />
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Streaming</label>
                  <select
                    value={formAllowStreaming}
                    onChange={(e) => setFormAllowStreaming(e.target.value as CapabilityChoice)}
                    className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
                  >
                    <option value="unset">Unset (default)</option>
                    <option value="allow">Allow</option>
                    <option value="block">Block</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Tools / Function calls</label>
                  <select
                    value={formAllowTools}
                    onChange={(e) => setFormAllowTools(e.target.value as CapabilityChoice)}
                    className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
                  >
                    <option value="unset">Unset (default)</option>
                    <option value="allow">Allow</option>
                    <option value="block">Block</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Auth */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Auth</p>
              <div className="flex items-center gap-2.5">
                <input
                  id="require-key"
                  type="checkbox"
                  checked={formRequireKey}
                  onChange={(e) => setFormRequireKey(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
                />
                <label htmlFor="require-key" className="text-sm text-slate-300">
                  Require local API key
                  <HelpTooltip content="When enabled, callers must present a gateway local API key in the Authorization header." />
                </label>
              </div>
            </div>

          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? "Creating…" : "Create Route"}</Button>
        </ModalFooter>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={isEditOpen} onClose={() => { setIsEditOpen(false); setEditingRoute(null); }}>
        <ModalHeader><ModalTitle>Edit Route — {editingRoute?.name || editingRoute?.id}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Basic Info</p>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">Route ID <span className="text-red-400">*</span></label>
                <Input name="edit-name" value={formId} onChange={setFormId} placeholder="e.g. default" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">Description</label>
                <Input name="edit-description" value={formDesc} onChange={setFormDesc} placeholder="Optional description" />
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Match
                <HelpTooltip content="Restrict this route to a specific host, path prefix, or HTTP methods. Leave blank to match all requests." />
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Host</label>
                  <Input name="edit-match-host" value={formMatchHost} onChange={setFormMatchHost} placeholder="api.example.com" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Path Prefix</label>
                  <Input name="edit-match-path-prefix" value={formMatchPathPrefix} onChange={setFormMatchPathPrefix} placeholder="/v1/" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Methods
                  <HelpTooltip content="Comma or space separated, e.g. GET POST. Leave blank to allow all methods." />
                </label>
                <Input name="edit-match-methods" value={formMatchMethods} onChange={setFormMatchMethods} placeholder="GET POST" />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                LLM API Handler
                <HelpTooltip content="The API protocol this route exposes to callers." />
              </p>
              <select
                value={formLlmApiHandler}
                onChange={(e) => setFormLlmApiHandler(e.target.value)}
                disabled={loadingHandlers}
                className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none disabled:opacity-50"
              >
                {loadingHandlers ? (
                  <option value="">Loading…</option>
                ) : (
                  <>
                    <option value="">— none —</option>
                    {llmApiHandlerNames.map((entry) => (
                      <option key={entry.llm_api_handler_type} value={entry.llm_api_handler_type} disabled={!entry.enabled}>
                        {entry.llm_api_handler_type}{!entry.enabled ? " (disabled)" : ""}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Targets <span className="text-red-400">*</span>
                  <HelpTooltip content="Each target points to a provider." />
                </p>
                <button
                  type="button"
                  onClick={() => setFormTargets((prev) => [...prev, defaultTarget()])}
                  className="rounded border border-slate-600/60 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300 hover:border-blue-500/40 hover:text-blue-300"
                >
                  + Add Target
                </button>
              </div>
              {formTargets.map((t, idx) => (
                <div key={idx} className="rounded-md border border-slate-700/60 bg-slate-900/50 p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <select
                        value={t.provider_id}
                        onChange={(e) => updateTarget(idx, { provider_id: e.target.value })}
                        className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
                      >
                        <option value="">— select provider —</option>
                        {providerOptions.map((p) => (
                          <option key={p.id} value={p.id}>{p.id}</option>
                        ))}
                      </select>
                    </div>
                    <select
                      value={t.mode}
                      onChange={(e) => updateTarget(idx, { mode: e.target.value as TargetMode })}
                      className="rounded-md border border-slate-700/70 bg-slate-900/60 px-2 py-2 text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none"
                    >
                      <option value="weighted">weighted</option>
                      <option value="failover">failover</option>
                      <option value="conditional">conditional</option>
                    </select>
                    {formTargets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setFormTargets((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded border border-slate-700/50 bg-slate-800/40 px-1.5 py-1 text-[10px] text-slate-500 hover:border-red-500/40 hover:text-red-400"
                        title="Remove target"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {t.mode === "weighted" && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-400 whitespace-nowrap">Weight (%)</label>
                      <Input name={`edit-target-weight-${idx}`} value={t.weight} onChange={(v) => updateTarget(idx, { weight: v })} placeholder="100" />
                    </div>
                  )}
                  {t.mode === "failover" && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-400 whitespace-nowrap">Priority</label>
                      <Input name={`edit-target-priority-${idx}`} value={t.priority} onChange={(v) => updateTarget(idx, { priority: v })} placeholder="1" />
                      <p className="text-[10px] text-slate-600">Lower = higher priority</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Routing Policy</p>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Selection Strategy
                  <HelpTooltip content="auto: conditional → weighted; weighted: distribute by weight; failover: by priority; conditional: capability-based" />
                </label>
                <select
                  value={formStrategy}
                  onChange={(e) => setFormStrategy(e.target.value as SelectionStrategy)}
                  className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
                >
                  <option value="auto">auto</option>
                  <option value="weighted">weighted</option>
                  <option value="failover">failover</option>
                  <option value="conditional">conditional</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Timeout (seconds)</label>
                  <Input name="edit-timeout" value={formTimeout} onChange={setFormTimeout} placeholder="120" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">
                    Max Retries
                    <HelpTooltip content="Maximum retry attempts before returning an error to the caller." />
                  </label>
                  <Input name="edit-retry" value={formRetryMax} onChange={setFormRetryMax} placeholder="1" />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Capabilities
                <HelpTooltip content="Unset means the gateway does not enforce a restriction; allow/block explicitly permits or denies the feature." />
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Streaming</label>
                  <select
                    value={formAllowStreaming}
                    onChange={(e) => setFormAllowStreaming(e.target.value as CapabilityChoice)}
                    className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
                  >
                    <option value="unset">Unset (default)</option>
                    <option value="allow">Allow</option>
                    <option value="block">Block</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Tools / Function calls</label>
                  <select
                    value={formAllowTools}
                    onChange={(e) => setFormAllowTools(e.target.value as CapabilityChoice)}
                    className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
                  >
                    <option value="unset">Unset (default)</option>
                    <option value="allow">Allow</option>
                    <option value="block">Block</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Auth</p>
              <div className="flex items-center gap-2.5">
                <input
                  id="edit-require-key"
                  type="checkbox"
                  checked={formRequireKey}
                  onChange={(e) => setFormRequireKey(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
                />
                <label htmlFor="edit-require-key" className="text-sm text-slate-300">
                  Require local API key
                  <HelpTooltip content="When enabled, callers must present a gateway local API key in the Authorization header." />
                </label>
              </div>
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => { setIsEditOpen(false); setEditingRoute(null); }} disabled={saving}>Cancel</Button>
          <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingDeleteId(null); }}
        onConfirm={handleDelete}
        title="Delete Route"
        message="Are you sure you want to delete this route? All associated targets and policy will be removed."
        confirmLabel={saving ? "Deleting…" : "Delete"}
        variant="danger"
      />
    </div>
  );
}
