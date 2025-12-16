"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type {
  AllowedEmail,
  Household,
  HouseholdMember,
  Child,
  AuditLogEntry,
} from "@/lib/types";
import { useLanguage } from "@/lib/i18n/context";

// Extended types for admin view
interface HouseholdWithDetails extends Household {
  members: HouseholdMemberWithEmail[];
  children: Child[];
}

// HouseholdMember already has email field, so we just use the base type
type HouseholdMemberWithEmail = HouseholdMember

interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
}

function formatPrice(price: string, t: any): string {
  const num = parseFloat(price);
  if (num === 0) return t.common.free;
  if (num < 0.000001) return "<$0.001/M";
  return `$${(num * 1000000).toFixed(2)}/M`;
}

function ModelSelector({
  value,
  onChange,
  disabled,
  t,
}: {
  value: string;
  onChange: (modelId: string) => void;
  disabled: boolean;
  t: any;
}) {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchModels = async () => {
    try {
      const res = await fetch("/api/openrouter/models");
      const data = await res.json();
      if (data.models) {
        setModels(data.models);
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
    setLoading(false);
  };

  const selectedModel = models.find((m) => m.id === value);
  const filteredModels = models.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase()),
  );

  // Group models by provider
  const groupedModels = filteredModels.reduce(
    (acc, model) => {
      const provider = model.id.split("/")[0];
      if (!acc[provider]) acc[provider] = [];
      acc[provider].push(model);
      return acc;
    },
    {} as Record<string, OpenRouterModel[]>,
  );

  const providerNames: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    meta: "Meta",
    mistral: "Mistral",
    cohere: "Cohere",
    deepseek: "DeepSeek",
    qwen: "Qwen",
  };

  if (loading) {
    return (
      <div
        className="input animate-pulse"
        style={{ background: "var(--sand)" }}
      >
        {t.admin.loadingModels}
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selected value display */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="input w-full text-left flex items-center justify-between"
        style={{ cursor: disabled ? "not-allowed" : "pointer" }}
      >
        <div className="flex-1 min-w-0">
          {selectedModel ? (
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{selectedModel.name}</span>
              <span
                className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: "var(--sand)", color: "var(--muted)" }}
              >
                {formatPrice(selectedModel.pricing.prompt, t)}
              </span>
            </div>
          ) : (
            <span style={{ color: "var(--muted)" }}>{t.admin.selectModel}</span>
          )}
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`}
          style={{ color: "var(--muted)" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute z-50 w-full mt-2 rounded-xl shadow-lg overflow-hidden"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          {/* Search input */}
          <div
            className="p-3"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <input
              type="text"
              placeholder={t.admin.searchModels}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              autoFocus
            />
          </div>

          {/* Model list */}
          <div className="max-h-80 overflow-y-auto">
            {Object.entries(groupedModels).map(([provider, providerModels]) => (
              <div key={provider}>
                <div
                  className="px-4 py-2 text-xs font-semibold uppercase tracking-wide sticky top-0"
                  style={{ background: "var(--sand)", color: "var(--muted)" }}
                >
                  {providerNames[provider] || provider}
                </div>
                {providerModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => {
                      onChange(model.id);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--sand)] flex items-center justify-between gap-2"
                    style={{
                      background:
                        model.id === value ? "var(--sand)" : undefined,
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-medium truncate"
                        style={{ color: "var(--foreground)" }}
                      >
                        {model.name}
                      </div>
                      <div
                        className="text-xs truncate"
                        style={{ color: "var(--muted)" }}
                      >
                        {model.id} • {(model.context_length / 1000).toFixed(0)}K
                        context
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div
                        className="text-xs font-medium"
                        style={{ color: "var(--color-sage)" }}
                      >
                        {formatPrice(model.pricing.prompt, t)}
                      </div>
                      <div
                        className="text-xs"
                        style={{ color: "var(--muted)" }}
                      >
                        input
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
            {filteredModels.length === 0 && (
              <div
                className="px-4 py-8 text-center"
                style={{ color: "var(--muted)" }}
              >
                {t.admin.noModelsFound}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [allowedEmails, setAllowedEmails] = useState<AllowedEmail[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [households, setHouseholds] = useState<HouseholdWithDetails[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [inviteAsHouseholdAdmin, setInviteAsHouseholdAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Calendar state
  const [calendarStatus, setCalendarStatus] = useState<{
    connected: boolean;
    email: string | null;
    syncedEvents: number;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    checkAdminAndLoad();
  }, []);

  const checkAdminAndLoad = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      router.push("/");
      return;
    }

    // Check admin status via database
    const { data: adminCheck } = await supabase
      .from("allowed_emails")
      .select("is_admin")
      .eq("email", user.email.toLowerCase())
      .single();

    if (!adminCheck?.is_admin) {
      router.push("/");
      return;
    }

    setCurrentUserId(user.id);
    setIsAdmin(true);
    await loadData();
    await loadCalendarStatus();
  };

  const loadCalendarStatus = async () => {
    try {
      const res = await fetch('/api/calendar/sync');
      if (res.ok) {
        const data = await res.json();
        setCalendarStatus(data);
      }
    } catch (error) {
      console.error('Failed to load calendar status:', error);
    }
  };

  const syncCalendar = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/calendar/sync', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        showMessage('success', t.admin.syncSuccess.replace('{added}', data.synced).replace('{deleted}', data.deleted));
        await loadCalendarStatus();
      } else {
        showMessage('error', data.error || t.errors.calendarSyncFailed);
      }
    } catch (error) {
      showMessage('error', t.errors.calendarSyncFailed);
    }
    setSyncing(false);
  };

  const loadData = async () => {
    setLoading(true);

    const [
      emailsResult,
      settingsResult,
      householdsResult,
      membersResult,
      childrenResult,
      auditResult,
    ] = await Promise.all([
      supabase.from("allowed_emails").select("*").order("created_at"),
      supabase.from("app_settings").select("*"),
      supabase.from("households").select("*").order("created_at"),
      supabase.from("household_members").select("*").order("name"),
      supabase.from("children").select("*").order("sort_order"),
      supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    setAllowedEmails(emailsResult.data || []);

    const settingsMap: Record<string, string> = {};
    settingsResult.data?.forEach((s) => {
      settingsMap[s.key] = s.value;
    });
    setSettings(settingsMap);

    // Build households with their members and children
    const householdsWithDetails: HouseholdWithDetails[] = (
      householdsResult.data || []
    ).map((household) => {
      const members = (membersResult.data || [])
        .filter((m) => m.household_id === household.id)
        .map((m) => {
          // Try to find email from allowed_emails via user_id
          // Note: This is a simplified lookup - in production you might need a join
          const memberWithEmail: HouseholdMemberWithEmail = {
            ...m,
            email:
              allowedEmails.find(
                (e) =>
                  // Match by email if we have a lookup table, for now just show user_id
                  m.user_id,
              )?.email || null,
          };
          return memberWithEmail;
        });
      const children = (childrenResult.data || []).filter(
        (c) => c.household_id === household.id,
      );
      return {
        ...household,
        members,
        children,
      };
    });

    setHouseholds(householdsWithDetails);
    setAuditLog(auditResult.data || []);
    setLoading(false);
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const addEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;

    setSaving(true);
    const { error } = await supabase.from("allowed_emails").insert({
      email: newEmail.toLowerCase().trim(),
      added_by: currentUserId,
      can_create_household: inviteAsHouseholdAdmin,
    });

    if (error) {
      showMessage(
        "error",
        error.code === "23505"
          ? t.admin.emailExists
          : t.errors.loadFailed,
      );
    } else {
      setNewEmail("");
      setInviteAsHouseholdAdmin(false);
      loadData();
      showMessage(
        "success",
        inviteAsHouseholdAdmin
          ? t.admin.userAddedCanCreate
          : t.admin.userAdded,
      );
    }
    setSaving(false);
  };

  const deleteEmail = async (id: string, emailItem: AllowedEmail) => {
    if (emailItem.is_admin) {
      showMessage("error", t.admin.cannotDeleteAdmin);
      return;
    }
    const confirmMsg = `${t.common.confirm}: ${emailItem.email}?`;
    if (!confirm(confirmMsg)) return;

    const { error } = await supabase
      .from("allowed_emails")
      .delete()
      .eq("id", id);
    if (error) {
      showMessage("error", t.errors.deleteFailed);
    } else {
      loadData();
    }
  };

  const updateSetting = async (key: string, value: string) => {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() });

    if (error) {
      showMessage("error", t.errors.saveFailed);
    } else {
      setSettings((prev) => ({ ...prev, [key]: value }));
      showMessage("success", t.admin.modelUpdated);
    }
    setSaving(false);
  };

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div
          className="h-10 rounded-xl w-48"
          style={{ background: "var(--sand)" }}
        />
        <div
          className="h-64 rounded-2xl"
          style={{ background: "var(--sand)" }}
        />
        <div
          className="h-48 rounded-2xl"
          style={{ background: "var(--sand)" }}
        />
      </div>
    );
  }

  // Count stats
  const totalHouseholds = households.length;
  const totalMembers = households.reduce((sum, h) => sum + h.members.length, 0);
  const totalChildren = households.reduce(
    (sum, h) => sum + h.children.length,
    0,
  );
  const householdAdmins = households.reduce(
    (sum, h) => sum + h.members.filter((m) => m.is_household_admin).length,
    0,
  );

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1
          className="text-3xl font-semibold font-display"
          style={{ color: "var(--foreground)" }}
        >
          {t.admin.title}
        </h1>
        <p className="mt-2" style={{ color: "var(--muted)" }}>
          {t.admin.allowedEmails}
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div
          className="rounded-2xl p-5"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="text-3xl font-bold"
            style={{ color: "var(--color-honey)" }}
          >
            {totalHouseholds}
          </div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {t.admin.households}
          </div>
        </div>
        <div
          className="rounded-2xl p-5"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="text-3xl font-bold"
            style={{ color: "var(--color-sky)" }}
          >
            {householdAdmins}
          </div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {t.admin.householdAdmin}s
          </div>
        </div>
        <div
          className="rounded-2xl p-5"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="text-3xl font-bold"
            style={{ color: "var(--color-sage)" }}
          >
            {totalMembers}
          </div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {t.admin.membersCount}
          </div>
        </div>
        <div
          className="rounded-2xl p-5"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="text-3xl font-bold"
            style={{ color: "var(--color-coral)" }}
          >
            {totalChildren}
          </div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {t.admin.childrenCount}
          </div>
        </div>
      </div>

      {/* Toast message */}
      {message && (
        <div
          className="fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg animate-slide-up"
          style={{
            background:
              message.type === "success"
                ? "var(--color-sage)"
                : "var(--color-coral)",
            color: "white",
          }}
        >
          {message.text}
        </div>
      )}

      {/* User Access Management */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(126, 182, 196, 0.2)" }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-sky)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <h2
              className="text-xl font-semibold"
              style={{ color: "var(--foreground)" }}
            >
              {t.admin.allowedEmails}
            </h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {t.admin.userAccessDesc}
            </p>
          </div>
        </div>

        {/* Add user form */}
        <form
          onSubmit={addEmail}
          className="mb-6 pb-6"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <p
            className="text-sm font-medium mb-3"
            style={{ color: "var(--foreground)" }}
          >
            {t.admin.addUser}
          </p>
          <div className="flex gap-3 mb-3">
            <input
              type="email"
              placeholder="e-post@eksempel.no"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="input flex-1"
              required
            />
            <button
              type="submit"
              disabled={saving || !newEmail}
              className="btn btn-primary"
            >
              + {t.admin.addUser}
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={inviteAsHouseholdAdmin}
              onChange={(e) => setInviteAsHouseholdAdmin(e.target.checked)}
              className="w-4 h-4 rounded"
              style={{ accentColor: "var(--color-honey)" }}
            />
            <span className="text-sm" style={{ color: "var(--foreground)" }}>
              {t.admin.canCreateOwn}
            </span>
            <span className="badge badge-honey text-xs">
              {t.admin.becomesHouseholdAdmin}
            </span>
          </label>
        </form>

        {/* User overview table */}
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium" style={{ color: "var(--muted)" }}>
            <div className="col-span-5">{t.admin.email}</div>
            <div className="col-span-4">{t.settings.household}</div>
            <div className="col-span-3 text-right">{t.admin.action}</div>
          </div>
          {allowedEmails.map((item) => {
            // Find which household this user belongs to
            const userHousehold = households.find(h =>
              h.members.some(m => m.email?.toLowerCase() === item.email.toLowerCase())
            );
            const userMember = userHousehold?.members.find(m =>
              m.email?.toLowerCase() === item.email.toLowerCase()
            );

            return (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-2 items-center p-4 rounded-xl"
                style={{ background: "var(--background)" }}
              >
                {/* Email + badges */}
                <div className="col-span-5 flex items-center gap-2 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                    style={{
                      background: item.is_admin
                        ? "var(--color-coral)"
                        : userHousehold
                          ? "var(--color-sage)"
                          : item.can_create_household
                            ? "var(--color-honey)"
                            : "var(--color-sky)",
                      color: "white",
                    }}
                  >
                    {item.email.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <span
                      className="font-medium text-sm block truncate"
                      style={{ color: "var(--foreground)" }}
                    >
                      {item.email}
                    </span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {item.is_admin && (
                        <span className="badge badge-coral text-xs">{t.admin.appAdmin}</span>
                      )}
                      {item.can_create_household && !userHousehold && (
                        <span className="badge badge-honey text-xs">{t.admin.canCreateOwn}</span>
                      )}
                      {userMember?.is_household_admin && (
                        <span className="badge badge-sage text-xs">{t.admin.householdAdmin}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Household */}
                <div className="col-span-4">
                  {userHousehold ? (
                    <span className="text-sm" style={{ color: "var(--foreground)" }}>
                      {userHousehold.name || t.admin.unnamed}
                    </span>
                  ) : (
                    <span className="text-sm" style={{ color: "var(--muted)" }}>
                      —
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="col-span-3 flex justify-end gap-1">
                  {!item.is_admin && (
                    <button
                      onClick={() => deleteEmail(item.id, item)}
                      className="p-2 rounded-lg transition-colors hover:bg-red-50"
                      style={{ color: "var(--muted)" }}
                      title="Slett bruker"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="3,6 5,6 21,6" />
                        <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>
          {t.admin.usersAddedViaSettings}
        </p>
      </section>

      {/* Households Overview (read-only) */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(232, 120, 109, 0.2)" }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-coral)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9,22 9,12 15,12 15,22" />
            </svg>
          </div>
          <div>
            <h2
              className="text-xl font-semibold"
              style={{ color: "var(--foreground)" }}
            >
              {t.admin.households}
            </h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {t.admin.householdsDesc}
            </p>
          </div>
        </div>

        {/* Simple households list */}
        <div className="space-y-2">
          {households.length === 0 ? (
            <div className="text-center py-8" style={{ color: "var(--muted)" }}>
              {t.admin.noHouseholdsYet}
            </div>
          ) : (
            households.map((household) => (
              <div
                key={household.id}
                className="p-4 rounded-xl flex items-center justify-between"
                style={{ background: "var(--background)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                    style={{
                      background: "var(--color-coral)",
                      color: "white",
                    }}
                  >
                    {(household.name || "H").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div
                      className="font-medium"
                      style={{ color: "var(--foreground)" }}
                    >
                      {household.name || t.admin.unnamed}
                    </div>
                    <div
                      className="text-sm"
                      style={{ color: "var(--muted)" }}
                    >
                      {household.members.length} medlemmer • {household.children.length} barn
                    </div>
                  </div>
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {new Date(household.created_at).toLocaleDateString("nb-NO")}
                </div>
              </div>
            ))
          )}
        </div>

        <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>
          {t.admin.householdsManageViaSettings}
        </p>
      </section>

      {/* Activity Log */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <button
          onClick={() => setShowAuditLog(!showAuditLog)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(139, 168, 136, 0.2)" }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-sage)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-left">
              <h2
                className="text-xl font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {t.admin.auditLog}
              </h2>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {auditLog.length} {t.admin.latestChanges}
              </p>
            </div>
          </div>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform ${showAuditLog ? "rotate-180" : ""}`}
            style={{ color: "var(--muted)" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showAuditLog && (
          <div className="mt-6 space-y-3">
            {auditLog.length === 0 ? (
              <div
                className="text-center py-8"
                style={{ color: "var(--muted)" }}
              >
                {t.admin.noActivityYet}
              </div>
            ) : (
              auditLog.map((entry) => {
                const actionColors = {
                  INSERT: "var(--color-sage)",
                  UPDATE: "var(--color-honey)",
                  DELETE: "var(--color-coral)",
                };
                const actionLabels = {
                  INSERT: t.admin.actionCreated,
                  UPDATE: t.admin.actionUpdated,
                  DELETE: t.admin.actionDeleted,
                };
                const tableLabels: Record<string, string> = {
                  pickups: t.admin.entityPickup,
                  meals: t.admin.entityMeal,
                  children: t.admin.entityChild,
                  household_members: t.admin.entityMember,
                  households: t.admin.entityHousehold,
                  recipes: t.admin.entityRecipe,
                };

                return (
                  <div
                    key={entry.id}
                    className="p-3 rounded-xl"
                    style={{ background: "var(--background)" }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            background: `${actionColors[entry.action]}20`,
                            color: actionColors[entry.action],
                          }}
                        >
                          {actionLabels[entry.action]}
                        </span>
                        <span
                          className="text-sm font-medium"
                          style={{ color: "var(--foreground)" }}
                        >
                          {tableLabels[entry.table_name] || entry.table_name}
                        </span>
                      </div>
                      <span
                        className="text-xs"
                        style={{ color: "var(--muted)" }}
                      >
                        {new Date(entry.created_at).toLocaleString("nb-NO", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    {/* Show changes for UPDATE */}
                    {entry.action === "UPDATE" &&
                      entry.changes &&
                      Object.keys(entry.changes).length > 0 && (
                        <div
                          className="text-xs space-y-1 mt-2 pt-2"
                          style={{ borderTop: "1px solid var(--border)" }}
                        >
                          {Object.entries(entry.changes).map(
                            ([field, change]) => (
                              <div
                                key={field}
                                className="flex items-center gap-2"
                              >
                                <span style={{ color: "var(--muted)" }}>
                                  {field}:
                                </span>
                                <span style={{ color: "var(--color-coral)" }}>
                                  {String(change.old ?? "-")}
                                </span>
                                <span style={{ color: "var(--muted)" }}>→</span>
                                <span style={{ color: "var(--color-sage)" }}>
                                  {String(change.new ?? "-")}
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      )}

                    {/* Show summary for INSERT */}
                    {entry.action === "INSERT" && entry.new_data && (
                      <div
                        className="text-xs mt-2 pt-2"
                        style={{
                          borderTop: "1px solid var(--border)",
                          color: "var(--muted)",
                        }}
                      >
                        {(() => {
                          const data = entry.new_data as Record<
                            string,
                            string | number | boolean | null
                          >;
                          const parts: string[] = [];
                          if (data.name) parts.push(`Navn: ${data.name}`);
                          if (data.date) parts.push(`Dato: ${data.date}`);
                          if (data.custom_meal)
                            parts.push(String(data.custom_meal));
                          return parts.join(" • ") || t.admin.newEntry;
                        })()}
                      </div>
                    )}

                    {/* Show summary for DELETE */}
                    {entry.action === "DELETE" && entry.old_data && (
                      <div
                        className="text-xs mt-2 pt-2"
                        style={{
                          borderTop: "1px solid var(--border)",
                          color: "var(--muted)",
                        }}
                      >
                        {(() => {
                          const data = entry.old_data as Record<
                            string,
                            string | number | boolean | null
                          >;
                          const parts: string[] = [];
                          if (data.name) parts.push(`Slettet: ${data.name}`);
                          if (data.date) parts.push(`Dato: ${data.date}`);
                          return parts.join(" • ") || t.admin.deletedEntry;
                        })()}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      {/* App Settings */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(229, 185, 94, 0.2)" }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-honey)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <div>
            <h2
              className="text-xl font-semibold"
              style={{ color: "var(--foreground)" }}
            >
              {t.admin.aiSettings}
            </h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {t.admin.aiSettingsDesc}
            </p>
          </div>
        </div>

        {/* OpenRouter Model Selector */}
        <div className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: "var(--foreground)" }}
            >
              {t.admin.openrouterModel}
            </label>
            <ModelSelector
              value={settings.openrouter_model || "anthropic/claude-3.5-sonnet"}
              onChange={(modelId) => updateSetting("openrouter_model", modelId)}
              disabled={saving}
              t={t}
            />
            <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
              {t.admin.priceNote}
            </p>
          </div>
        </div>
      </section>

      {/* Google Calendar Integration */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(167, 139, 250, 0.2)" }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#a78bfa"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <h2
              className="text-xl font-semibold"
              style={{ color: "var(--foreground)" }}
            >
              {t.admin.calendar}
            </h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {t.admin.calendarDesc}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Status */}
          <div
            className="p-4 rounded-xl"
            style={{ background: "var(--background)" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: calendarStatus?.connected
                      ? "var(--color-sage)"
                      : "var(--color-coral)",
                  }}
                />
                <div>
                  <div
                    className="font-medium"
                    style={{ color: "var(--foreground)" }}
                  >
                    {calendarStatus?.connected
                      ? t.admin.connected
                      : t.admin.notConnected}
                  </div>
                  {calendarStatus?.email && (
                    <div className="text-sm" style={{ color: "var(--muted)" }}>
                      {calendarStatus.email}
                    </div>
                  )}
                </div>
              </div>
              {calendarStatus?.connected && (
                <div className="text-right">
                  <div
                    className="text-2xl font-bold"
                    style={{ color: "#a78bfa" }}
                  >
                    {calendarStatus.syncedEvents}
                  </div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {t.admin.syncedEventsCount}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            {!calendarStatus?.connected ? (
              <a
                href="/api/calendar/auth"
                className="btn btn-primary flex items-center gap-2"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                {t.admin.connectGoogleCalendar}
              </a>
            ) : (
              <>
                <button
                  onClick={syncCalendar}
                  disabled={syncing}
                  className="btn btn-primary flex items-center gap-2"
                >
                  {syncing ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      {t.admin.syncing}
                    </>
                  ) : (
                    <>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                      </svg>
                      {t.admin.syncNow}
                    </>
                  )}
                </button>
                <a
                  href="/api/calendar/auth"
                  className="btn btn-secondary flex items-center gap-2"
                >
                  {t.admin.reconnect}
                </a>
              </>
            )}
          </div>

          {/* Info */}
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {t.admin.calendarAutoMatchDesc}
          </p>
        </div>
      </section>

      {/* Info */}
      <div
        className="flex items-start gap-3 p-4 rounded-xl"
        style={{ background: "rgba(139, 168, 136, 0.15)" }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--color-sage)" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: "var(--foreground)" }}
          >
            {t.admin.security}
          </p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {t.admin.securityDesc}
          </p>
        </div>
      </div>
    </div>
  );
}
