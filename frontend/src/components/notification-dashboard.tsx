"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, useTransition } from "react";
import SockJS from "sockjs-client";
import { Client, type IMessage } from "@stomp/stompjs";
import {
  createNotification,
  deleteNotification,
  fetchUnreadNotifications,
  markNotificationAsRead,
  notificationTypes,
  type NotificationItem,
  type NotificationType,
  wsUrl,
} from "@/lib/notifications";

const defaultUserId = 1;

type ViewFilter = "all" | "unread" | "recent";
type SortMode = "newest" | "oldest";

type ActivityEntry = {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: "info" | "success" | "warning";
};

export function NotificationDashboard() {
  const [userIdInput, setUserIdInput] = useState(String(defaultUserId));
  const [activeUserId, setActiveUserId] = useState(defaultUserId);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [readNotifications, setReadNotifications] = useState<NotificationItem[]>([]);
  const [selectedType, setSelectedType] = useState<NotificationType>("CONGE");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("Prêt à synchroniser avec le backend.");
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNotificationId, setSelectedNotificationId] = useState<number | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>([]);
  const [isPending, startTransition] = useTransition();
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [notificationPanelTab, setNotificationPanelTab] = useState<"unread" | "read">("unread");
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const stompClientRef = useRef<Client | null>(null);

  const deferredSearch = useDeferredValue(searchQuery);
  const refreshNotifications = async () => {
    try {
      setIsLoading(true);
      setStatus(`Actualisation des notifications pour l'utilisateur ${activeUserId}...`);
      const data = await fetchUnreadNotifications(activeUserId);
      setNotifications(data);
      setSelectedNotificationId(data[0]?.id ?? null);
      setLastSyncAt(new Date().toLocaleTimeString("fr-FR"));
      addActivity("Synchronisation manuelle", `${data.length} notification(s) actualisée(s).`, "success");
      setStatus("Tableau de bord actualisé.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Erreur inconnue.");
      addActivity("Échec d'actualisation", "Impossible d'actualiser les notifications.", "warning");
    } finally {
      setIsLoading(false);
    }
  };

  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.lu).length, [notifications]);
  const readCount = readNotifications.length;

  const totalNotificationCount = notifications.length + readNotifications.length;

  const metrics = useMemo(() => {
    const latestNotification = notifications[0];
    return {
      total: notifications.length,
      unread: unreadCount,
      websocket: isConnected ? "Actif" : "Déconnecté",
      latest: latestNotification ? latestNotification.type : "N/A",
    };
  }, [isConnected, notifications, unreadCount]);

  const filteredNotifications = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();

    let nextNotifications = notifications.filter((notification) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        notification.message.toLowerCase().includes(normalizedSearch) ||
        notification.type.toLowerCase().includes(normalizedSearch) ||
        String(notification.id).includes(normalizedSearch);

      const matchesFilter =
        viewFilter === "all" ||
        (viewFilter === "unread" && !notification.lu) ||
        (viewFilter === "recent" && new Date(notification.dateCreation).getTime() > Date.now() - 1000 * 60 * 60 * 24);

      return matchesSearch && matchesFilter;
    });

    nextNotifications = [...nextNotifications].sort((left, right) => {
      const leftTime = new Date(left.dateCreation).getTime();
      const rightTime = new Date(right.dateCreation).getTime();
      return sortMode === "newest" ? rightTime - leftTime : leftTime - rightTime;
    });

    return nextNotifications;
  }, [deferredSearch, notifications, sortMode, viewFilter]);

  const selectedNotification = useMemo(
    () =>
      [...notifications, ...readNotifications].find((notification) => notification.id === selectedNotificationId) ?? null,
    [notifications, readNotifications, selectedNotificationId],
  );

  const notificationPanelItems = useMemo(() => {
    const baseItems = notificationPanelTab === "unread" ? notifications : readNotifications;

    return [...baseItems].sort((left, right) => {
      const leftTime = new Date(left.dateCreation).getTime();
      const rightTime = new Date(right.dateCreation).getTime();
      return rightTime - leftTime;
    });
  }, [notificationPanelTab, notifications, readNotifications]);

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      try {
        setIsLoading(true);
        setStatus(`Chargement des notifications pour l'utilisateur ${activeUserId}...`);
        const data = await fetchUnreadNotifications(activeUserId);

        if (cancelled) {
          return;
        }

        setNotifications(data);
        setReadNotifications([]);
        setSelectedNotificationId(data[0]?.id ?? null);
        setIsComposeModalOpen(false);
        setIsDetailsModalOpen(false);
        setLastSyncAt(new Date().toLocaleTimeString("fr-FR"));
        addActivity("Synchronisation initiale", `${data.length} notification(s) chargée(s) pour l'utilisateur ${activeUserId}.`, "success");
        setStatus(`${data.length} notification(s) non lue(s) trouvée(s).`);
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Erreur inconnue.");
          addActivity("Erreur de chargement", "Impossible de récupérer les notifications.", "warning");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadNotifications();

    return () => {
      cancelled = true;
    };
  }, [activeUserId]);

  useEffect(() => {
    stompClientRef.current?.deactivate();

    const client = new Client({
      webSocketFactory: () => new SockJS(wsUrl) as never,
      reconnectDelay: 3000,
      debug: () => undefined,
      onConnect: () => {
        setIsConnected(true);
        client.subscribe(`/topic/notifications/${activeUserId}`, (messageFrame: IMessage) => {
          const incomingNotification = JSON.parse(messageFrame.body) as NotificationItem;

          setNotifications((current) => [incomingNotification, ...current.filter((item) => item.id !== incomingNotification.id)]);
          setSelectedNotificationId(incomingNotification.id);
          setIsComposeModalOpen(false);
          setIsDetailsModalOpen(true);
          setLastSyncAt(new Date().toLocaleTimeString("fr-FR"));
          addActivity("Notification reçue", incomingNotification.message, "info");
          setStatus("Nouvelle notification reçue en temps réel.");
        });
      },
      onDisconnect: () => {
        setIsConnected(false);
      },
      onWebSocketClose: () => {
        setIsConnected(false);
      },
      onStompError: () => {
        setIsConnected(false);
        setStatus("Connexion websocket indisponible pour le moment.");
        addActivity("WebSocket interrompu", "La connexion temps réel a été interrompue.", "warning");
      },
    });

    stompClientRef.current = client;
    client.activate();

    return () => {
      client.deactivate();
      stompClientRef.current = null;
      setIsConnected(false);
    };
  }, [activeUserId]);

  function addActivity(title: string, detail: string, tone: ActivityEntry["tone"]) {
    const entry: ActivityEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      detail,
      time: new Date().toLocaleTimeString("fr-FR"),
      tone,
    };

    setActivityFeed((current) => [entry, ...current].slice(0, 5));
  }

  function handleSelectUserId() {
    const parsedUserId = Number(userIdInput);

    if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) {
      setStatus("Veuillez saisir un identifiant utilisateur valide.");
      addActivity("Identifiant invalide", "Le champ utilisateur doit contenir un nombre positif.", "warning");
      return;
    }

    startTransition(() => {
      setActiveUserId(parsedUserId);
      setSelectedNotificationId(null);
      setIsComposeModalOpen(false);
      setIsDetailsModalOpen(false);
    });
  }

  async function handleCreateNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!message.trim()) {
      setStatus("Le message ne peut pas être vide.");
      addActivity("Validation bloquée", "Le message de la notification est vide.", "warning");
      return;
    }

    try {
      setIsLoading(true);
      const created = await createNotification({
        type: selectedType,
        message: message.trim(),
        userId: activeUserId,
      });

      setNotifications((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setReadNotifications((current) => current.filter((item) => item.id !== created.id));
      setSelectedNotificationId(created.id);
      setIsComposeModalOpen(false);
      setIsDetailsModalOpen(true);
      setNotificationPanelTab("unread");
      setIsNotificationPanelOpen(true);
      setMessage("");
      setLastSyncAt(new Date().toLocaleTimeString("fr-FR"));
      addActivity("Notification envoyée", created.message, "success");
      setStatus("Notification envoyée avec succès.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Erreur inconnue.");
      addActivity("Échec d'envoi", "La création de la notification a échoué.", "warning");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMarkAsRead(id: number) {
    try {
      await markNotificationAsRead(id);
      const movedNotification = notifications.find((notification) => notification.id === id) ?? null;

      setNotifications((current) => current.filter((notification) => notification.id !== id));
      if (movedNotification) {
        setReadNotifications((current) => [
          { ...movedNotification, lu: true },
          ...current.filter((notification) => notification.id !== id),
        ]);
      }
      setSelectedNotificationId((current) => (current === id ? null : current));
      setIsDetailsModalOpen(false);
      setLastSyncAt(new Date().toLocaleTimeString("fr-FR"));
      addActivity("Marquée comme lue", `Notification #${id} traitée.`, "success");
      setStatus("Notification marquée comme lue.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Erreur inconnue.");
      addActivity("Erreur de lecture", `Impossible de marquer la notification #${id}.`, "warning");
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteNotification(id);
      setNotifications((current) => current.filter((notification) => notification.id !== id));
      setReadNotifications((current) => current.filter((notification) => notification.id !== id));
      setSelectedNotificationId((current) => (current === id ? null : current));
      setIsDetailsModalOpen(false);
      setLastSyncAt(new Date().toLocaleTimeString("fr-FR"));
      addActivity("Notification supprimée", `Notification #${id} supprimée.`, "warning");
      setStatus("Notification supprimée.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Erreur inconnue.");
      addActivity("Erreur de suppression", `Impossible de supprimer la notification #${id}.`, "warning");
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 text-slate-100 sm:px-6 lg:px-10">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <nav className="sticky top-4 z-20 rounded-[1.75rem] border border-white/10 bg-slate-950/70 px-5 py-4 shadow-[0_16px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-300 text-sm font-bold text-slate-950">
                N
              </div>
              <div>
                <p className="text-sm uppercase tracking-[0.28em] text-sky-200/70">Notifications</p>
                <p className="text-sm text-slate-400">Vue opérationnelle et temps réel</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsComposeModalOpen(true)}
                className="rounded-full border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-400/20"
              >
                + Composer
              </button>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                Utilisateur {activeUserId}
              </span>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${isConnected ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"}`}>
                {isConnected ? "Synchronisé" : "Déconnecté"}
              </span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsNotificationPanelOpen((current) => !current)}
                  className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-lg text-slate-100 transition hover:bg-white/10"
                  aria-label="Ouvrir les notifications"
                >
                  🔔
                  {totalNotificationCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-semibold text-white">
                      {totalNotificationCount}
                    </span>
                  ) : null}
                </button>

                {isNotificationPanelOpen ? (
                  <div className="absolute right-0 top-14 z-30 w-[min(92vw,24rem)] overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/95 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                    <div className="border-b border-white/10 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">Notifications</p>
                          <p className="text-xs text-slate-400">Non lues et lues dans le même panneau</p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                          {unreadCount} actives
                        </span>
                      </div>

                      <div className="mt-4 flex rounded-full border border-white/10 bg-white/5 p-1">
                        <button
                          type="button"
                          onClick={() => setNotificationPanelTab("unread")}
                          className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
                            notificationPanelTab === "unread" ? "bg-sky-400 text-slate-950" : "text-slate-300 hover:text-white"
                          }`}
                        >
                          Non lues
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotificationPanelTab("read")}
                          className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
                            notificationPanelTab === "read" ? "bg-sky-400 text-slate-950" : "text-slate-300 hover:text-white"
                          }`}
                        >
                          Lues
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[28rem] space-y-2 overflow-auto p-3">
                      {notificationPanelItems.length === 0 ? (
                        <div className="rounded-[1.25rem] border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                          {notificationPanelTab === "unread" ? "Aucune notification non lue." : "Aucune notification lue pour le moment."}
                        </div>
                      ) : (
                        notificationPanelItems.map((notification) => (
                          <button
                            key={notification.id}
                            type="button"
                            onClick={() => {
                              setSelectedNotificationId(notification.id);
                              setIsDetailsModalOpen(true);
                              setIsNotificationPanelOpen(false);
                            }}
                            className="w-full rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-left transition hover:border-sky-400/30 hover:bg-white/10"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-sky-200/70">
                                  <span>{notification.type}</span>
                                  <span>#{notification.id}</span>
                                </div>
                                <p className="text-sm text-white">{notification.message}</p>
                              </div>
                              <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-slate-300">
                                {new Date(notification.dateCreation).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void refreshNotifications()}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              >
                Actualiser
              </button>
            </div>
          </div>
        </nav>

        <div className="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/7 shadow-[0_30px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_24%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_22%)]" />
          <div className="relative grid gap-6 p-6 lg:grid-cols-[1.45fr_0.95fr] lg:p-8">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                  <span className={`h-2.5 w-2.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-amber-300"}`} />
                  {isConnected ? "WebSocket connecté" : "Connexion en attente"}
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.22em] text-slate-300">
                  Live workspace
                </span>
              </div>

              <div className="space-y-4">
                <p className="text-sm uppercase tracking-[0.35em] text-sky-200/75">Notifications</p>
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Un dashboard notification plus propre, plus lisible et pensé pour le temps réel.
                </h1>
                <p className="max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
                  La vue ajoute recherche, filtres, tri, sélection rapide et activité récente pour rendre l’expérience plus professionnelle.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Non lues" value={metrics.unread.toString()} hint="Inbox active" accent="from-sky-400/70 to-cyan-400/70" />
                <MetricCard label="Lues" value={readCount.toString()} hint="Historique local" accent="from-indigo-400/70 to-sky-400/70" />
                <MetricCard label="WebSocket" value={metrics.websocket} hint="Flux temps réel" accent="from-emerald-400/70 to-teal-400/70" />
                <MetricCard label="Dernier type" value={metrics.latest} hint={lastSyncAt ? `Dernière mise à jour ${lastSyncAt}` : "En attente"} accent="from-amber-300/80 to-orange-400/70" />
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.24)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">Panneau de pilotage</p>
                  <p className="text-sm text-slate-400">Changement d’utilisateur et statut live.</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                  {isPending ? "Chargement" : "Stable"}
                </span>
              </div>

              <div className="mt-5 grid gap-4">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>Identifiant utilisateur</span>
                  <div className="flex gap-2">
                    <input
                      value={userIdInput}
                      onChange={(event) => setUserIdInput(event.target.value)}
                      inputMode="numeric"
                      className="w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-sky-400/60"
                      placeholder="1"
                    />
                    <button
                      type="button"
                      onClick={handleSelectUserId}
                      className="rounded-2xl bg-sky-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-400"
                    >
                      Charger
                    </button>
                  </div>
                </label>

                <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>État du flux</span>
                    <span className="font-medium text-slate-100">{isConnected ? "Temps réel" : "En attente"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Réception</span>
                    <span className="font-medium text-slate-100">{readCount > 0 ? `${readCount} lue(s)` : "Aucune"}</span>
                  </div>
                </div>
              </div>

              <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                {status}
              </p>
            </div>
          </div>
        </div>

        <section className="grid gap-6 xl:grid-cols-[22rem_1fr] xl:items-start">
          <aside className="space-y-6 xl:sticky xl:top-28">
            <section className="rounded-[2rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Activité récente</p>
              <div className="mt-3 space-y-3">
                {activityFeed.length === 0 ? (
                  <p className="text-sm text-slate-400">Aucune activité enregistrée pour le moment.</p>
                ) : (
                  activityFeed.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-100">{entry.title}</p>
                        <span className="text-[11px] text-slate-500">{entry.time}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{entry.detail}</p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>

          <section className="rounded-[2rem] border border-white/10 bg-white/8 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Boîte de réception intelligente</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Recherche, tri et filtre pour piloter les notifications sans perdre le rythme.
                </p>
              </div>
              <div className="flex gap-2">
                <CompactToggle active={viewFilter === "all"} onClick={() => setViewFilter("all")} label="Tout" />
                <CompactToggle active={viewFilter === "unread"} onClick={() => setViewFilter("unread")} label="Non lues" />
                <CompactToggle active={viewFilter === "recent"} onClick={() => setViewFilter("recent")} label="Récentes" />
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-sky-400/60"
                placeholder="Rechercher par type, message ou id"
              />
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none focus:border-sky-400/60"
              >
                <option value="newest">Plus récentes</option>
                <option value="oldest">Plus anciennes</option>
              </select>
            </div>

            <div className="mt-6 space-y-4">
              {filteredNotifications.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-black/10 px-6 py-12 text-center text-slate-400">
                  Aucune notification ne correspond au filtre ou à la recherche.
                </div>
              ) : (
                filteredNotifications.map((notification) => (
                  <article
                    key={notification.id}
                      onClick={() => {
                        setSelectedNotificationId(notification.id);
                        setIsDetailsModalOpen(true);
                      }}
                    className={`cursor-pointer rounded-[1.5rem] border p-5 transition ${
                      selectedNotificationId === notification.id
                        ? "border-sky-400/40 bg-slate-950/80 shadow-[0_14px_40px_rgba(14,165,233,0.12)]"
                        : "border-white/10 bg-slate-950/55 hover:border-sky-400/30 hover:bg-slate-950/75"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.24em] text-sky-200/70">
                          <span>{notification.type}</span>
                          <span>#{notification.id}</span>
                          <span>User {notification.userId}</span>
                          {!notification.lu ? <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200">Non lue</span> : null}
                        </div>
                        <p className="text-base leading-7 text-slate-100">{notification.message}</p>
                        <p className="text-sm text-slate-400">
                          Créée le {new Date(notification.dateCreation).toLocaleString("fr-FR")}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleMarkAsRead(notification.id);
                          }}
                          className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20"
                        >
                          Marquer lue
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(notification.id);
                          }}
                          className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>

        {isDetailsModalOpen && selectedNotification ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm"
            onClick={() => setIsDetailsModalOpen(false)}
          >
            <div
              className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-slate-950/95 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.5)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-sky-200/70">Détails</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Notification #{selectedNotification.id}</h3>
                  <p className="mt-1 text-sm text-slate-400">Vue pop-up au clic sur la notification.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDetailsModalOpen(false)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 transition hover:bg-white/10"
                >
                  Fermer
                </button>
              </div>

              <div className="mt-6 space-y-5">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Message</p>
                  <p className="mt-2 text-base leading-7 text-slate-100">{selectedNotification.message}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm text-slate-300 md:grid-cols-4">
                  <InfoChip label="Type" value={selectedNotification.type} />
                  <InfoChip label="Statut" value={selectedNotification.lu ? "Lue" : "Non lue"} />
                  <InfoChip label="Utilisateur" value={String(selectedNotification.userId)} />
                  <InfoChip label="Créée" value={new Date(selectedNotification.dateCreation).toLocaleString("fr-FR")} />
                </div>

                <div className="flex flex-wrap gap-3">
                  {!selectedNotification.lu ? (
                    <button
                      type="button"
                      onClick={() => void handleMarkAsRead(selectedNotification.id)}
                      className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20"
                    >
                      Marquer comme lue
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleDelete(selectedNotification.id)}
                    className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-5 py-3 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isComposeModalOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm"
            onClick={() => setIsComposeModalOpen(false)}
          >
            <div
              className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-slate-950/95 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.5)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-sky-200/70">Composer</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Nouvelle notification</h3>
                  <p className="mt-1 text-sm text-slate-400">Ouverte depuis la barre du haut.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsComposeModalOpen(false)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 transition hover:bg-white/10"
                >
                  Fermer
                </button>
              </div>

              <form className="mt-6 space-y-4" onSubmit={handleCreateNotification}>
                <label className="block space-y-2 text-sm text-slate-300">
                  <span>Type</span>
                  <select
                    value={selectedType}
                    onChange={(event) => setSelectedType(event.target.value as NotificationType)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition focus:border-sky-400/60"
                  >
                    {notificationTypes.map((type) => (
                      <option key={type} value={type} className="bg-slate-950">
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2 text-sm text-slate-300">
                  <span>Message</span>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={7}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-sky-400/60"
                    placeholder="Ex. Demande de congé validée pour le 12 juillet."
                  />
                </label>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoading ? "Envoi en cours..." : "Envoyer"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessage("")}
                    className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                  >
                    Vider
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} />
      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{hint}</p>
    </div>
  );
}

function CompactToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active ? "bg-sky-400 text-slate-950" : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm text-slate-100">{value}</p>
    </div>
  );
}