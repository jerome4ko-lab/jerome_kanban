import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ClipboardList,
  Eye,
  EyeOff,
  Headphones,
  ListTodo,
  Loader2,
  LockKeyhole,
  LogOut,
  Moon,
  Pencil,
  Play,
  Plus,
  Quote,
  Settings,
  Square,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const STATUSES = [
  { id: "todo", label: "TODO", icon: ClipboardList, accent: "emerald" },
  { id: "in_progress", label: "진행중", icon: CircleDashed, accent: "sky" },
  { id: "done", label: "완료", icon: CheckCircle2, accent: "amber" },
  { id: "hidden", label: "숨김", icon: EyeOff, accent: "slate" },
];

const MEDITATION_TRACKS = [
  { src: "/audio/track1.mp3", label: "1", cues: [60, 300] },
  { src: "/audio/track2.mp3", label: "2", cues: [45, 240] },
];

function formatToday(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const day = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${yyyy}.${mm}.${dd}(${day})`;
}

const STATUS_BY_ID = STATUSES.reduce((acc, status) => {
  acc[status.id] = status;
  return acc;
}, {});

function parseGroupedText(value) {
  const trimmed = String(value || "").trim();
  const groupOnly = trimmed.match(/^#([^\s#]{1,60})$/);
  if (groupOnly) {
    return { groupName: groupOnly[1].trim(), text: "" };
  }
  const match = trimmed.match(/^#([^\s#]{1,60})\s+([\s\S]+)$/);
  if (!match) {
    return { groupName: "", text: trimmed };
  }
  const text = match[2].trim();
  if (!text) {
    return { groupName: "", text: trimmed };
  }
  return { groupName: match[1].trim(), text };
}

function formatGroupedText(item) {
  const groupName = String(item?.groupName || "").trim();
  return groupName ? `#${groupName} ${item.text}` : item.text;
}

function getHashtagQuery(value) {
  const match = String(value || "").match(/^#([^\s#]*)$/);
  return match ? match[1] : null;
}

class ApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      payload.error || "요청을 처리하지 못했습니다.",
      response.status,
    );
  }

  return payload;
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = window.localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") {
      return saved;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  return [theme, setTheme];
}

function useShowHidden() {
  const [showHidden, setShowHidden] = useState(() => {
    const saved = window.localStorage.getItem("showHidden");
    return saved === null ? true : saved === "true";
  });

  useEffect(() => {
    window.localStorage.setItem("showHidden", String(showHidden));
  }, [showHidden]);

  return [showHidden, setShowHidden];
}

function useLocalToggle(key, defaultValue) {
  const [value, setValue] = useState(() => {
    const saved = window.localStorage.getItem(key);
    if (saved === null) return defaultValue;
    return saved === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue];
}

async function loadSubscriptions() {
  const initial = await apiRequest("/api/subscriptions");
  const serverSubs = Array.isArray(initial.subscriptions) ? initial.subscriptions : [];

  const migratedFlag = "subscriptions_migrated_v1";
  if (typeof window === "undefined" || window.localStorage.getItem(migratedFlag)) {
    return serverSubs;
  }

  if (serverSubs.length > 0) {
    window.localStorage.setItem(migratedFlag, "true");
    return serverSubs;
  }

  let local = [];
  try {
    const saved = window.localStorage.getItem("subscriptions");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) local = parsed;
    }
  } catch {}

  let migrated = false;
  for (const sub of local) {
    if (!sub?.id || !sub?.name || !sub?.expiryDate) continue;
    try {
      await apiRequest("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({ id: sub.id, name: sub.name, expiryDate: sub.expiryDate }),
      });
      migrated = true;
    } catch {}
  }

  window.localStorage.setItem(migratedFlag, "true");
  if (migrated) {
    const refreshed = await apiRequest("/api/subscriptions");
    return Array.isArray(refreshed.subscriptions) ? refreshed.subscriptions : [];
  }

  return serverSubs;
}

async function loadCalendarNotes() {
  const res = await apiRequest("/api/calendar-notes");
  return Array.isArray(res.notes) ? res.notes : [];
}

function dDayLabel(expiryDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  const diff = Math.ceil((expiry - today) / 86400000);
  return diff === 0 ? "D-day" : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

function dDayColor(expiryDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((new Date(expiryDate) - today) / 86400000);
  if (diff <= 7) return "text-rose-500 dark:text-rose-400";
  if (diff <= 30) return "text-amber-500 dark:text-amber-400";
  return "text-emerald-500 dark:text-emerald-400";
}

function SubscriptionBar({ subscriptions, onSave, onDelete, addRequestKey = 0 }) {
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftDate, setDraftDate] = useState("");

  function startEdit(sub) {
    setEditingId(sub.id);
    setDraftName(sub.name);
    setDraftDate(sub.expiryDate);
  }

  function startNew() {
    setEditingId("new");
    setDraftName("");
    setDraftDate("");
  }

  useEffect(() => {
    if (addRequestKey > 0) startNew();
  }, [addRequestKey]);

  function cancel() {
    setEditingId(null);
  }

  function save() {
    if (!draftName.trim() || !draftDate) return;
    const id = editingId === "new" ? crypto.randomUUID() : editingId;
    onSave({ id, name: draftName.trim(), expiryDate: draftDate });
    setEditingId(null);
  }

  function formatDisplayDate(iso) {
    const [y, m, d] = iso.split("-");
    const thisYear = new Date().getFullYear();
    return Number(y) !== thisYear
      ? `${String(y).slice(2)}/${Number(m)}/${Number(d)}`
      : `${Number(m)}/${Number(d)}`;
  }

  return (
    <div className="group/sub grid w-full grid-cols-2 items-center gap-1.5 md:flex md:w-auto md:flex-wrap md:justify-end">
      {[...subscriptions].sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate)).map((sub) =>
        editingId === sub.id ? (
          <div key={sub.id} className="col-span-2 flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-900 md:col-span-1">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
              placeholder="서비스명"
              className="w-24 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
            />
            <input
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
              className="w-28 bg-transparent text-xs text-slate-700 outline-none dark:text-slate-200 dark::[color-scheme:dark]"
            />
            <button onClick={save} className="text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300" title="저장">✓</button>
            <button onClick={cancel} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title="취소">✗</button>
          </div>
        ) : (
          <div
            key={sub.id}
            className="group flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs transition hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            onClick={() => startEdit(sub)}
            title="클릭하여 수정"
          >
            <span className="min-w-0 flex-1 truncate text-left font-medium text-slate-600 dark:text-slate-300">{sub.name}</span>
            <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">{formatDisplayDate(sub.expiryDate)}</span>
            <span className={`shrink-0 font-semibold tabular-nums ${dDayColor(sub.expiryDate)}`}>{dDayLabel(sub.expiryDate)}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(sub.id); }}
              className="ml-0.5 text-slate-300 opacity-0 transition hover:text-rose-400 group-hover:opacity-100 dark:text-slate-600 dark:hover:text-rose-400"
              title="삭제"
            >
              ✕
            </button>
          </div>
        )
      )}
      {subscriptions.length === 0 && editingId !== "new" ? (
        <span className="col-span-2 text-xs text-slate-400 dark:text-slate-500 md:col-span-1">
          구독 만료일을 추가해보세요
        </span>
      ) : null}
      {editingId === "new" ? (
        <div className="col-span-2 flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-900 md:col-span-1">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            placeholder="서비스명"
            className="w-24 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
          />
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            className="w-28 bg-transparent text-xs text-slate-700 outline-none dark:text-slate-200 dark::[color-scheme:dark]"
          />
          <button onClick={save} className="text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300" title="저장">✓</button>
          <button onClick={cancel} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title="취소">✗</button>
        </div>
      ) : (
        <button
          onClick={startNew}
          className={`hidden h-4 w-4 items-center justify-center justify-self-end rounded-full text-xs leading-none text-slate-200 transition hover:text-emerald-500 md:inline-flex md:h-5 md:w-5 md:border md:border-dashed md:border-slate-300 md:text-sm md:text-slate-400 md:hover:border-emerald-400 md:focus-visible:opacity-100 dark:text-slate-700 dark:hover:text-emerald-400 md:dark:border-slate-600 md:dark:text-slate-500 md:dark:hover:border-emerald-500 ${
            subscriptions.length === 0
              ? ""
              : "md:opacity-0 md:transition-opacity md:group-hover/sub:opacity-100"
          }`}
          title="구독 추가"
        >
          +
        </button>
      )}
    </div>
  );
}

function MottoLine({ motto, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(motto);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(motto);
  }, [motto, editing]);

  async function commit() {
    const next = draft.trim().slice(0, 100);
    setEditing(false);
    if (next === motto) return;
    try {
      setSaving(true);
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(motto);
  }

  if (editing) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              cancel();
            }
          }}
          maxLength={100}
          placeholder="다짐 한 줄을 적어보세요"
          spellCheck={false}
          className="w-full rounded border border-emerald-300 bg-white px-2 py-1 font-serif text-sm font-medium italic text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 md:text-base dark:border-emerald-500/40 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-emerald-500/20"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="클릭하여 편집"
      className="group/motto mt-1 block w-full rounded text-left leading-snug transition-colors"
    >
      <span
        aria-hidden
        className="select-none font-serif text-base text-slate-300 md:text-lg dark:text-slate-600"
      >
        ❝
      </span>
      <span
        className={`font-serif text-sm font-medium italic md:text-base ${
          motto
            ? "text-slate-700 dark:text-slate-300"
            : "text-slate-400 dark:text-slate-600"
        } group-hover/motto:text-emerald-600 dark:group-hover/motto:text-emerald-300`}
      >
        {motto || "다짐 한 줄을 적어보세요"}
      </span>
      {" "}
      <span
        aria-hidden
        className="select-none font-serif text-base text-slate-300 md:text-lg dark:text-slate-600"
      >
        ❞
      </span>
      {saving ? (
        <Loader2
          className="ml-1 inline-block animate-spin align-middle text-slate-400"
          size={12}
        />
      ) : null}
    </button>
  );
}

