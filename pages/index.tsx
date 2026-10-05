import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import { AiOutlineArrowLeft, AiOutlineClose, AiOutlineDelete, AiOutlineSearch, AiOutlineSetting } from "react-icons/ai";

type TabGroup = { hostname: string | null; tabs: chrome.tabs.Tab[] };
type Scope = "current" | "all";
type DeleteSettings = {
  confirmSingleDelete: boolean;
  confirmDomainDelete: boolean;
  confirmDuplicateDelete: boolean;
};
const DEFAULT_DELETE_SETTINGS: DeleteSettings = {
  confirmSingleDelete: false,
  confirmDomainDelete: true,
  confirmDuplicateDelete: true,
};

function getHostname(tab: chrome.tabs.Tab): string | null {
  if (!tab.url) return null;
  try {
    const url = new URL(tab.url);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}

function groupTabs(tabs: chrome.tabs.Tab[]): TabGroup[] {
  const groups = new Map<string | null, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    const hostname = getHostname(tab);
    const group = groups.get(hostname) ?? [];
    group.push(tab);
    groups.set(hostname, group);
  }
  return Array.from(groups, ([hostname, tabs]) => ({ hostname, tabs }));
}

function matchesSearch(tab: chrome.tabs.Tab, search: string): boolean {
  return `${tab.title ?? ""} ${tab.url ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
}

// Prefer pinned or active tabs as the keeper, and never close pinned tabs.
function getDuplicateIds(tabs: chrome.tabs.Tab[]): number[] {
  const groups = new Map<string, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    if (!tab.url || tab.id === undefined) continue;
    const group = groups.get(tab.url) ?? [];
    group.push(tab);
    groups.set(tab.url, group);
  }
  const ids: number[] = [];
  groups.forEach((group) => {
    const keeper = group.find((tab) => tab.pinned) ?? group.find((tab) => tab.active) ?? group[0];
    group.forEach((tab) => {
      if (tab.id !== undefined && tab.id !== keeper.id && !tab.pinned) ids.push(tab.id);
    });
  });
  return ids;
}

export default function Home() {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [currentWindowId, setCurrentWindowId] = useState<number>();
  const [scope, setScope] = useState<Scope>("current");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [deleteSettings, setDeleteSettings] = useState<DeleteSettings>(DEFAULT_DELETE_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const refreshTabs = useCallback(async () => {
    if (typeof chrome === "undefined" || !chrome.tabs) return;
    const [nextTabs, window] = await Promise.all([chrome.tabs.query({}), chrome.windows.getCurrent()]);
    setTabs(nextTabs);
    setCurrentWindowId(window.id);
  }, []);

  useEffect(() => {
    const refresh = () => {
      refreshTabs().catch(() => setError("タブ一覧を取得できませんでした。ポップアップを開き直してください。"))
        .finally(() => setLoading(false));
    };
    refresh();
    if (typeof chrome === "undefined" || !chrome.tabs) return;
    chrome.tabs.onCreated.addListener(refresh);
    chrome.tabs.onRemoved.addListener(refresh);
    chrome.tabs.onUpdated.addListener(refresh);
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onAttached.addListener(refresh);
    chrome.tabs.onDetached.addListener(refresh);
    return () => {
      chrome.tabs.onCreated.removeListener(refresh);
      chrome.tabs.onRemoved.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(refresh);
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onAttached.removeListener(refresh);
      chrome.tabs.onDetached.removeListener(refresh);
    };
  }, [refreshTabs]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      setSettingsError("設定を利用できません。Chromeで拡張機能を再読み込みしてください。");
      setSettingsLoading(false);
      return;
    }
    chrome.storage.local.get(DEFAULT_DELETE_SETTINGS)
      .then((result) => {
        setDeleteSettings({
          confirmSingleDelete: typeof result.confirmSingleDelete === "boolean" ? result.confirmSingleDelete : false,
          confirmDomainDelete: typeof result.confirmDomainDelete === "boolean" ? result.confirmDomainDelete : true,
          confirmDuplicateDelete: typeof result.confirmDuplicateDelete === "boolean" ? result.confirmDuplicateDelete : true,
        });
      })
      .catch(() => setSettingsError("設定を読み込めませんでした。ポップアップを開き直してください。"))
      .finally(() => setSettingsLoading(false));
  }, []);

  const updateDeleteSetting = async (key: keyof DeleteSettings, enabled: boolean) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      await chrome.storage.local.set({ [key]: enabled });
      setDeleteSettings((current) => ({ ...current, [key]: enabled }));
    } catch {
      setSettingsError("設定を保存できませんでした。もう一度お試しください。");
    } finally {
      setSettingsSaving(false);
    }
  };

  const scopedTabs = tabs.filter((tab) => scope === "all" || tab.windowId === currentWindowId);
  const visibleTabs = scopedTabs.filter((tab) => matchesSearch(tab, search));
  const duplicateCount = getDuplicateIds(visibleTabs).length;
  const scopeLabel = scope === "current" ? "このウィンドウ" : "すべてのウィンドウ";
  const targetLabel = `${scopeLabel}${search.trim() ? "の検索結果" : ""}`;

  const activateTab = async (tab: chrome.tabs.Tab) => {
    if (tab.id === undefined) return;
    try {
      setError(null);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch {
      setError("タブに移動できませんでした。もう一度お試しください。");
    }
  };

  const closeTabs = async (mode: "single" | "domain" | "duplicates", value?: number | string) => {
    if (busy || settingsLoading || settingsSaving) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const latestTabs = await chrome.tabs.query(scope === "current" ? { currentWindow: true } : {});
      const targets = latestTabs.filter((tab) => matchesSearch(tab, search));
      const ids = mode === "duplicates" ? getDuplicateIds(targets) : targets
        .filter((tab) => mode === "single" ? tab.id === value : getHostname(tab) === value)
        .map((tab) => tab.id).filter((id): id is number => id !== undefined);
      if (!ids.length) {
        setNotice("閉じる対象のタブはありません。");
        return;
      }
      const description = mode === "single" ? `「${targets.find((tab) => tab.id === value)?.title || "無題のタブ"}」` : mode === "domain" ? `${value} のタブ` : "重複タブ";
      const needsConfirmation = mode === "duplicates" ? deleteSettings.confirmDuplicateDelete
        : mode === "single" ? deleteSettings.confirmSingleDelete : deleteSettings.confirmDomainDelete;
      if (needsConfirmation && !window.confirm(`${targetLabel}にある${description} ${ids.length} 件を閉じますか？${mode === "duplicates" ? "\n同じURLのタブを整理します。固定タブを残し、それ以外は選択中のタブを優先して1件残します。" : ""}`)) return;
      await chrome.tabs.remove(ids);
      setNotice(`${ids.length}件のタブを閉じました。`);
    } catch {
      setError("タブを閉じられませんでした。一覧を確認して、もう一度お試しください。");
    } finally {
      await refreshTabs().catch(() => setError("タブ一覧を更新できませんでした。ポップアップを開き直してください。"));
      setBusy(false);
    }
  };

  return (
    <>
      <Head>
        <title>Tab Manager</title>
        <meta name="description" content="開いているタブを検索・整理" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
      </Head>
      {showSettings ? (
        <main className="min-h-[320px] text-sm text-slate-800">
          <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
            <button type="button" autoFocus disabled={settingsSaving} onClick={() => setShowSettings(false)}
              className="flex items-center gap-1 rounded-md px-2 py-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40">
              <AiOutlineArrowLeft aria-hidden="true" /> タブ一覧へ
            </button>
            <h1 className="text-lg font-semibold">設定</h1>
          </header>
          <section className="space-y-4 p-4" aria-labelledby="delete-settings-heading">
            <h2 id="delete-settings-heading" className="font-semibold">削除前の確認</h2>
            <p className="text-xs text-slate-500">オンにすると、タブを閉じる前に確認ダイアログを表示します。変更は自動保存されます。</p>
            {settingsError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{settingsError}</p>}
            {([
              ["confirmSingleDelete", "個別削除", "タブの閉じるボタンを押したときに確認する"],
              ["confirmDomainDelete", "ドメイン一括削除", "同じドメインのタブをまとめて閉じるときに確認する"],
              ["confirmDuplicateDelete", "重複タブの整理", "重複するタブをまとめて閉じるときに確認する"],
            ] as const).map(([key, label, description]) => (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
                <span><span className="block font-medium">{label}</span><span className="mt-1 block text-xs text-slate-500">{description}</span></span>
                <input type="checkbox" checked={deleteSettings[key]}
                  disabled={settingsLoading || settingsSaving || typeof chrome === "undefined" || !chrome.storage?.local}
                  onChange={(event) => updateDeleteSetting(key, event.target.checked)}
                  className="h-5 w-5 shrink-0 accent-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40" />
              </label>
            ))}
            <p role="status" className="text-xs text-slate-500">{settingsError ? "" : settingsLoading ? "設定を読み込んでいます…" : settingsSaving ? "保存しています…" : "設定は保存されています。"}</p>
          </section>
        </main>
      ) : <main className="text-sm text-slate-800">
        <header className="sticky top-0 z-10 space-y-3 border-b border-slate-200 bg-white px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight">Tab Manager</h1>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">{scopedTabs.length} タブ</span>
              <button type="button" disabled={busy} onClick={() => setShowSettings(true)} aria-label="設定を開く" title="設定"
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
                <AiOutlineSetting size="1.25rem" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="対象ウィンドウ">
            {([ ["current", "このウィンドウ"], ["all", "すべて"] ] as const).map(([value, label]) => (
              <button key={value} type="button" disabled={busy} aria-pressed={scope === value}
                className={`flex-1 rounded-md px-3 py-2 font-medium ${scope === value ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:bg-slate-200"}`}
                onClick={() => { setScope(value); setNotice(""); }}>{label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <AiOutlineSearch aria-hidden="true" className="shrink-0 text-lg text-slate-400" />
            <input type="search" aria-label="タイトル・URLでタブを検索" placeholder="タイトル・URLで検索" value={search} disabled={busy}
              onChange={(event) => { setSearch(event.target.value); setNotice(""); }}
              className="min-w-0 flex-1 bg-transparent py-2.5 outline-none" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500" aria-live="polite">{search.trim() ? `${scopedTabs.length}件中 ${visibleTabs.length}件` : "ドメイン別に表示"}</p>
            <button type="button" disabled={loading || busy || settingsLoading || settingsSaving || duplicateCount === 0}
              title="表示中の同じURLのタブを整理します。固定タブは閉じません。"
              className="rounded-md border border-slate-200 px-3 py-2 font-medium hover:bg-slate-100 disabled:cursor-default disabled:opacity-40"
              onClick={() => closeTabs("duplicates")}>
              重複タブを整理 · {duplicateCount}件
            </button>
          </div>
          <p className="text-xs text-slate-500">一括操作の対象：{targetLabel}</p>
        </header>
        <div className="px-3 pb-4 pt-2" aria-busy={busy || loading}>
          {settingsError && <p role="alert" className="mb-2 rounded-lg bg-red-50 p-3 text-red-700">{settingsError}</p>}
          {error && <p role="alert" className="mb-2 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
          <p role="status" className={notice || busy ? "mb-2 rounded-lg bg-blue-50 p-3 text-blue-800" : "sr-only"}>{busy ? "タブを整理しています…" : notice}</p>
          {loading ? <p className="py-12 text-center text-slate-500">タブを読み込んでいます…</p> : visibleTabs.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <p>{search.trim() ? "一致するタブがありません" : "表示するタブがありません"}</p>
              {search.trim() && <button type="button" disabled={busy} onClick={() => setSearch("")} className="mt-3 rounded px-3 py-2 text-blue-700 hover:bg-blue-50">検索をクリア</button>}
            </div>
          ) : groupTabs(visibleTabs).map(({ hostname, tabs: groupedTabs }) => (
            <section key={hostname ?? "other"} className="mt-2">
              <div className="flex items-center gap-2 px-2 py-1">
                <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600" title={hostname ?? undefined}>{hostname ?? "その他のタブ"}</h2>
                <span className="text-xs text-slate-400">{groupedTabs.length}件</span>
                {hostname && <button type="button" disabled={busy || settingsLoading || settingsSaving} onClick={() => closeTabs("domain", hostname)}
                  aria-label={`${targetLabel}にある ${hostname} のタブ ${groupedTabs.length} 件を閉じる`}
                  title={`${targetLabel}にある ${hostname} のタブを閉じる`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                  <AiOutlineDelete size="1rem" aria-hidden="true" />
                </button>}
              </div>
              <ul className="space-y-1">
                {groupedTabs.map((tab) => (
                  <li key={tab.id} className={`flex items-center rounded-lg ${tab.active ? "bg-blue-50" : "hover:bg-slate-100"}`}>
                    <button type="button" disabled={busy} onClick={() => activateTab(tab)} title={`${tab.title ?? "無題のタブ"}\n${tab.url ?? ""}`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3 text-left">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-200 text-xs text-slate-500" aria-hidden="true">
                        {tab.favIconUrl ? <img src={tab.favIconUrl} alt="" className="h-4 w-4 object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : "•"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{tab.title || "無題のタブ"}</span>
                      {tab.pinned && <span className="shrink-0 text-xs text-slate-500">固定</span>}
                      {tab.active && <span className="shrink-0 text-xs text-blue-700">{tab.windowId === currentWindowId ? "現在" : "選択中"}</span>}
                    </button>
                    <button type="button" disabled={busy || settingsLoading || settingsSaving} aria-label={`${tab.title ?? "タブ"}を閉じる`} title="タブを閉じる"
                      onClick={() => closeTabs("single", tab.id)}
                      className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                      <AiOutlineClose size="1rem" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>}
    </>
  );
}
