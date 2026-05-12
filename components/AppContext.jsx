'use client';
import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { mockSavedScenarios } from '@/lib/mockData';
import { generateId } from '@/lib/utils';

/** Break shared references before React state / API (avoids the next parse mutating a prior statement). */
function cloneJsonSafe(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

const NOTIFICATIONS_CAP = 50;

/** Statement list must always hit the server (no stale cache after POST). */
const STATEMENTS_FETCH = { credentials: 'include', cache: 'no-store' };

/** Per-account notification store (survives logout on this browser). */
const NOTIFICATIONS_LS_PREFIX = 'optismb_in_app_notifications:';

/** @param {string | null} serverUserId @param {string | null} demoIdentityEmail normalized */
function notificationsStorageKey(serverUserId, demoIdentityEmail) {
  if (serverUserId) return `${NOTIFICATIONS_LS_PREFIX}u:${serverUserId}`;
  if (demoIdentityEmail) return `${NOTIFICATIONS_LS_PREFIX}demo:${demoIdentityEmail}`;
  return null;
}

/** @param {string | null} raw */
function parseNotificationsJson(raw) {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a.filter((n) => n && typeof n === 'object' && n.id && n.title);
  } catch {
    return [];
  }
}

/** @param {string | null} key @param {unknown[]} list */
function writeNotificationsToStorage(key, list) {
  if (!key || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, NOTIFICATIONS_CAP)));
  } catch {
    /* ignore */
  }
}

/** @param {string | null} serverUserId @param {string | null} demoIdentityEmail */
function readPersistedNotifications(serverUserId, demoIdentityEmail) {
  const key = notificationsStorageKey(serverUserId, demoIdentityEmail);
  if (!key) return [];
  return parseNotificationsJson(localStorage.getItem(key));
}

function newNotificationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const AppContext = createContext(null);

const defaultUser = {
  name: 'Horizon Retail Inc',
  initials: 'HR',
  email: 'owner@horizonretail.com',
  tier: 'L1',
  business: 'Horizon Retail Inc',
  industry: 'Fashion & apparel',
  country: 'United States',
  monthlyVolume: '$50k – $250k',
  billingDate: '12 May 2026',
  card: '',
  notifyParseComplete: true,
  notifyReportReady: true,
  t3DataConsent: false,
  roles: [],
};

/**
 * Merge server profile into client user. Identity always comes from `apiUser` so a new login
 * cannot keep another user's name/business from `localStorage`.
 * @param {Record<string, unknown>} apiUser
 * @param {Record<string, unknown>|null|undefined} prev
 */
function mergeUserFromApi(apiUser, prev) {
  if (!apiUser || typeof apiUser !== 'object') return prev;
  const email = String(apiUser.email || '').trim();
  const biz = String(apiUser.business || apiUser.name || '').trim();
  const displayName = biz || email || 'Account';
  const initialsSrc = displayName || 'A';
  const initials = String(initialsSrc)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return {
    ...defaultUser,
    ...(prev && typeof prev === 'object' ? prev : {}),
    ...apiUser,
    email,
    name: displayName,
    business: biz,
    monthlyVolume:
      apiUser.monthlyVolume != null && apiUser.monthlyVolume !== ''
        ? apiUser.monthlyVolume
        : prev?.monthlyVolume ?? defaultUser.monthlyVolume,
    roles: Array.isArray(apiUser.roles) ? apiUser.roles : [],
    initials,
  };
}

