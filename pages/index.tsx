import Head from "next/head";
import { useEffect, useState } from "react";
import { AiOutlineCloseCircle, AiOutlineDelete } from "react-icons/ai";

type TabGroup = {
  hostname: string | null;
  tabs: chrome.tabs.Tab[];
};

function getHostname(tab: chrome.tabs.Tab): string | null {
  if (!tab.url) return null;

  try {
    const url = new URL(tab.url);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.hostname
      : null;
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

  return Array.from(groups, ([hostname, groupedTabs]) => ({
    hostname,
    tabs: groupedTabs,
  }));
}

export default function Home() {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [deletingHostname, setDeletingHostname] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshTabs = async () => {
    if (typeof chrome === "undefined" || !chrome.tabs) return;
    setTabs(await chrome.tabs.query({}));
  };

  useEffect(() => {
    refreshTabs().catch(() => setError("タブ一覧を取得できませんでした。"));
  }, []);

  const onClickTitleHandler = (id: number | undefined) => {
    if (id !== undefined) {
      chrome.tabs.update(id, { active: true });
    }
  };

  const onClickCloseHandler = async (id: number | undefined) => {
    if (id === undefined) return;

    try {
      setError(null);
      await chrome.tabs.remove(id);
      await refreshTabs();
    } catch {
      setError("タブを閉じられませんでした。もう一度お試しください。");
    }
  };

  const onClickDeleteDomainHandler = async (hostname: string) => {
    try {
      setError(null);
      const currentTabs = await chrome.tabs.query({});
      const ids = currentTabs
        .filter((tab) => getHostname(tab) === hostname)
        .map((tab) => tab.id)
        .filter((id): id is number => id !== undefined);

      if (ids.length === 0) {
        await refreshTabs();
        return;
      }

      if (!window.confirm(`${hostname} のタブ ${ids.length} 件をすべて閉じますか？`)) {
        return;
      }

      setDeletingHostname(hostname);
      await chrome.tabs.remove(ids);
      await refreshTabs();
    } catch {
      setError(`${hostname} のタブを閉じられませんでした。もう一度お試しください。`);
      await refreshTabs().catch(() => {});
    } finally {
      setDeletingHostname(null);
    }
  };

  const onClickDeleteDuplicateHandler = async () => {
    try {
      setError(null);
      const uniqueTabs = new Map(tabs.map((tab) => [tab.url, tab]));
      for (const tab of tabs) {
        if (tab.url && tab.id !== undefined && uniqueTabs.get(tab.url)?.id !== tab.id) {
          await chrome.tabs.remove(tab.id);
        }
      }
      await refreshTabs();
    } catch {
      setError("重複タブを閉じられませんでした。もう一度お試しください。");
      await refreshTabs().catch(() => {});
    }
  };

  return (
    <>
      <Head>
        <title>Tab Manager</title>
        <meta name="description" content="Tab Manager" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className="m-2">
        <button
          className="bg-red-500 hover:bg-red-400 text-white rounded px-4 py-2"
          onClick={onClickDeleteDuplicateHandler}
        >
          重複削除
        </button>
        {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
        {groupTabs(tabs).map(({ hostname, tabs: groupedTabs }) => (
          <section key={hostname ?? "other"} className="mt-2">
            <div className="flex items-center gap-2 bg-gray-200 px-2 py-1">
              <h2 className="min-w-0 flex-1 truncate font-semibold" title={hostname ?? undefined}>
                {hostname ?? "その他のタブ"}
              </h2>
              <span className="shrink-0 text-sm text-gray-600">{groupedTabs.length}件</span>
              {hostname && (
                <button
                  aria-label={`${hostname} のタブ ${groupedTabs.length} 件を閉じる`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 disabled:opacity-50"
                  disabled={deletingHostname !== null}
                  onClick={() => onClickDeleteDomainHandler(hostname)}
                  type="button"
                  title={`${hostname} のタブをすべて閉じる`}
                >
                  <AiOutlineDelete size="1.25rem" aria-hidden="true" />
                </button>
              )}
            </div>
            <ul className="bg-gray-50">
              {groupedTabs.map((tab) => (
                <li key={tab.id} className="flex items-center bg-gray-50 hover:bg-gray-200">
                  <button
                    aria-label={`${tab.title ?? "タブ"}を閉じる`}
                    className="mx-1 text-red-500"
                    onClick={() => onClickCloseHandler(tab.id)}
                    type="button"
                  >
                    <AiOutlineCloseCircle size="1.5rem" aria-hidden="true" />
                  </button>
                  <button
                    className="min-w-0 break-all p-1 text-left"
                    onClick={() => onClickTitleHandler(tab.id)}
                    type="button"
                  >
                    {tab.favIconUrl && (
                      <img src={tab.favIconUrl} alt="" className="mr-1 inline h-5" />
                    )}
                    {tab.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