function App() {
  const [theme, setTheme] = useTheme();
  const [showHidden, setShowHidden] = useShowHidden();
  const [showMotto, setShowMotto] = useLocalToggle("showMotto", true);
  const [showSubBar, setShowSubBar] = useLocalToggle("showSubBar", true);
  const [showInProgressSummary, setShowInProgressSummary] = useLocalToggle(
    "showInProgressSummary",
    true,
  );
  const [subscriptions, setSubscriptions] = useState([]);
  const [calendarNotes, setCalendarNotes] = useState([]);
  const [authStatus, setAuthStatus] = useState("checking");
  const [tabs, setTabs] = useState([]);
  const [items, setItems] = useState([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [currentUser, setCurrentUser] = useState(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [signupForm, setSignupForm] = useState({
    username: "",
    password: "",
    passwordConfirm: "",
    email: "",
    signupCode: "",
  });
  const [signupError, setSignupError] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const toastIdRef = useRef(0);
  const toastTimerRef = useRef(null);
  const [newTabName, setNewTabName] = useState("");
  const [showAddTab, setShowAddTab] = useState(false);
  const [savingTab, setSavingTab] = useState(false);
  const [subscriptionAddRequestKey, setSubscriptionAddRequestKey] = useState(0);
  const [newItemText, setNewItemText] = useState("");
  const [savingItem, setSavingItem] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [tabHintActive, setTabHintActive] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showMeditation, setShowMeditation] = useState(false);
  const [playingCue, setPlayingCue] = useState(null);
  const meditationAudioRef = useRef(null);
  const tabNavRef = useRef(null);
  const tabHintTimer = useRef(null);
  const itemTimers = useRef(new Map());
  const pendingItemUpdates = useRef(new Map());

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const tabSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const displayedStatuses = useMemo(
    () => STATUSES.filter((status) => showHidden || status.id !== "hidden"),
    [showHidden],
  );

  const tabNameById = useMemo(() => {
    const map = new Map();
    tabs.forEach((tab) => map.set(tab.id, tab.name));
    return map;
  }, [tabs]);

  const tabPositionById = useMemo(() => {
    const map = new Map();
    tabs.forEach((tab, index) => map.set(tab.id, tab.position ?? index));
    return map;
  }, [tabs]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) || null,
    [tabs, activeTabId],
  );

  const inProgressItems = useMemo(() => {
    return items
      .filter((item) => item.status === "in_progress")
      .sort((a, b) => {
        const ta = tabPositionById.get(a.tabId) ?? 0;
        const tb = tabPositionById.get(b.tabId) ?? 0;
        if (ta !== tb) return ta - tb;
        return (a.position ?? 0) - (b.position ?? 0);
      });
  }, [items, tabPositionById]);

  const activeItems = useMemo(
    () => items.filter((item) => item.tabId === activeTabId),
    [items, activeTabId],
  );

  const activeGroupNames = useMemo(() => {
    return Array.from(
      new Set(
        activeItems
          .map((item) => String(item.groupName || "").trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [activeItems]);

  const itemsByStatus = useMemo(() => {
    const groups = STATUSES.reduce((acc, status) => {
      acc[status.id] = [];
      return acc;
    }, {});
    activeItems.forEach((item) => {
      if (groups[item.status]) {
        groups[item.status].push(item);
      }
    });
    return groups;
  }, [activeItems]);

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      try {
        const session = await apiRequest("/api/session");
        if (!isMounted) return;

        if (!session.authenticated) {
          setAuthStatus("unauthenticated");
          return;
        }

        if (session.user) {
          setCurrentUser(session.user);
        }
        setAuthStatus("authenticated");
        setIsReady(false);

        try {
          const [dashboard, subs, notes] = await Promise.all([
            apiRequest("/api/dashboard"),
            loadSubscriptions(),
            loadCalendarNotes(),
          ]);
          if (isMounted) {
            applyDashboard(dashboard);
            setSubscriptions(subs);
            setCalendarNotes(notes);
            setError("");
          }
        } catch (requestError) {
          if (isMounted) handleRequestError(requestError);
        } finally {
          if (isMounted) setIsReady(true);
        }
      } catch (requestError) {
        if (isMounted) {
          setAuthStatus("unauthenticated");
          setLoginError(errorMessage(requestError));
        }
      }
    }

    boot();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") return undefined;

    let isMounted = true;

    async function syncSubscriptions() {
      try {
        const subs = await loadSubscriptions();
        if (isMounted) setSubscriptions(subs);
      } catch (requestError) {
        if (isMounted) handleRequestError(requestError);
      }
    }

    async function syncCalendarNotes() {
      try {
        const notes = await loadCalendarNotes();
        if (isMounted) setCalendarNotes(notes);
      } catch (requestError) {
        if (isMounted) handleRequestError(requestError);
      }
    }

    function handleSync() {
      syncSubscriptions();
      syncCalendarNotes();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        handleSync();
      }
    }

    window.addEventListener("focus", handleSync);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", handleSync);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authStatus]);

  useEffect(() => {
    return () => {
      if (tabHintTimer.current) window.clearTimeout(tabHintTimer.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      itemTimers.current.forEach((timerId) => window.clearTimeout(timerId));
      itemTimers.current.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      const audio = meditationAudioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
        meditationAudioRef.current = null;
      }
    };
  }, []);

  function handleMeditationCue(trackIndex, cueIndex) {
    const track = MEDITATION_TRACKS[trackIndex];
    if (!track) return;
    const startSec = track.cues[cueIndex];

    if (
      playingCue &&
      playingCue.track === trackIndex &&
      playingCue.cue === cueIndex
    ) {
      if (meditationAudioRef.current) {
        meditationAudioRef.current.pause();
      }
      setPlayingCue(null);
      return;
    }

    if (!meditationAudioRef.current) {
      const el = new Audio();
      el.preload = "none";
      el.addEventListener("ended", () => setPlayingCue(null));
      el.addEventListener("error", () => setPlayingCue(null));
      meditationAudioRef.current = el;
    }

    const audio = meditationAudioRef.current;
    audio.pause();

    const desiredSrc = new URL(track.src, window.location.origin).toString();
    const srcChanged = audio.src !== desiredSrc;
    if (srcChanged) {
      audio.src = track.src;
    }

    const startAt = () => {
      try {
        audio.currentTime = startSec;
      } catch {
        /* metadata가 아직 없으면 무시; play() 후 다시 시도되지 않아도 무방 */
      }
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => setPlayingCue(null));
      }
    };

    if (srcChanged || audio.readyState < 1) {
      const onLoaded = () => {
        audio.removeEventListener("loadedmetadata", onLoaded);
        startAt();
      };
      audio.addEventListener("loadedmetadata", onLoaded);
      audio.load();
    } else {
      startAt();
    }

    setPlayingCue({ track: trackIndex, cue: cueIndex });
  }

  function focusTabNavFromInput() {
    tabNavRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTabHintActive(true);
    if (tabHintTimer.current) window.clearTimeout(tabHintTimer.current);
    tabHintTimer.current = window.setTimeout(() => {
      setTabHintActive(false);
      tabHintTimer.current = null;
    }, 1200);
  }

  function applyDashboard(dashboard) {
    const nextTabs = Array.isArray(dashboard.tabs) ? dashboard.tabs : [];
    const nextItems = Array.isArray(dashboard.items) ? dashboard.items : [];
    setTabs(nextTabs);
    setItems(nextItems);
    setActiveTabId((current) => {
      if (current && nextTabs.some((tab) => tab.id === current)) {
        return current;
      }
      return nextTabs[0]?.id || "";
    });
  }

  function errorMessage(requestError) {
    return requestError instanceof Error
      ? requestError.message
      : "요청 처리 중 오류가 발생했습니다.";
  }

  function handleRequestError(requestError) {
    if (requestError instanceof ApiError && requestError.statusCode === 401) {
      setAuthStatus("unauthenticated");
      setIsReady(false);
      setLoginError("다시 로그인해주세요.");
      return;
    }
    setError(errorMessage(requestError));
  }

  async function refreshSubscriptions() {
    const subs = await loadSubscriptions();
    setSubscriptions(subs);
    return subs;
  }

  async function refreshCalendarNotes() {
    const notes = await loadCalendarNotes();
    setCalendarNotes(notes);
    return notes;
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  async function handleLogin(event) {
    event.preventDefault();
    const username = loginUsername.trim();
    const password = loginPassword;
    if (!username || !password) {
      setLoginError("사용자명과 비밀번호를 입력해주세요.");
      return;
    }

    setLoginError("");
    setLoginLoading(true);
    setIsReady(false);

    try {
      const session = await apiRequest("/api/session", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (session?.user) {
        setCurrentUser(session.user);
      }
      const [dashboard, subs, notes] = await Promise.all([
        apiRequest("/api/dashboard"),
        loadSubscriptions(),
        loadCalendarNotes(),
      ]);

      applyDashboard(dashboard);
      setSubscriptions(subs);
      setCalendarNotes(notes);
      setLoginPassword("");
      setLoginUsername("");
      setAuthStatus("authenticated");
      setError("");
      setIsReady(true);
    } catch (requestError) {
      setLoginError(errorMessage(requestError));
      setIsReady(false);
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    const { username, password, passwordConfirm, email, signupCode } = signupForm;
    if (!username.trim() || !password || !signupCode) {
      setSignupError("사용자명, 비밀번호, 가입 코드를 입력해주세요.");
      return;
    }
    if (password !== passwordConfirm) {
      setSignupError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setSignupError("");
    setSignupLoading(true);
    setIsReady(false);

    try {
      const session = await apiRequest("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password,
          email: email.trim() || undefined,
          signupCode,
        }),
      });
      if (session?.user) {
        setCurrentUser(session.user);
      }
      const [dashboard, subs, notes] = await Promise.all([
        apiRequest("/api/dashboard"),
        loadSubscriptions(),
        loadCalendarNotes(),
      ]);

      applyDashboard(dashboard);
      setSubscriptions(subs);
      setCalendarNotes(notes);
      setSignupForm({
        username: "",
        password: "",
        passwordConfirm: "",
        email: "",
        signupCode: "",
      });
      setAuthStatus("authenticated");
      setError("");
      setIsReady(true);
    } catch (requestError) {
      setSignupError(errorMessage(requestError));
      setIsReady(false);
    } finally {
      setSignupLoading(false);
    }
  }

  async function handleSaveSub(sub) {
    try {
      await apiRequest("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({ id: sub.id, name: sub.name, expiryDate: sub.expiryDate }),
      });
      await refreshSubscriptions();
    } catch (requestError) {
      handleRequestError(requestError);
    }
  }

  async function handleDeleteSub(id) {
    try {
      await apiRequest(`/api/subscriptions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await refreshSubscriptions();
    } catch (requestError) {
      handleRequestError(requestError);
    }
  }

  async function handleSaveMotto(nextMotto) {
    try {
      const data = await apiRequest("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ motto: nextMotto }),
      });
      setCurrentUser((prev) =>
        prev ? { ...prev, motto: data?.user?.motto ?? nextMotto } : prev,
      );
    } catch (requestError) {
      showToast("모토 저장에 실패했습니다");
      handleRequestError(requestError);
    }
  }

  async function handleAddCalendarNote(date, text) {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    try {
      const res = await apiRequest("/api/calendar-notes", {
        method: "POST",
        body: JSON.stringify({ date, text: cleanText }),
      });
      if (res?.note) {
        setCalendarNotes((prev) => [...prev, res.note]);
      } else {
        await refreshCalendarNotes();
      }
    } catch (requestError) {
      handleRequestError(requestError);
    }
  }

  async function handleUpdateCalendarNote(id, patch) {
    try {
      const res = await apiRequest(
        `/api/calendar-notes/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
      );
      if (res?.note) {
        setCalendarNotes((prev) =>
          prev.map((n) => (n.id === id ? res.note : n)),
        );
      } else {
        await refreshCalendarNotes();
      }
    } catch (requestError) {
      handleRequestError(requestError);
    }
  }

  async function handleDeleteCalendarNote(id) {
    try {
      await apiRequest(`/api/calendar-notes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setCalendarNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (requestError) {
      handleRequestError(requestError);
    }
  }

  async function handleLogout() {
    try {
      await apiRequest("/api/logout", { method: "POST" });
    } finally {
      setAuthStatus("unauthenticated");
      setAuthMode("login");
      setCurrentUser(null);
      setSubscriptions([]);
      setTabs([]);
      setItems([]);
      setActiveTabId("");
      setIsReady(false);
      setNewItemText("");
      setNewTabName("");
      setError("");
      setCalendarNotes([]);
    }
  }

  async function addTab(event) {
    event.preventDefault();
    const name = newTabName.trim();
    if (!name || savingTab) return;

    setSavingTab(true);
    setError("");
    try {
      const { tab } = await apiRequest("/api/tabs", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
      setNewTabName("");
      setShowAddTab(false);
    } catch (requestError) {
      handleRequestError(requestError);
    } finally {
      setSavingTab(false);
    }
  }

  async function removeTab(tabId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    const itemCount = items.filter((entry) => entry.tabId === tabId).length;
    const message =
      itemCount > 0
        ? `'${tab?.name}' 주제를 삭제하면 항목 ${itemCount}개도 함께 삭제됩니다. 계속할까요?`
        : `'${tab?.name}' 주제를 삭제할까요?`;
    if (!window.confirm(message)) return;

    setError("");
    try {
      await apiRequest(`/api/tabs/${encodeURIComponent(tabId)}`, {
        method: "DELETE",
      });
      const remaining = tabs.filter((entry) => entry.id !== tabId);
      setTabs(remaining);
      setItems((current) => current.filter((entry) => entry.tabId !== tabId));
      setActiveTabId((current) =>
        current === tabId ? remaining[0]?.id || "" : current,
      );
    } catch (requestError) {
      handleRequestError(requestError);
    }
  }

  async function renameTab(tabId, nextName) {
    const trimmed = nextName.trim();
    const target = tabs.find((entry) => entry.id === tabId);
    if (!target || !trimmed || trimmed === target.name) return;

    const previous = tabs;
    setTabs((current) =>
      current.map((entry) =>
        entry.id === tabId ? { ...entry, name: trimmed } : entry,
      ),
    );
    setError("");
    try {
      await apiRequest(`/api/tabs/${encodeURIComponent(tabId)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed }),
      });
    } catch (requestError) {
      setTabs(previous);
      handleRequestError(requestError);
    }
  }

  async function handleTabDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.findIndex((entry) => entry.id === active.id);
    const newIndex = tabs.findIndex((entry) => entry.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previous = tabs;
    const reordered = arrayMove(tabs, oldIndex, newIndex).map((tab, index) => ({
      ...tab,
      position: index,
    }));
    setTabs(reordered);
    setError("");

    try {
      await Promise.all(
        reordered.map((tab, index) => {
          const original = previous.find((entry) => entry.id === tab.id);
          if (original && (original.position ?? -1) === index) return null;
          return apiRequest(`/api/tabs/${encodeURIComponent(tab.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ position: index }),
          });
        }),
      );
    } catch (requestError) {
      setTabs(previous);
      handleRequestError(requestError);
    }
  }

  async function addItem(event) {
    event.preventDefault();
    const { groupName, text } = parseGroupedText(newItemText);
    if (!text || !activeTabId || savingItem) return;

    setSavingItem(true);
    setError("");
    try {
      const { item } = await apiRequest("/api/items", {
        method: "POST",
        body: JSON.stringify({ tabId: activeTabId, text, groupName }),
      });
      setItems((current) => [item, ...current]);
      setNewItemText("");
    } catch (requestError) {
      handleRequestError(requestError);
    } finally {
      setSavingItem(false);
    }
  }

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  function handleDragEnd(event) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const nextStatus = String(over.id);
    if (!STATUS_BY_ID[nextStatus]) return;
    moveItem(String(active.id), nextStatus);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  async function moveGroupToHidden(groupName) {
    const targets = activeItems.filter(
      (item) => String(item.groupName || "").trim() === groupName && item.status === "done",
    );
    await Promise.all(targets.map((item) => moveItem(item.id, "hidden")));
  }

  async function moveItemToHidden(itemId) {
    await moveItem(itemId, "hidden");
  }

  async function moveItem(itemId, nextStatus) {
    const previous = items.find((entry) => entry.id === itemId);
    if (!previous || previous.status === nextStatus) return false;

    setItems((current) =>
      current.map((entry) =>
        entry.id === itemId ? { ...entry, status: nextStatus } : entry,
      ),
    );
    try {
      const { item } = await apiRequest(
        `/api/items/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      setItems((current) =>
        current.map((entry) => (entry.id === itemId ? item : entry)),
      );
      return true;
    } catch (requestError) {
      setItems((current) =>
        current.map((entry) => (entry.id === itemId ? previous : entry)),
      );
      handleRequestError(requestError);
      return false;
    }
  }

  function showToast(message) {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToast({ id, message });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => (current && current.id === id ? null : current));
      toastTimerRef.current = null;
    }, 2500);
  }

  async function handleCheckInProgress(itemId) {
    const target = items.find((entry) => entry.id === itemId);
    if (!target) return;
    const text = target.text;
    const ok = await moveItem(itemId, "done");
    if (ok) {
      const truncated = text.length > 40 ? `${text.slice(0, 40)}…` : text;
      showToast(`완료로 이동: ${truncated}`);
    }
  }

  async function removeItem(itemId) {
    if (!window.confirm("이 항목을 삭제할까요?")) return;
    setError("");
    try {
      await apiRequest(`/api/items/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
      });
      setItems((current) => current.filter((entry) => entry.id !== itemId));
    } catch (requestError) {
      handleRequestError(requestError);
    }
  }

  async function updateItemText(itemId, text, groupName) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setItems((current) =>
      current.map((entry) =>
        entry.id === itemId
          ? { ...entry, text: trimmed, groupName: groupName ?? entry.groupName ?? "" }
          : entry,
      ),
    );
    try {
      await apiRequest(`/api/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          text: trimmed,
          ...(groupName !== undefined ? { groupName } : {}),
        }),
      });
    } catch (requestError) {
      handleRequestError(requestError);
    }
  }

  function applyMemos(itemId, memos, { debounce = true } = {}) {
    setItems((current) =>
      current.map((entry) =>
        entry.id === itemId ? { ...entry, memos } : entry,
      ),
    );
    pendingItemUpdates.current.set(itemId, memos);

    const existingTimer = itemTimers.current.get(itemId);
    if (existingTimer) window.clearTimeout(existingTimer);

    if (!debounce) {
      itemTimers.current.delete(itemId);
      pendingItemUpdates.current.delete(itemId);
      void saveItemMemos(itemId, memos);
      return;
    }

    const timerId = window.setTimeout(() => {
      itemTimers.current.delete(itemId);
      const next = pendingItemUpdates.current.get(itemId);
      pendingItemUpdates.current.delete(itemId);
      if (next !== undefined) void saveItemMemos(itemId, next);
    }, 500);

    itemTimers.current.set(itemId, timerId);
  }

  function flushItemMemos(itemId) {
    const timerId = itemTimers.current.get(itemId);
    if (!timerId) return;
    window.clearTimeout(timerId);
    itemTimers.current.delete(itemId);
    const next = pendingItemUpdates.current.get(itemId);
    pendingItemUpdates.current.delete(itemId);
    if (next !== undefined) void saveItemMemos(itemId, next);
  }

  function updateMemoText(itemId, memoId, text) {
    const target = items.find((entry) => entry.id === itemId);
    if (!target) return;
    const memos = (target.memos || []).map((memo) =>
      memo.id === memoId ? { ...memo, text } : memo,
    );
    applyMemos(itemId, memos, { debounce: true });
  }

  function addMemo(itemId) {
    const target = items.find((entry) => entry.id === itemId);
    if (!target) return;
    const newMemo = {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: "",
      createdAt: new Date().toISOString(),
    };
    const memos = [...(target.memos || []), newMemo];
    applyMemos(itemId, memos, { debounce: false });
  }

  function removeMemo(itemId, memoId) {
    const target = items.find((entry) => entry.id === itemId);
    if (!target) return;
    const memos = (target.memos || []).filter((memo) => memo.id !== memoId);
    applyMemos(itemId, memos, { debounce: false });
  }

  async function saveItemMemos(itemId, memos) {
    try {
      await apiRequest(`/api/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify({ memos }),
      });
    } catch (requestError) {
      handleRequestError(requestError);
    }
  }

  if (authStatus === "checking") {
    return (
      <LoadingShell theme={theme} onToggleTheme={toggleTheme}>
        접속 상태를 확인하는 중
      </LoadingShell>
    );
  }

  if (authStatus !== "authenticated") {
    if (authMode === "signup") {
      return (
        <SignupScreen
          theme={theme}
          form={signupForm}
          error={signupError}
          isLoading={signupLoading}
          onToggleTheme={toggleTheme}
          onChange={(patch) => setSignupForm((prev) => ({ ...prev, ...patch }))}
          onSubmit={handleSignup}
          onSwitchToLogin={() => {
            setAuthMode("login");
            setSignupError("");
          }}
        />
      );
    }
    return (
      <LoginScreen
        theme={theme}
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        isLoading={loginLoading}
        onToggleTheme={toggleTheme}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLogin}
        onSwitchToSignup={() => {
          setAuthMode("signup");
          setLoginError("");
        }}
      />
    );
  }

  return (
    <main className="min-h-screen px-4 py-5 text-[#202020] transition-colors duration-300 dark:text-slate-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
        <header className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-3 border-b border-slate-200 pb-5 pt-3 dark:border-slate-800 md:gap-x-4">
          <div>
            <p className="font-serif text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Pace
            </p>
          </div>

          <div className="flex items-center justify-self-end gap-3">
            <span className="text-sm font-medium tabular-nums text-slate-500 dark:text-slate-400">
              {formatToday()}
            </span>
            <SettingsMenu
              theme={theme}
              onSetTheme={setTheme}
              showHidden={showHidden}
              onToggleHidden={() => setShowHidden((value) => !value)}
              showMotto={showMotto}
              onToggleMotto={() => setShowMotto((value) => !value)}
              showSubBar={showSubBar}
              onToggleSubBar={() => setShowSubBar((value) => !value)}
              onAddSubscription={() => {
                setShowSubBar(true);
                setSubscriptionAddRequestKey((value) => value + 1);
              }}
              onAddTab={() => {
                setShowAddTab(true);
                setNewTabName("");
              }}
              showInProgressSummary={showInProgressSummary}
              onToggleInProgressSummary={() =>
                setShowInProgressSummary((value) => !value)
              }
              onLogout={handleLogout}
              currentUser={currentUser}
            />
          </div>

          {showMotto && currentUser ? (
            <div className="col-span-2 md:col-span-1 md:col-start-1 md:row-start-2">
              <MottoLine
                motto={currentUser.motto || ""}
                onSave={handleSaveMotto}
              />
            </div>
          ) : null}

          {showSubBar ? (
            <div className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-2 md:justify-self-end">
              <SubscriptionBar
                subscriptions={subscriptions}
                onSave={handleSaveSub}
                onDelete={handleDeleteSub}
                addRequestKey={subscriptionAddRequestKey}
              />
            </div>
          ) : null}
        </header>

        {showInProgressSummary && inProgressItems.length > 0 ? (
          <section
            aria-label="진행중 항목 요약"
            className="-mt-1 columns-1 gap-x-8 text-xs leading-5 text-slate-500 dark:text-slate-400 sm:columns-2 lg:columns-3"
          >
            {inProgressItems.map((item) => {
              const tabName = tabNameById.get(item.tabId);
              return (
                <div
                  key={item.id}
                  className="mb-1 flex break-inside-avoid items-start gap-1.5 break-words"
                >
                  <input
                    type="checkbox"
                    aria-label={`완료로 이동: ${item.text}`}
                    onChange={(event) => {
                      if (event.target.checked) {
                        handleCheckInProgress(item.id);
                      }
                    }}
                    className="mt-[3px] h-3.5 w-3.5 shrink-0 cursor-pointer accent-emerald-500"
                  />
                  {tabName ? (
                    <>
                      <span className="inline-block w-12 shrink-0 text-center text-slate-400 dark:text-slate-500">
                        {tabName}
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">
                        ·
                      </span>
                    </>
                  ) : null}
                  <span className="min-w-0 break-words text-slate-600 dark:text-slate-300">
                    {item.text}
                  </span>
                </div>
              );
            })}
          </section>
        ) : null}

        <DndContext
          sensors={tabSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleTabDragEnd}
        >
          <nav
            aria-label="주제"
            ref={tabNavRef}
            className="group/tabs flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-950"
          >
            <SortableContext
              items={tabs.map((tab) => tab.id)}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  isHighlighted={tabHintActive && tab.id === activeTabId}
                  onActivate={(id) => {
                    setActiveTabId(id);
                    setError("");
                  }}
                  onRemove={removeTab}
                  onRename={renameTab}
                />
              ))}
            </SortableContext>

            {tabs.length === 0 && !showAddTab ? (
              <span className="text-xs text-slate-400 md:ml-auto dark:text-slate-500">
                새 주제 버튼으로 첫 주제를 만들어주세요
              </span>
            ) : null}
            {showAddTab ? (
            <form onSubmit={addTab} className="order-last mt-1 flex w-full items-center gap-1 md:order-none md:ml-auto md:mt-0 md:w-auto">
              <input
                value={newTabName}
                onChange={(event) => setNewTabName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setShowAddTab(false);
                    setNewTabName("");
                  }
                }}
                autoFocus
                placeholder="새 주제 이름"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm text-[#202020] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 md:min-w-32 md:flex-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-emerald-400 dark:focus:ring-emerald-500/20"
              />
              <button
                type="submit"
                disabled={!newTabName.trim() || savingTab}
                className="inline-flex h-9 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
              >
                {savingTab ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  "추가"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddTab(false);
                  setNewTabName("");
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="취소"
              >
                <X size={16} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddTab(true)}
              className={`ml-auto hidden h-9 w-auto items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 px-3 text-sm font-medium text-slate-500 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:opacity-100 md:inline-flex dark:border-slate-700 dark:text-slate-400 dark:hover:border-emerald-500 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200 ${
                tabs.length === 0
                  ? ""
                  : "md:opacity-0 md:transition-opacity md:group-hover/tabs:opacity-100"
              }`}
            >
              <Plus size={14} />
              <span className="hidden md:inline">새 주제</span>
            </button>
          )}
          </nav>
        </DndContext>

        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        {!isReady ? (
          <section className="flex min-h-[420px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            <Loader2 className="mr-2 animate-spin" size={18} />
            데이터를 불러오는 중
          </section>
        ) : tabs.length === 0 ? (
          <section className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
            <Plus size={28} />
            <p className="text-base font-semibold text-slate-700 dark:text-slate-200">
              환영합니다 👋
            </p>
            <p className="text-sm">
              주제(탭)를 먼저 만들어 칸반을 시작하세요.
              <br />
              오른쪽 위 <b>+</b> 버튼을 눌러 첫 주제를 만들어보세요.
            </p>
          </section>
        ) : !activeTabId ? (
          <section className="flex min-h-[420px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            주제를 선택해주세요.
          </section>
        ) : (
          <>
            <form
              onSubmit={addItem}
              className="flex gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950"
            >
              <HashtagInput
                value={newItemText}
                onChange={(event) => setNewItemText(event.target.value)}
                suggestions={activeGroupNames}
                leadingItems={[
                  {
                    key: "tab",
                    label: activeTab?.name || "",
                    title: activeTab?.name || "",
                    ariaLabel: `현재 탭: ${activeTab?.name || ""}`,
                    onClick: focusTabNavFromInput,
                    className:
                      "border-slate-200 bg-slate-50/80 px-2 py-1 text-xs font-bold text-slate-400 transition hover:border-emerald-200 hover:text-emerald-600 md:pointer-events-none md:hover:border-slate-200 md:hover:text-slate-400 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-500 dark:hover:border-emerald-500/40 dark:hover:text-emerald-300 dark:md:hover:border-slate-700 dark:md:hover:text-slate-500",
                  },
                  {
                    key: "group",
                    label: parseGroupedText(newItemText).groupName
                      ? `#${parseGroupedText(newItemText).groupName}`
                      : "#",
                    title: "소주제 입력",
                    ariaLabel: "소주제 입력 시작",
                    insertText: "#",
                    className:
                      "border-slate-100 bg-slate-50/50 px-1.5 py-0.5 text-[11px] font-bold text-slate-400 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-500 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300",
                  },
                ]}
                placeholder=""
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#202020] outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:placeholder:text-slate-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-500/20"
              />
              <button
                type="submit"
                title="항목 추가"
                disabled={!parseGroupedText(newItemText).text || savingItem}
                className="inline-flex h-10 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
              >
                {savingItem ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <Plus size={17} />
                )}
                추가
              </button>
            </form>

            {activeItems.length === 0 ? (
              <p className="-mt-1 px-1 text-xs text-slate-500 dark:text-slate-400">
                💡 할 일을 입력하고 Enter — 앞에 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-emerald-700 dark:bg-slate-800 dark:text-emerald-300">#그룹명</code> 을 붙이면 같은 그룹으로 묶입니다.
              </p>
            ) : null}

            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <section
                key={activeTabId}
                className="flex animate-fade-up gap-3 overflow-x-auto pb-3"
                aria-label="칸반 보드"
              >
                {displayedStatuses.map((status) => (
                  <KanbanColumn
                    key={status.id}
                    status={status}
                    items={itemsByStatus[status.id]}
                    onRemove={removeItem}
                    onUpdateText={updateItemText}
                    onUpdateMemoText={updateMemoText}
                    onAddMemo={addMemo}
                    onRemoveMemo={removeMemo}
                    onFlushMemos={flushItemMemos}
                    groupSuggestions={activeGroupNames}
                    onMoveGroupToHidden={status.id === "done" ? moveGroupToHidden : undefined}
                    onMoveItemToHidden={status.id === "done" ? moveItemToHidden : undefined}
                    isFirstUseHint={activeItems.length === 0 && status.id === "todo"}
                  />
                ))}
              </section>
              <DragOverlay dropAnimation={null}>
                {activeId
                  ? (() => {
                      const dragged = items.find(
                        (entry) => entry.id === activeId,
                      );
                      if (!dragged) return null;
                      return <ItemCardPreview item={dragged} />;
                    })()
                  : null}
              </DragOverlay>
            </DndContext>
          </>
        )}

        {/* 캘린더 토글 */}
        <div className="mt-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setShowCalendar((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400"
          >
            <CalendarDays size={13} />
            <span>캘린더</span>
            <ChevronDown
              size={13}
              className={`transition-transform duration-200 ${showCalendar ? "rotate-180" : ""}`}
            />
          </button>
          {showCalendar && (
            <div className="mt-4 pb-4">
              <CalendarPanel
                notes={calendarNotes}
                onAdd={handleAddCalendarNote}
                onUpdate={handleUpdateCalendarNote}
                onDelete={handleDeleteCalendarNote}
              />
            </div>
          )}
        </div>

        {/* 명상 토글 */}
        <div className="mt-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setShowMeditation((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400"
          >
            <Headphones size={13} />
            <span>명상</span>
            <ChevronDown
              size={13}
              className={`transition-transform duration-200 ${showMeditation ? "rotate-180" : ""}`}
            />
          </button>
          {showMeditation && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 pb-4">
              {MEDITATION_TRACKS.map((track, trackIndex) =>
                track.cues.map((_, cueIndex) => {
                  const isActive =
                    playingCue &&
                    playingCue.track === trackIndex &&
                    playingCue.cue === cueIndex;
                  const cueLetter = String.fromCharCode(65 + cueIndex);
                  return (
                    <button
                      key={`${trackIndex}-${cueIndex}`}
                      type="button"
                      onClick={() => handleMeditationCue(trackIndex, cueIndex)}
                      aria-label={`트랙 ${track.label} 시작점 ${cueLetter} ${isActive ? "정지" : "재생"}`}
                      className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                        isActive
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-200"
                      }`}
                    >
                      {isActive ? <Square size={11} /> : <Play size={11} />}
                      <span>
                        {track.label}
                        {cueLetter}
                      </span>
                    </button>
                  );
                }),
              )}
            </div>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </main>
  );
}

const KR_HOLIDAYS = {
  // 고정 공휴일 (MM-DD)
  "01-01": "신정",
  "03-01": "삼일절",
  "05-05": "어린이날",
  "06-06": "현충일",
  "08-15": "광복절",
  "10-03": "개천절",
  "10-09": "한글날",
  "12-25": "성탄절",
  // 음력 기반 2025
  "2025-01-27": "설날 연휴",
  "2025-01-28": "설날 전날",
  "2025-01-29": "설날",
  "2025-05-06": "부처님오신날 대체",
  "2025-10-05": "추석 연휴",
  "2025-10-06": "추석",
  "2025-10-07": "추석 연휴",
  "2025-10-08": "추석 대체",
  // 음력 기반 2026
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "부처님오신날 대체",
  "2026-10-01": "추석 연휴",
  "2026-10-02": "추석",
  "2026-10-05": "개천절 대체",
  // 음력 기반 2027
  "2027-02-05": "설날 연휴",
  "2027-02-06": "설날",
  "2027-02-07": "설날 연휴",
  "2027-02-08": "설날 대체",
  "2027-05-13": "부처님오신날",
  "2027-09-20": "추석 연휴",
  "2027-09-21": "추석",
  "2027-09-22": "추석 연휴",
};

function getHoliday(year, month1, day) {
  const mm = String(month1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return KR_HOLIDAYS[`${year}-${mm}-${dd}`] || KR_HOLIDAYS[`${mm}-${dd}`] || null;
}

function formatDateKey(year, month0, day) {
  const mm = String(month0 + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function CalendarPanel({ notes = [], onAdd, onUpdate, onDelete }) {
  const today = new Date();
  const months = [-1, 0, 1].map((offset) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

  const [openDateKey, setOpenDateKey] = useState(null);
  const [longPressActive, setLongPressActive] = useState(null);
  const longPressTimerRef = useRef(null);
  const pointerStartRef = useRef(null);
  const wasTouchRef = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handleDayPointerDown(event, dateKey) {
    if (event.pointerType === "mouse") {
      wasTouchRef.current = false;
      return;
    }
    wasTouchRef.current = true;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    setLongPressActive(dateKey);
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setLongPressActive(null);
      setOpenDateKey((prev) => (prev === dateKey ? null : dateKey));
    }, 500);
  }

  function handleDayPointerMove(event) {
    if (!pointerStartRef.current) return;
    const dx = event.clientX - pointerStartRef.current.x;
    const dy = event.clientY - pointerStartRef.current.y;
    if (dx * dx + dy * dy > 36) {
      clearLongPressTimer();
      setLongPressActive(null);
    }
  }

  function handleDayPointerEnd() {
    clearLongPressTimer();
    setLongPressActive(null);
    pointerStartRef.current = null;
  }

  function handleDayClick(dateKey) {
    if (wasTouchRef.current) {
      wasTouchRef.current = false;
      return;
    }
    setOpenDateKey((prev) => (prev === dateKey ? null : dateKey));
  }

  useEffect(() => () => clearLongPressTimer(), []);

  const notesByDate = useMemo(() => {
    const map = new Map();
    for (const n of notes) {
      if (!n?.date) continue;
      const list = map.get(n.date) || [];
      list.push(n);
      map.set(n.date, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          String(a.createdAt || "").localeCompare(String(b.createdAt || "")),
      );
    }
    return map;
  }, [notes]);

  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
      {months.map(({ year, month }) => {
        const firstDow = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const cells = [
          ...Array(firstDow).fill(null),
          ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
        ];
        while (cells.length % 7 !== 0) cells.push(null);

        return (
          <div key={`${year}-${month}`}>
            <p className="mb-3 text-center text-sm font-semibold text-slate-600 dark:text-slate-300">
              {year}년 {month + 1}월
            </p>
            <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs">
              {DAY_LABELS.map((label, i) => (
                <div
                  key={label}
                  className={`pb-1.5 text-[11px] font-medium ${
                    i === 0
                      ? "text-rose-400 dark:text-rose-400"
                      : i === 6
                      ? "text-sky-400 dark:text-sky-400"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {label}
                </div>
              ))}
              {cells.map((day, i) => {
                if (!day)
                  return <div key={`e-${i}`} className="min-h-[2.5rem]" />;
                const dow = i % 7;
                const holiday = getHoliday(year, month + 1, day);
                const isToday =
                  today.getFullYear() === year &&
                  today.getMonth() === month &&
                  today.getDate() === day;
                const isRed = dow === 0 || holiday;
                const isBlue = dow === 6 && !holiday;
                const dateKey = formatDateKey(year, month, day);
                const dayNotes = notesByDate.get(dateKey) || [];
                const isOpen = openDateKey === dateKey;

                let popoverAlign = "left-1/2 -translate-x-1/2";
                if (dow <= 1) popoverAlign = "left-0";
                else if (dow >= 5) popoverAlign = "right-0";

                const numberColor = isToday
                  ? "text-emerald-700 dark:text-emerald-300"
                  : holiday
                  ? "text-rose-500 dark:text-rose-300"
                  : isRed
                  ? "text-rose-400 dark:text-rose-400"
                  : isBlue
                  ? "text-sky-400 dark:text-sky-400"
                  : "text-slate-600 dark:text-slate-300";

                const cellBg = isToday
                  ? "bg-emerald-100 dark:bg-emerald-500/20"
                  : holiday
                  ? "bg-rose-50 dark:bg-rose-400/10"
                  : "hover:bg-slate-100 dark:hover:bg-slate-800/60";

                return (
                  <div key={`d-${i}`} className="relative">
                    <button
                      type="button"
                      onPointerDown={(e) => handleDayPointerDown(e, dateKey)}
                      onPointerMove={handleDayPointerMove}
                      onPointerUp={handleDayPointerEnd}
                      onPointerCancel={handleDayPointerEnd}
                      onPointerLeave={handleDayPointerEnd}
                      onClick={() => handleDayClick(dateKey)}
                      title={holiday || undefined}
                      style={{ touchAction: "manipulation" }}
                      className={`flex min-h-[2.5rem] w-full flex-col items-stretch rounded-md px-0.5 py-0.5 text-xs font-medium transition-colors duration-500 ${cellBg} ${
                        longPressActive === dateKey
                          ? "bg-emerald-200/70 dark:bg-emerald-500/30 scale-[0.98]"
                          : ""
                      }`}
                    >
                      <span
                        className={`text-center leading-tight ${numberColor} ${
                          isToday ? "font-bold" : ""
                        }`}
                      >
                        {day}
                      </span>
                      {dayNotes.length > 0 && (
                        <span className="mt-0.5 flex flex-col gap-px overflow-hidden">
                          {dayNotes.slice(0, 2).map((n) => (
                            <span
                              key={n.id}
                              className="truncate rounded bg-slate-200/60 px-0.5 text-[9px] font-normal leading-tight text-slate-700 dark:bg-slate-700/50 dark:text-slate-200"
                            >
                              {n.text}
                            </span>
                          ))}
                          {dayNotes.length > 2 && (
                            <span className="text-[9px] font-normal leading-tight text-slate-500 dark:text-slate-400">
                              +{dayNotes.length - 2}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                    {isOpen && (
                      <CalendarDayPopover
                        dateKey={dateKey}
                        notes={dayNotes}
                        alignClass={popoverAlign}
                        onClose={() => setOpenDateKey(null)}
                        onAdd={onAdd}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CalendarDayPopover({
  dateKey,
  notes,
  alignClass,
  onClose,
  onAdd,
  onUpdate,
  onDelete,
}) {
  const containerRef = useRef(null);
  const [draftText, setDraftText] = useState("");

  useEffect(() => {
    function handlePointerDown(event) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        onClose();
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const dow = useMemo(() => {
    const [y, m, d] = dateKey.split("-").map(Number);
    const labels = ["일", "월", "화", "수", "목", "금", "토"];
    return labels[new Date(y, m - 1, d).getDay()];
  }, [dateKey]);

  function submitDraft() {
    const text = draftText.trim();
    if (!text) return;
    onAdd?.(dateKey, text);
    setDraftText("");
  }

  return (
    <div
      ref={containerRef}
      onClick={(e) => e.stopPropagation()}
      className={`absolute top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 text-left shadow-lg dark:border-slate-700 dark:bg-slate-900 ${alignClass}`}
    >
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
        <span>
          {dateKey} ({dow})
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X size={12} />
        </button>
      </div>
      {notes.length > 0 && (
        <ul className="mb-1.5 flex flex-col gap-1">
          {notes.map((n) => (
            <CalendarNoteRow
              key={n.id}
              note={n}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitDraft();
            }
          }}
          placeholder="메모 추가"
          maxLength={200}
          className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          autoFocus
        />
        <button
          type="button"
          onClick={submitDraft}
          disabled={!draftText.trim()}
          className="rounded bg-emerald-500 px-1.5 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          추가
        </button>
      </div>
    </div>
  );
}

function CalendarNoteRow({ note, onUpdate, onDelete }) {
  const [text, setText] = useState(note.text);

  useEffect(() => {
    setText(note.text);
  }, [note.text, note.id]);

  function commit() {
    const next = text.trim();
    if (!next) {
      onDelete?.(note.id);
      return;
    }
    if (next !== note.text) {
      onUpdate?.(note.id, { text: next });
    }
  }

  return (
    <li className="flex items-center gap-1">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        maxLength={200}
        className="flex-1 rounded border border-transparent bg-slate-100 px-1.5 py-1 text-[11px] text-slate-700 focus:border-emerald-400 focus:bg-white focus:outline-none dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
      />
      <button
        type="button"
        onClick={() => onDelete?.(note.id)}
        className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
        title="삭제"
      >
        <X size={12} />
      </button>
    </li>
  );
}

function HashtagInput({
  value,
  onChange,
  suggestions = [],
  leadingItems,
  leadingLabel = "",
  onLeadingClick,
  multiline = false,
  className = "",
  onKeyDown,
  style,
  ...props
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [leadingWidth, setLeadingWidth] = useState(0);
  const leadingRef = useRef(null);
  const inputRef = useRef(null);
  const resolvedLeadingItems = useMemo(() => {
    if (Array.isArray(leadingItems)) {
      return leadingItems.filter((item) => item?.label);
    }
    if (!leadingLabel) return [];
    return [
      {
        key: "leading",
        label: leadingLabel,
        title: leadingLabel,
        ariaLabel: `현재 탭: ${leadingLabel}`,
        onClick: onLeadingClick,
        className:
          "border-slate-200 bg-slate-50/80 px-2 py-1 text-xs font-bold text-slate-400 transition hover:border-emerald-200 hover:text-emerald-600 md:pointer-events-none md:hover:border-slate-200 md:hover:text-slate-400 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-500 dark:hover:border-emerald-500/40 dark:hover:text-emerald-300 dark:md:hover:border-slate-700 dark:md:hover:text-slate-500",
      },
    ];
  }, [leadingItems, leadingLabel, onLeadingClick]);
  const query = getHashtagQuery(value);
  const matches = useMemo(() => {
    if (query === null) return [];
    const lowerQuery = query.toLocaleLowerCase();
    return suggestions
      .filter((name) => name.toLocaleLowerCase().startsWith(lowerQuery))
      .slice(0, 6);
  }, [query, suggestions]);
  const showSuggestions = matches.length > 0;
  const InputTag = multiline ? "textarea" : "input";

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useLayoutEffect(() => {
    if (resolvedLeadingItems.length === 0 || multiline) {
      setLeadingWidth(0);
      return undefined;
    }

    function measure() {
      setLeadingWidth(leadingRef.current?.offsetWidth || 0);
    }

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [resolvedLeadingItems, multiline]);

  function emitValue(nextValue) {
    onChange({ target: { value: nextValue } });
  }

  function focusInput(selectionStart) {
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      if (
        Number.isInteger(selectionStart) &&
        typeof input.setSelectionRange === "function"
      ) {
        input.setSelectionRange(selectionStart, selectionStart);
      }
    });
  }

  function insertTextAtCursor(text) {
    const currentValue = String(value || "");
    const input = inputRef.current;
    const start = input?.selectionStart ?? currentValue.length;
    const end = input?.selectionEnd ?? start;
    const nextValue =
      currentValue.slice(0, start) + text + currentValue.slice(end);

    emitValue(nextValue);
    focusInput(start + text.length);
  }

  function applySuggestion(name) {
    emitValue(`#${name} `);
    focusInput(name.length + 2);
  }

  function handleLeadingItemClick(event, item) {
    if (item.insertText) {
      insertTextAtCursor(item.insertText);
      return;
    }
    item.onClick?.(event);
  }

  function handleKeyDown(event) {
    if (showSuggestions) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applySuggestion(matches[activeIndex] || matches[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
    }
    onKeyDown?.(event);
  }

  return (
    <div className="relative min-w-0 flex-1">
      {resolvedLeadingItems.length > 0 && !multiline ? (
        <div
          ref={leadingRef}
          className="absolute left-2 top-1/2 z-10 flex max-w-[52%] -translate-y-1/2 items-center gap-1 overflow-hidden"
        >
          {resolvedLeadingItems.map((item) => {
            const commonClass = `inline-flex min-w-0 shrink items-center rounded-md border ${item.className || ""}`;
            return item.onClick || item.insertText ? (
              <button
                key={item.key || item.label}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => handleLeadingItemClick(event, item)}
                className={commonClass}
                title={item.title || item.label}
                aria-label={item.ariaLabel || item.label}
              >
                <span className="truncate">{item.label}</span>
              </button>
            ) : (
              <span
                key={item.key || item.label}
                className={commonClass}
                title={item.title || item.label}
                aria-label={item.ariaLabel || item.label}
              >
                <span className="truncate">{item.label}</span>
              </span>
            );
          })}
        </div>
      ) : null}
      {false && resolvedLeadingItems.length > 0 && !multiline ? (
        <button
          ref={leadingRef}
          type="button"
          onClick={onLeadingClick}
          className="absolute left-2 top-1/2 z-10 inline-flex max-w-[42%] -translate-y-1/2 items-center rounded-md border border-slate-200 bg-slate-50/80 px-2 py-1 text-xs font-bold text-slate-400 transition hover:border-emerald-200 hover:text-emerald-600 md:pointer-events-none md:hover:border-slate-200 md:hover:text-slate-400 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-500 dark:hover:border-emerald-500/40 dark:hover:text-emerald-300 dark:md:hover:border-slate-700 dark:md:hover:text-slate-500"
          title={leadingLabel}
          aria-label={`현재 탭: ${leadingLabel}`}
        >
          <span className="truncate">{leadingLabel}</span>
        </button>
      ) : null}
      <InputTag
        ref={inputRef}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        className={`w-full ${className}`}
        style={{
          ...style,
          ...(leadingWidth ? { paddingLeft: `${leadingWidth + 18}px` } : {}),
        }}
        {...props}
      />
      {showSuggestions ? (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {matches.map((name, index) => (
            <button
              key={name}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySuggestion(name)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition ${
                index === activeIndex
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200"
                  : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              <span className="truncate">#{name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KanbanColumn({
  status,
  items,
  onRemove,
  onUpdateText,
  onUpdateMemoText,
  onAddMemo,
  onRemoveMemo,
  onFlushMemos,
  groupSuggestions,
  onMoveGroupToHidden,
  onMoveItemToHidden,
  isFirstUseHint = false,
}) {
  const Icon = status.icon;
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const ungroupedItems = items.filter((item) => !String(item.groupName || "").trim());
  const groupedItems = items.reduce((groups, item) => {
    const groupName = String(item.groupName || "").trim();
    if (!groupName) return groups;
    const existing = groups.find((group) => group.name === groupName);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ name: groupName, items: [item] });
    }
    return groups;
  }, []);

  function renderCard(item) {
    return (
      <ItemCard
        key={item.id}
        item={item}
        onRemove={onRemove}
        onUpdateText={onUpdateText}
        onUpdateMemoText={onUpdateMemoText}
        onAddMemo={onAddMemo}
        onRemoveMemo={onRemoveMemo}
        onFlushMemos={onFlushMemos}
        groupSuggestions={groupSuggestions}
        onMoveToHidden={onMoveItemToHidden}
      />
    );
  }

  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-[420px] w-72 shrink-0 flex-col gap-3 rounded-lg border bg-white/90 p-3 shadow-soft transition-colors dark:bg-slate-950/90 lg:flex-1 ${
        isOver
          ? `${accentBorder(status.accent)} ${accentRing(status.accent)}`
          : "border-slate-200 dark:border-slate-800"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${accentBg(status.accent)}`}
          >
            <Icon size={16} />
          </span>
          <h2 className="truncate text-sm font-bold text-[#202020] dark:text-slate-50">
            {status.label}
          </h2>
        </div>
        <span className="inline-flex min-w-7 items-center justify-center rounded-md border border-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-500 dark:border-slate-700 dark:text-slate-300">
          {items.length}
        </span>
      </div>

      <div className="flex min-h-[80px] flex-col gap-2">
        {items.length === 0 ? (
          <div
            className={`rounded-lg border border-dashed px-3 py-5 text-center text-xs transition-colors ${
              isOver
                ? `${accentBorder(status.accent)} bg-slate-50 dark:bg-slate-900/70`
                : "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-500"
            }`}
          >
            {isFirstUseHint ? (
              <>
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  여기에 첫 카드가 생깁니다
                </div>
                <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  🔄 카드를 드래그해 진행중·완료로 옮기세요
                </div>
              </>
            ) : (
              "여기로 드래그"
            )}
          </div>
        ) : (
          <>
            {ungroupedItems.map(renderCard)}
            {groupedItems.map((group) => (
              <section key={group.name} className={`group/grp flex flex-col gap-2 border-l-2 pl-2 ${accentLeftBorder(status.accent)}`}>
                <div className="flex items-center justify-between gap-2 px-1 pt-1">
                  <h3 className={`min-w-0 truncate text-xs font-bold ${accentText(status.accent)}`}>
                    #{group.name}
                  </h3>
                  <div className="flex items-center gap-1">
                    {onMoveGroupToHidden ? (
                      <button
                        type="button"
                        onClick={() => onMoveGroupToHidden(group.name)}
                        title={`#${group.name} 그룹 전체 숨기기`}
                        aria-label={`#${group.name} 그룹 전체 숨기기`}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 opacity-0 transition group-hover/grp:opacity-100 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                      >
                        <EyeOff size={11} />
                      </button>
                    ) : null}
                    <span className="inline-flex min-w-5 items-center justify-center rounded border border-slate-200 px-1 text-[11px] font-bold text-slate-400 dark:border-slate-700 dark:text-slate-500">
                      {group.items.length}
                    </span>
                  </div>
                </div>
                {group.items.map(renderCard)}
              </section>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function MemoInput({ value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      {...props}
    />
  );
}

function ItemCard({
  item,
  onRemove,
  onUpdateText,
  onUpdateMemoText,
  onAddMemo,
  onRemoveMemo,
  onFlushMemos,
  groupSuggestions,
  onMoveToHidden,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(formatGroupedText(item));
  const [activeMemoId, setActiveMemoId] = useState(null);
  const [longPressActive, setLongPressActive] = useState(false);
  const longPressTimerRef = useRef(null);
  const pointerStartRef = useRef(null);
  const wasTouchRef = useRef(false);
  const status = STATUS_BY_ID[item.status];
  const memos = Array.isArray(item.memos) ? item.memos : [];
  const isInteracting = isEditing || activeMemoId !== null;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: item.id, disabled: isInteracting });

  useEffect(() => {
    if (!isEditing) setDraft(formatGroupedText(item));
  }, [item.text, item.groupName, isEditing]);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handleTextPointerDown(event) {
    if (event.pointerType === "mouse") {
      wasTouchRef.current = false;
      return;
    }
    wasTouchRef.current = true;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    setLongPressActive(true);
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setLongPressActive(false);
      setIsEditing(true);
    }, 500);
  }

  function handleTextPointerMove(event) {
    if (!pointerStartRef.current) return;
    const dx = event.clientX - pointerStartRef.current.x;
    const dy = event.clientY - pointerStartRef.current.y;
    if (dx * dx + dy * dy > 36) {
      clearLongPressTimer();
      setLongPressActive(false);
    }
  }

  function handleTextPointerEnd() {
    clearLongPressTimer();
    setLongPressActive(false);
    pointerStartRef.current = null;
  }

  function handleTextClick() {
    if (wasTouchRef.current) {
      wasTouchRef.current = false;
      return;
    }
    setIsEditing(true);
  }

  useEffect(() => () => clearLongPressTimer(), []);

  function commitText() {
    setIsEditing(false);
    const { groupName, text } = parseGroupedText(draft);
    if (!text) {
      setDraft(formatGroupedText(item));
      return;
    }
    if (text === item.text && groupName === (item.groupName || "")) {
      setDraft(formatGroupedText(item));
      return;
    }
    onUpdateText(item.id, text, groupName);
  }

  function cancelEdit() {
    setDraft(formatGroupedText(item));
    setIsEditing(false);
  }

  function stopDragPropagation(event) {
    event.stopPropagation();
  }

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`touch-pan-x touch-pan-y group flex flex-col gap-2 rounded-lg border bg-white p-2.5 shadow-sm transition dark:bg-slate-900 ${accentBorder(status?.accent)} ${
        isDragging
          ? "cursor-grabbing opacity-30"
          : isInteracting
            ? "cursor-text"
            : "cursor-grab"
      }`}
    >
      <div className="flex items-start gap-2">
        {isEditing ? (
          <HashtagInput
            multiline
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            suggestions={groupSuggestions}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitText();
              } else if (event.key === "Escape") {
                cancelEdit();
              }
            }}
            autoFocus
            rows={2}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="min-w-0 flex-1 resize-none rounded border border-slate-200 bg-white px-2 py-1 text-sm text-[#202020] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:focus:border-emerald-400 dark:focus:ring-emerald-500/20"
          />
        ) : (
          <button
            type="button"
            onPointerDown={handleTextPointerDown}
            onPointerMove={handleTextPointerMove}
            onPointerUp={handleTextPointerEnd}
            onPointerCancel={handleTextPointerEnd}
            onPointerLeave={handleTextPointerEnd}
            onClick={handleTextClick}
            style={{ touchAction: "manipulation" }}
            className={`min-w-0 flex-1 cursor-text rounded text-left text-sm font-medium leading-6 text-slate-900 transition-shadow dark:text-slate-50 ${
              longPressActive
                ? "ring-2 ring-emerald-300/60 dark:ring-emerald-500/40"
                : ""
            }`}
          >
            <span className="break-words whitespace-pre-wrap">{item.text}</span>
          </button>
        )}
        {onMoveToHidden ? (
          <button
            type="button"
            onPointerDown={stopDragPropagation}
            onClick={() => onMoveToHidden(item.id)}
            title="숨기기"
            aria-label="숨기기"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <EyeOff size={13} />
          </button>
        ) : null}
        <button
          type="button"
          onPointerDown={stopDragPropagation}
          onClick={() => onRemove(item.id)}
          title="삭제"
          aria-label="삭제"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {memos.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {memos.map((memo) => (
            <div
              key={memo.id}
              className="flex items-start gap-1 rounded border border-slate-100 bg-slate-50/70 px-1.5 py-1 transition focus-within:border-amber-300 focus-within:bg-white dark:border-slate-800 dark:bg-slate-950/40 dark:focus-within:border-amber-300/60 dark:focus-within:bg-slate-950"
            >
              <MemoInput
                value={memo.text}
                onChange={(event) =>
                  onUpdateMemoText(item.id, memo.id, event.target.value)
                }
                onFocus={() => setActiveMemoId(memo.id)}
                onBlur={() => {
                  setActiveMemoId((current) =>
                    current === memo.id ? null : current,
                  );
                  onFlushMemos(item.id);
                }}
                placeholder=""
                className="min-w-0 flex-1 resize-none overflow-hidden rounded border border-transparent bg-transparent px-1 py-0.5 text-xs leading-5 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-300 dark:text-slate-300 dark:placeholder:text-slate-600 dark:focus:border-amber-300/60"
              />
              <button
                type="button"
                onPointerDown={stopDragPropagation}
                onClick={() => onRemoveMemo(item.id, memo.id)}
                title="메모 삭제"
                aria-label="메모 삭제"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onPointerDown={stopDragPropagation}
        onClick={() => onAddMemo(item.id)}
        title="메모 추가"
        aria-label="메모 추가"
        className="inline-flex h-5 w-5 items-center justify-center self-start rounded text-slate-400 transition hover:bg-amber-50 hover:text-amber-700 dark:text-slate-500 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
      >
        <Plus size={12} />
      </button>
    </article>
  );
}

function ItemCardPreview({ item }) {
  const status = STATUS_BY_ID[item.status];
  const memos = Array.isArray(item.memos) ? item.memos : [];
  return (
    <article
      className={`flex w-72 cursor-grabbing flex-col gap-2 rounded-lg border bg-white p-2.5 shadow-xl ring-2 ring-emerald-300 dark:bg-slate-900 dark:ring-emerald-400/40 ${accentBorder(status?.accent)}`}
    >
      <p className="break-words whitespace-pre-wrap text-sm font-medium leading-6 text-slate-900 dark:text-slate-50">
        {item.text}
      </p>
      {memos.length > 0 ? (
        <div className="flex flex-col gap-1">
          {memos.map((memo) =>
            memo.text ? (
              <p
                key={memo.id}
                className="break-words whitespace-pre-wrap rounded bg-slate-50 px-1.5 py-1 text-xs leading-5 text-slate-500 dark:bg-slate-950/60 dark:text-slate-400"
              >
                {memo.text}
              </p>
            ) : null,
          )}
        </div>
      ) : null}
    </article>
  );
}

function accentBg(accent) {
  switch (accent) {
    case "emerald":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200";
    case "sky":
      return "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200";
    case "amber":
      return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200";
    case "violet":
      return "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  }
}

function accentBorder(accent) {
  switch (accent) {
    case "emerald":
      return "border-emerald-100 dark:border-emerald-500/20";
    case "sky":
      return "border-sky-100 dark:border-sky-500/20";
    case "amber":
      return "border-amber-100 dark:border-amber-500/20";
    case "violet":
      return "border-violet-100 dark:border-violet-500/20";
    default:
      return "border-slate-200 dark:border-slate-800";
  }
}

function accentRing(accent) {
  switch (accent) {
    case "emerald":
      return "ring-2 ring-emerald-300 dark:ring-emerald-400/40";
    case "sky":
      return "ring-2 ring-sky-300 dark:ring-sky-400/40";
    case "amber":
      return "ring-2 ring-amber-300 dark:ring-amber-400/40";
    case "violet":
      return "ring-2 ring-violet-300 dark:ring-violet-400/40";
    default:
      return "ring-2 ring-slate-300 dark:ring-slate-500/40";
  }
}

function accentText(accent) {
  switch (accent) {
    case "emerald": return "text-emerald-600 dark:text-emerald-400";
    case "sky": return "text-sky-600 dark:text-sky-400";
    case "amber": return "text-amber-600 dark:text-amber-400";
    case "violet": return "text-violet-600 dark:text-violet-400";
    default: return "text-slate-500 dark:text-slate-400";
  }
}

function accentLeftBorder(accent) {
  switch (accent) {
    case "emerald": return "border-emerald-300 dark:border-emerald-500/50";
    case "sky": return "border-sky-300 dark:border-sky-500/50";
    case "amber": return "border-amber-300 dark:border-amber-500/50";
    case "violet": return "border-violet-300 dark:border-violet-500/50";
    default: return "border-slate-300 dark:border-slate-600";
  }
}

function SortableTab({
  tab,
  isActive,
  isHighlighted = false,
  onActivate,
  onRemove,
  onRename,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const [isEditing, setIsEditing] = useState(false);
  const [showTouchTools, setShowTouchTools] = useState(false);
  const [longPressActive, setLongPressActive] = useState(false);
  const [draftName, setDraftName] = useState(tab.name);
  const inputRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const pointerStartRef = useRef(null);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handleTabPointerDown(event) {
    if (isEditing || event.pointerType === "mouse") return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    setLongPressActive(true);
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setLongPressActive(false);
      setShowTouchTools(true);
    }, 500);
  }

  function handleTabPointerMove(event) {
    if (!pointerStartRef.current) return;
    const dx = event.clientX - pointerStartRef.current.x;
    const dy = event.clientY - pointerStartRef.current.y;
    if (dx * dx + dy * dy > 36) {
      clearLongPressTimer();
      setLongPressActive(false);
    }
  }

  function handleTabPointerEnd() {
    clearLongPressTimer();
    setLongPressActive(false);
    pointerStartRef.current = null;
  }

  useEffect(() => {
    if (!isEditing) setDraftName(tab.name);
  }, [tab.name, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isActive) setShowTouchTools(false);
  }, [isActive]);

  useEffect(() => () => clearLongPressTimer(), []);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  function commitRename() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== tab.name) {
      onRename?.(tab.id, trimmed);
    } else {
      setDraftName(tab.name);
    }
    setIsEditing(false);
    setShowTouchTools(false);
  }

  function cancelRename() {
    setDraftName(tab.name);
    setIsEditing(false);
    setShowTouchTools(false);
  }

  const dragProps = isEditing ? {} : { ...attributes, ...listeners };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...dragProps}
      onPointerDown={handleTabPointerDown}
      onPointerMove={handleTabPointerMove}
      onPointerUp={handleTabPointerEnd}
      onPointerCancel={handleTabPointerEnd}
      className={`group inline-flex touch-pan-y select-none items-center gap-1 rounded-md transition ${
        isActive
          ? "bg-slate-950 text-white shadow-sm dark:bg-emerald-400 dark:text-slate-950"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      } ${isHighlighted ? "ring-2 ring-emerald-300 ring-offset-2 ring-offset-white dark:ring-emerald-300 dark:ring-offset-slate-950" : ""} ${
        isEditing ? "cursor-text" : isDragging ? "cursor-grabbing" : "cursor-grab"
      } ${longPressActive ? "ring-2 ring-emerald-200 ring-offset-1 ring-offset-white dark:ring-emerald-500/40 dark:ring-offset-slate-950" : ""
      }`}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelRename();
            }
          }}
          onBlur={commitRename}
          maxLength={60}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className={`mx-1 my-1 h-7 w-28 rounded-md border bg-white px-2 text-sm font-semibold text-[#202020] outline-none focus:ring-2 dark:bg-slate-900 dark:text-slate-50 ${
            isActive
              ? "border-emerald-400 focus:ring-emerald-200 dark:border-emerald-300 dark:focus:ring-emerald-500/30"
              : "border-slate-300 focus:ring-emerald-100 dark:border-slate-700 dark:focus:ring-emerald-500/20"
          }`}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            onActivate(tab.id);
            setShowTouchTools(false);
          }}
          onDoubleClick={() => setIsEditing(true)}
          title="더블클릭하여 이름 변경"
          className="rounded-md px-3 py-2 text-sm font-semibold"
        >
          {tab.name}
        </button>
      )}
      <button
        type="button"
        title={`${tab.name} 이름 변경`}
        aria-label={`${tab.name} 이름 변경`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          setIsEditing(true);
          setShowTouchTools(false);
        }}
        className={`h-6 w-6 items-center justify-center rounded transition md:hidden ${
          showTouchTools ? "inline-flex" : "hidden"
        } ${
          isActive
            ? "text-white/70 hover:bg-white/10 hover:text-white dark:text-slate-950/60 dark:hover:bg-slate-950/10"
            : "text-slate-400 hover:bg-slate-200 hover:text-emerald-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-emerald-300"
        }`}
      >
        <Pencil size={13} />
      </button>
      <button
        type="button"
        title={`${tab.name} 삭제`}
        aria-label={`${tab.name} 삭제`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          setShowTouchTools(false);
          onRemove(tab.id);
        }}
        className={`mr-1 h-6 w-6 items-center justify-center rounded transition focus-visible:inline-flex ${
          showTouchTools ? "inline-flex md:hidden" : "hidden md:group-hover:inline-flex"
        } ${
          isActive
            ? "text-white/70 hover:bg-white/10 hover:text-white dark:text-slate-950/60 dark:hover:bg-slate-950/10"
            : "text-slate-400 hover:bg-slate-200 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-rose-300"
        }`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function IconButton({ title, ariaLabel, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300"
    >
      {children}
    </button>
  );
}

function SettingsMenu({
  theme,
  onSetTheme,
  showHidden,
  onToggleHidden,
  showMotto,
  onToggleMotto,
  showSubBar,
  onToggleSubBar,
  onAddSubscription,
  onAddTab,
  showInProgressSummary,
  onToggleInProgressSummary,
  onLogout,
  currentUser,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const themeOptionClass = (active) =>
    `flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
      active
        ? "bg-slate-950 text-white dark:bg-emerald-400 dark:text-slate-950"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    }`;

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        title="설정"
        ariaLabel="설정"
        onClick={() => setOpen((value) => !value)}
      >
        <Settings size={18} />
      </IconButton>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {currentUser ? (
            <div className="mb-1 rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {currentUser.username}
              </div>
              {currentUser.email ? (
                <div className="text-slate-500 dark:text-slate-400">
                  {currentUser.email}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            테마
          </div>
          <div className="flex gap-1 px-1 pb-2">
            <button
              type="button"
              onClick={() => onSetTheme("light")}
              className={themeOptionClass(theme === "light")}
            >
              <Sun size={14} /> 라이트
            </button>
            <button
              type="button"
              onClick={() => onSetTheme("dark")}
              className={themeOptionClass(theme === "dark")}
            >
              <Moon size={14} /> 다크
            </button>
          </div>
          <div className="md:hidden">
            <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              작업
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAddSubscription?.();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <BellRing size={14} />
              구독 추가
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAddTab?.();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Plus size={14} />
              탭 추가
            </button>
          </div>
          <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            표시
          </div>
          <button
            type="button"
            onClick={onToggleMotto}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span className="inline-flex items-center gap-2">
              <Quote size={14} />
              다짐 한 줄
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {showMotto ? "표시 중" : "숨김"}
            </span>
          </button>
          <button
            type="button"
            onClick={onToggleSubBar}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span className="inline-flex items-center gap-2">
              <BellRing size={14} />
              구독 D-day
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {showSubBar ? "표시 중" : "숨김"}
            </span>
          </button>
          <button
            type="button"
            onClick={onToggleInProgressSummary}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span className="inline-flex items-center gap-2">
              <ListTodo size={14} />
              진행중 요약
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {showInProgressSummary ? "표시 중" : "숨김"}
            </span>
          </button>
          <button
            type="button"
            onClick={onToggleHidden}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span className="inline-flex items-center gap-2">
              {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
              숨김 칸
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {showHidden ? "표시 중" : "숨김"}
            </span>
          </button>
          <hr className="my-1 border-slate-200 dark:border-slate-700" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
          >
            <LogOut size={14} /> 로그아웃
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LoadingShell({ theme, onToggleTheme, children }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8 text-[#202020] transition-colors duration-300 dark:text-slate-50">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-serif text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Pace
          </p>
          <IconButton
            title="테마 전환"
            ariaLabel="테마 전환"
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </IconButton>
        </div>
        <section className="flex min-h-48 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-soft dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          <Loader2 className="mr-2 animate-spin" size={18} />
          {children}
        </section>
      </div>
    </main>
  );
}

function Toast({ toast }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <div
        key={toast?.id || 0}
        className={`max-w-sm truncate rounded-lg bg-slate-900/95 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-200 dark:bg-emerald-500/95 dark:text-slate-950 ${
          toast
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0"
        }`}
      >
        {toast?.message ?? ""}
      </div>
    </div>
  );
}

const authInputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#202020] outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:placeholder:text-slate-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-500/20";

const authPrimaryButtonClass =
  "mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300";

const authErrorBoxClass =
  "mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200";

const authSwitchLinkClass =
  "ml-1 font-semibold text-emerald-600 hover:underline dark:text-emerald-400";

function AuthHeader({ theme, onToggleTheme }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <p className="font-serif text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
        Pace
      </p>
      <IconButton
        title="테마 전환"
        ariaLabel="테마 전환"
        onClick={onToggleTheme}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </IconButton>
    </div>
  );
}

function LoginScreen({
  theme,
  username,
  password,
  error,
  isLoading,
  onToggleTheme,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  onSwitchToSignup,
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8 text-[#202020] transition-colors duration-300 dark:text-slate-50">
      <div className="w-full max-w-md">
        <AuthHeader theme={theme} onToggleTheme={onToggleTheme} />

        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-950"
        >
          <div className="mb-4 flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <LockKeyhole size={18} />
            <h1 className="text-base font-semibold">로그인</h1>
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            사용자명
          </label>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            autoFocus
            className={authInputClass}
          />

          <label className="mb-1 mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            비밀번호
          </label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            className={authInputClass}
          />

          {error ? <p className={authErrorBoxClass}>{error}</p> : null}

          <button
            type="submit"
            disabled={!username.trim() || !password || isLoading}
            className={authPrimaryButtonClass}
          >
            {isLoading ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              "로그인"
            )}
          </button>

          <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
            계정이 없으신가요?
            <button
              type="button"
              onClick={onSwitchToSignup}
              className={authSwitchLinkClass}
            >
              회원가입
            </button>
          </p>
        </form>
      </div>
    </main>
  );
}

function SignupScreen({
  theme,
  form,
  error,
  isLoading,
  onToggleTheme,
  onChange,
  onSubmit,
  onSwitchToLogin,
}) {
  const canSubmit =
    form.username.trim() &&
    form.password &&
    form.passwordConfirm &&
    form.signupCode &&
    !isLoading;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8 text-[#202020] transition-colors duration-300 dark:text-slate-50">
      <div className="w-full max-w-md">
        <AuthHeader theme={theme} onToggleTheme={onToggleTheme} />

        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-950"
        >
          <div className="mb-4 flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <LockKeyhole size={18} />
            <h1 className="text-base font-semibold">회원가입</h1>
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            사용자명 (영문 소문자/숫자/_, 3~30자)
          </label>
          <input
            type="text"
            autoComplete="username"
            value={form.username}
            onChange={(event) => onChange({ username: event.target.value })}
            autoFocus
            className={authInputClass}
          />

          <label className="mb-1 mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            이메일 (선택)
          </label>
          <input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => onChange({ email: event.target.value })}
            className={authInputClass}
          />

          <label className="mb-1 mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            비밀번호 (최소 8자)
          </label>
          <input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => onChange({ password: event.target.value })}
            className={authInputClass}
          />

          <label className="mb-1 mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            비밀번호 확인
          </label>
          <input
            type="password"
            autoComplete="new-password"
            value={form.passwordConfirm}
            onChange={(event) =>
              onChange({ passwordConfirm: event.target.value })
            }
            className={authInputClass}
          />

          <label className="mb-1 mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            가입 코드
          </label>
          <input
            type="text"
            autoComplete="off"
            value={form.signupCode}
            onChange={(event) => onChange({ signupCode: event.target.value })}
            className={authInputClass}
          />

          {error ? <p className={authErrorBoxClass}>{error}</p> : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className={authPrimaryButtonClass}
          >
            {isLoading ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              "가입하기"
            )}
          </button>

          <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
            이미 계정이 있으신가요?
            <button
              type="button"
              onClick={onSwitchToLogin}
              className={authSwitchLinkClass}
            >
              로그인
            </button>
          </p>
        </form>
      </div>
    </main>
  );
}

export default App;