export function AppProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(defaultUser);
  const [statements, setStatements] = useState([]);
  const [currentStatementId, setCurrentStatementId] = useState(null);
  const [savedScenarios, setSavedScenarios] = useState(mockSavedScenarios);
  const [hydrated, setHydrated] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [humanReviewQueue, setHumanReviewQueue] = useState([]);
  const [inAppNotifications, setInAppNotifications] = useState([]);
  const inAppNotificationsRef = useRef([]);
  /** DB session user id; null in demo (no DATABASE_URL) or signed out */
  const [serverUserId, setServerUserId] = useState(null);
  /** Normalized email for local-only demo identity */
  const [demoIdentityEmail, setDemoIdentityEmail] = useState(null);
  const serverUserIdRef = useRef(null);
  const demoEmailRef = useRef(null);

  useEffect(() => {
    serverUserIdRef.current = serverUserId;
  }, [serverUserId]);
  useEffect(() => {
    demoEmailRef.current = demoIdentityEmail;
  }, [demoIdentityEmail]);

  useEffect(() => {
    inAppNotificationsRef.current = inAppNotifications;
  }, [inAppNotifications]);

  const currentStatementIdRef = useRef(null);
  useEffect(() => {
    currentStatementIdRef.current = currentStatementId;
  }, [currentStatementId]);

  /** Scenarios / review queue / onboarding — not tied to notification persistence */
  const clearEphemeralClientState = useCallback(() => {
    setHumanReviewQueue([]);
    setSavedScenarios([]);
    setOnboardingDone(false);
  }, []);

  /** Clear notifications / scenarios when switching server user, demo user, or demo↔server */
  const wipeIfSwitchingAccount = useCallback((nextServerUserId, nextDemoEmailNorm) => {
    let wipe = false;
    if (nextServerUserId) {
      if (demoEmailRef.current) wipe = true;
      if (serverUserIdRef.current && serverUserIdRef.current !== nextServerUserId) wipe = true;
    } else if (nextDemoEmailNorm) {
      if (demoEmailRef.current && demoEmailRef.current !== nextDemoEmailNorm) wipe = true;
      if (serverUserIdRef.current) wipe = true;
    }
    if (wipe) {
      clearEphemeralClientState();
      setInAppNotifications([]);
    }
  }, [clearEphemeralClientState]);

  const pushNotification = useCallback((item) => {
    const row = {
      id: newNotificationId(),
      read: false,
      createdAt: new Date().toISOString(),
      kind: item.kind || 'info',
      title: String(item.title || 'Update'),
      body: item.body != null ? String(item.body) : '',
      href: item.href || null,
      statementId: item.statementId != null ? String(item.statementId) : null,
    };
    setInAppNotifications((prev) => [row, ...prev].slice(0, NOTIFICATIONS_CAP));
  }, []);

  const markNotificationRead = useCallback((id) => {
    setInAppNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setInAppNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismissNotification = useCallback((id) => {
    setInAppNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const unreadNotificationCount = useMemo(
    () => inAppNotifications.filter((n) => !n.read).length,
    [inAppNotifications],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem('smb_state');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.isAuthenticated !== undefined) setIsAuthenticated(s.isAuthenticated);
        if (s.user) setUser((u) => ({ ...defaultUser, ...s.user }));
        if (s.savedScenarios) setSavedScenarios(s.savedScenarios);
        if (s.onboardingDone !== undefined) setOnboardingDone(s.onboardingDone);
        if (s.humanReviewQueue) setHumanReviewQueue(s.humanReviewQueue);
        if (typeof s.serverUserId === 'string' && s.serverUserId) setServerUserId(s.serverUserId);
        if (typeof s.demoIdentityEmail === 'string' && s.demoIdentityEmail)
          setDemoIdentityEmail(s.demoIdentityEmail);
        const sid = typeof s.serverUserId === 'string' && s.serverUserId ? s.serverUserId : null;
        const demo = typeof s.demoIdentityEmail === 'string' && s.demoIdentityEmail ? s.demoIdentityEmail : null;
        const nk = notificationsStorageKey(sid, demo);
        if (nk) {
          const fromKey = readPersistedNotifications(sid, demo);
          if (fromKey.length) {
            setInAppNotifications(fromKey);
          } else if (Array.isArray(s.inAppNotifications)) {
            const legacy = s.inAppNotifications.filter(
              (n) => n && typeof n === 'object' && n.id && n.title,
            );
            if (legacy.length) {
              setInAppNotifications(legacy);
              writeNotificationsToStorage(nk, legacy);
            }
          }
        } else if (Array.isArray(s.inAppNotifications)) {
          setInAppNotifications(
            s.inAppNotifications.filter(
              (n) => n && typeof n === 'object' && n.id && n.title,
            ),
          );
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await fetch('/api/auth/me', { credentials: 'include' });
        if (cancelled) return;
        if (!me.ok) {
          // 503 = no DATABASE_URL — keep local demo session from localStorage.
          // 401 = DB configured but no valid session cookie — do not stay "logged in" from stale localStorage.
          if (me.status === 401) {
            setIsAuthenticated(false);
            setStatements([]);
            setCurrentStatementId(null);
            setServerUserId(null);
            setDemoIdentityEmail(null);
            setUser(defaultUser);
            clearEphemeralClientState();
            setInAppNotifications([]);
            try {
              localStorage.removeItem('smb_state');
            } catch {
              /* ignore */
            }
          }
          return;
        }
        const j = await me.json();
        const prevSid = serverUserIdRef.current;
        const sameSession = !!(prevSid && j.userId && prevSid === j.userId);
        wipeIfSwitchingAccount(j.userId, null);
        setServerUserId(j.userId);
        setDemoIdentityEmail(null);
        setInAppNotifications(readPersistedNotifications(j.userId, null));
        if (j.user) setUser((prev) => mergeUserFromApi(j.user, sameSession ? prev : defaultUser));
        setIsAuthenticated(true);
        const st = await fetch('/api/statements', STATEMENTS_FETCH);
        if (cancelled) return;
        if (!st.ok) {
          setStatements([]);
          setCurrentStatementId(null);
          return;
        }
        const sj = await st.json();
        if (Array.isArray(sj.statements)) {
          setStatements(sj.statements);
          setCurrentStatementId((cur) =>
            sj.statements.length === 0
              ? null
              : sj.statements.some((s) => s.id === cur)
                ? cur
                : sj.statements[0].id,
          );
        }
      } catch {
        /* offline or DATABASE_URL unset */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, wipeIfSwitchingAccount, clearEphemeralClientState]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem('smb_state', JSON.stringify({
        _v: 4,
        isAuthenticated,
        user,
        savedScenarios,
        onboardingDone,
        humanReviewQueue,
        serverUserId: isAuthenticated && serverUserId ? serverUserId : null,
        demoIdentityEmail: isAuthenticated && demoIdentityEmail ? demoIdentityEmail : null,
      }));
    } catch {}
  }, [isAuthenticated, user, savedScenarios, onboardingDone, humanReviewQueue, serverUserId, demoIdentityEmail, hydrated]);

  /** Persist in-app notifications per account (not inside smb_state — survives logout). */
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    const key = notificationsStorageKey(serverUserId, demoIdentityEmail);
    if (!key) return;
    writeNotificationsToStorage(key, inAppNotifications);
  }, [inAppNotifications, serverUserId, demoIdentityEmail, isAuthenticated, hydrated]);

  /**
   * @returns {Promise<{ ok: boolean; demo?: boolean; message?: string; error?: string }>}
   * `demo: true` only when the server has no DATABASE_URL (local-only mode).
   */
  const login = async ({ email }) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ intent: 'login', email }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const prevSid = serverUserIdRef.current;
        const sameSession = !!(prevSid && body.userId && prevSid === body.userId);
        wipeIfSwitchingAccount(body.userId, null);
        setServerUserId(body.userId);
        setDemoIdentityEmail(null);
        setInAppNotifications(readPersistedNotifications(body.userId, null));
        if (body.user) setUser((prev) => mergeUserFromApi(body.user, sameSession ? prev : defaultUser));
        setIsAuthenticated(true);
        const stRes = await fetch('/api/statements', STATEMENTS_FETCH);
        if (stRes.ok) {
          const sj = await stRes.json();
          if (Array.isArray(sj.statements)) {
            setStatements(sj.statements);
            setCurrentStatementId(sj.statements[0]?.id ?? null);
          }
        } else {
          setStatements([]);
          setCurrentStatementId(null);
        }
        return { ok: true, demo: false };
      }
      if (body.error === 'no_account') {
        return {
          ok: false,
          error: 'no_account',
          message:
            body.message ||
            "We don't have an account for this email yet. Create one on the Register page, then sign in here.",
        };
      }
      if (body.error === 'database_not_configured') {
        const norm = String(email).trim().toLowerCase();
        wipeIfSwitchingAccount(null, norm);
        setServerUserId(null);
        setDemoIdentityEmail(norm);
        const em = String(email).trim();
        setUser({
          ...defaultUser,
          email: em,
          name: em,
          business: '',
          initials: em
            .split('@')[0]
            .split(/[\s._-]+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join('')
            .slice(0, 2) || 'ME',
        });
        setIsAuthenticated(true);
        setInAppNotifications(readPersistedNotifications(null, norm));
        return { ok: true, demo: true };
      }
      return {
        ok: false,
        error: typeof body.error === 'string' ? body.error : undefined,
        message:
          body.message ||
          (typeof body.error === 'string' ? String(body.error).replace(/_/g, ' ') : '') ||
          `Sign in failed (${res.status})`,
      };
    } catch {
      return { ok: false, message: 'Network error' };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    try {
      const key = notificationsStorageKey(serverUserId, demoIdentityEmail);
      if (key) writeNotificationsToStorage(key, inAppNotificationsRef.current);
    } catch {
      /* ignore */
    }
    setIsAuthenticated(false);
    setStatements([]);
    setCurrentStatementId(null);
    setServerUserId(null);
    setDemoIdentityEmail(null);
    setUser(defaultUser);
    setInAppNotifications([]);
    clearEphemeralClientState();
    try {
      localStorage.removeItem('smb_state');
    } catch {
      /* ignore */
    }
  };

  /**
   * @returns {Promise<{ ok: boolean; demo?: boolean; message?: string; error?: string }>}
   */
  const register = async (data) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          intent: 'register',
          email: data.email,
          businessName: data.business || data.name,
          industry: data.industry,
          country: data.country,
          tier: data.tier || 'L1',
          monthlyVolume: data.monthlyVolume,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const prevSid = serverUserIdRef.current;
        const sameSession = !!(prevSid && body.userId && prevSid === body.userId);
        wipeIfSwitchingAccount(body.userId, null);
        setServerUserId(body.userId);
        setDemoIdentityEmail(null);
        setInAppNotifications(readPersistedNotifications(body.userId, null));
        if (body.user) {
          setUser((prev) =>
            mergeUserFromApi(
              {
                ...body.user,
                monthlyVolume: data.monthlyVolume ?? body.user.monthlyVolume,
              },
              sameSession ? prev : defaultUser,
            ),
          );
        }
        setIsAuthenticated(true);
        setOnboardingDone(false);
        const stRes = await fetch('/api/statements', STATEMENTS_FETCH);
        if (stRes.ok) {
          const sj = await stRes.json();
          if (Array.isArray(sj.statements)) {
            setStatements(sj.statements);
            setCurrentStatementId(sj.statements[0]?.id ?? null);
          }
        } else {
          setStatements([]);
          setCurrentStatementId(null);
        }
        return { ok: true, demo: false };
      }
      if (body.error === 'email_already_registered' || res.status === 409) {
        return {
          ok: false,
          error: 'email_already_registered',
          message:
            body.message ||
            'This email is already registered. Use Sign in with the same address instead of creating another account.',
        };
      }
      if (body.error === 'database_not_configured') {
        const norm = String(data.email || '').trim().toLowerCase();
        wipeIfSwitchingAccount(null, norm);
        setServerUserId(null);
        setDemoIdentityEmail(norm);
        setUser({
          ...defaultUser,
          email: data.email,
          name: String(data.business || data.name || data.email || '').trim() || String(data.email),
          business: String(data.business || data.name || '').trim(),
          industry: data.industry,
          country: data.country,
          monthlyVolume: data.monthlyVolume,
          tier: data.tier || 'L1',
          initials: (data.business || data.name || 'HR')
            .split(' ')
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase(),
        });
        setIsAuthenticated(true);
        setOnboardingDone(false);
        setInAppNotifications(readPersistedNotifications(null, norm));
        return { ok: true, demo: true };
      }
      return {
        ok: false,
        error: typeof body.error === 'string' ? body.error : undefined,
        message:
          body.message ||
          (typeof body.error === 'string' ? String(body.error).replace(/_/g, ' ') : '') ||
          `Registration failed (${res.status})`,
      };
    } catch {
      return { ok: false, message: 'Network error' };
    }
  };

  const updateUser = (data) => {
    setUser(u => ({
      ...u, ...data,
      initials: (data.business || data.name || user.business || 'HR').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
    }));
  };

  const updateTier = (tier) => setUser(u => ({ ...u, tier }));
  const completeOnboarding = () => setOnboardingDone(true);

  const getCurrentStatement = () =>
    statements.find(s => s.id === currentStatementId) || statements[0];

  /**
   * @returns {Promise<{ id: string; savedToServer: boolean; duplicate?: boolean; message?: string }>}
   */
  const addStatement = async (stmt) => {
    const idBeforeOptimistic = currentStatementIdRef.current;
    const base = cloneJsonSafe(stmt);
    const stmtSnap = base && typeof base === 'object' ? base : stmt;
    const tempId = generateId();
    const full = { ...stmtSnap, id: tempId };

    const revertOptimistic = () => {
      setStatements((prev) => prev.filter((s) => s.id !== tempId));
      setHumanReviewQueue((prev) => prev.filter((r) => r.statementId !== tempId));
      setCurrentStatementId((cur) => {
        if (cur !== tempId) return cur;
        return idBeforeOptimistic != null && idBeforeOptimistic !== tempId ? idBeforeOptimistic : null;
      });
    };

    setStatements((prev) => [full, ...prev]);
    setCurrentStatementId(tempId);

    // Route to human review if parsing confidence < 60% (low = simulated <60%)
    if (stmtSnap.parsingConfidence === 'low') {
      const reviewItem = {
        id: 'rev-' + tempId,
        statementId: tempId,
        fileName: stmtSnap.fileName,
        submittedAt: new Date().toISOString(),
        status: 'pending',
        estimatedCompletion: '4 business hours',
      };
      setHumanReviewQueue((prev) => [reviewItem, ...prev]);
    }

    // Simulate email notification
    if (user.notifyParseComplete) {
      simulateEmail('parse_complete', stmtSnap);
    }

    const pushParseInApp = (finalId, savedToServer) => {
      const suffix =
        stmtSnap.parsingConfidence === 'low'
          ? ' — flagged for human review.'
          : '';
      pushNotification({
        kind: 'statement_parse',
        title: savedToServer ? 'Statement saved' : 'Statement added (this device)',
        body: `${stmtSnap.fileName || 'Statement'} · ${stmtSnap.acquirer || 'Acquirer'}${suffix}`,
        href: '/report',
        statementId: finalId,
      });
    };

    try {
      const { id: _omit, ...stmtForApi } = full;
      const res = await fetch('/api/statements', {
        method: 'POST',
        ...STATEMENTS_FETCH,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stmtForApi),
      });
      if (res.ok) {
        const j = await res.json();
        if (!j.statement?.id) {
          revertOptimistic();
          pushParseInApp(tempId, false);
          return {
            id: tempId,
            savedToServer: false,
            message: 'Server did not return a saved statement id.',
          };
        }
        const savedId = j.statement.id;
        const isDup = !!j.duplicate;

        setHumanReviewQueue((prev) =>
          isDup
            ? prev.filter((r) => r.statementId !== tempId)
            : prev.map((r) => (r.statementId === tempId ? { ...r, statementId: savedId } : r)),
        );

        let serverList = null;
        try {
          const st = await fetch('/api/statements', STATEMENTS_FETCH);
          if (st.ok) {
            const sj = await st.json();
            if (Array.isArray(sj.statements)) serverList = sj.statements;
          }
        } catch {
          /* use merge fallback */
        }
        if (serverList?.length) {
          setStatements(serverList);
        } else {
          setStatements((prev) => {
            const withoutTemp = prev.filter((s) => s.id !== tempId);
            if (withoutTemp.some((s) => s && s.id === savedId)) return withoutTemp;
            return [j.statement, ...withoutTemp];
          });
        }
        setCurrentStatementId(savedId);
        if (!isDup) {
          pushParseInApp(savedId, true);
        }
        return { id: savedId, savedToServer: true, duplicate: isDup };
      }
      let msg;
      try {
        const errBody = await res.json();
        msg = errBody.message || errBody.error;
      } catch {
        /* ignore */
      }
      revertOptimistic();
      pushParseInApp(tempId, false);
      return {
        id: tempId,
        savedToServer: false,
        message:
          msg ||
          (res.status === 401
            ? 'Not signed in — sign in again so statements save to your account.'
            : `Save failed (${res.status}).`),
      };
    } catch {
      revertOptimistic();
      return {
        id: tempId,
        savedToServer: false,
        message: 'Could not reach the server to save this statement.',
      };
    }
  };

  const simulateEmail = (type, data) => {
    // In production this calls a real email service (SendGrid/Resend)
    // For now this is a no-op simulation — toasts handle user feedback
    if (process.env.NODE_ENV === 'development') {
      console.log('[Email simulation]', type, data?.fileName || '');
    }
  };

  const updateStatement = (id, data) => {
    setStatements(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
  };

  const deleteStatement = async (id) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id));
    if (isUuid) {
      try {
        await fetch(`/api/statements/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      } catch {
        /* ignore */
      }
    }
    setStatements((prev) => {
      const next = prev.filter((s) => s.id !== id);
      setCurrentStatementId((cur) => {
        if (cur !== id) return cur;
        return next[0]?.id || null;
      });
      return next;
    });
    setHumanReviewQueue((prev) => prev.filter((r) => r.statementId !== id));
    setInAppNotifications((prev) => prev.filter((n) => n.statementId !== id));
  };

  const saveScenario = (scenario) => {
    const id = Date.now();
    setSavedScenarios(prev => [
      { ...scenario, id, date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) },
      ...prev,
    ]);
  };

  const deleteScenario = (id) => {
    setSavedScenarios(prev => prev.filter(s => s.id !== id));
  };

  const exportUserData = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      user: { ...user, card: '[REDACTED]' },
      statements: statements.map(s => ({
        id: s.id, fileName: s.fileName, acquirer: s.acquirer,
        period: s.period, uploadDate: s.uploadDate, status: s.status,
        effectiveRate: s.parsedData?.effective_rate,
      })),
      savedScenarios,
    };
    return data;
  };

  const deleteAccount = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    const uid = serverUserId;
    const demo = demoIdentityEmail;
    try {
      const nkey = notificationsStorageKey(uid, demo);
      if (nkey) localStorage.removeItem(nkey);
    } catch {
      /* ignore */
    }
    setStatements([]);
    setCurrentStatementId(null);
    setServerUserId(null);
    setDemoIdentityEmail(null);
    clearEphemeralClientState();
    setInAppNotifications([]);
    setIsAuthenticated(false);
    setUser(defaultUser);
    try {
      localStorage.removeItem('smb_state');
    } catch {
      /* ignore */
    }
  };

  return (
    <AppContext.Provider value={{
      isAuthenticated, user, statements, currentStatementId,
      savedScenarios, hydrated,
      onboardingDone, humanReviewQueue,
      inAppNotifications, unreadNotificationCount,
      pushNotification, markNotificationRead, markAllNotificationsRead, dismissNotification,
      login, logout, register, updateUser, updateTier,
      completeOnboarding,
      getCurrentStatement, addStatement, updateStatement, deleteStatement,
      setCurrentStatementId,
      saveScenario, deleteScenario,
      exportUserData,
      deleteAccount,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
