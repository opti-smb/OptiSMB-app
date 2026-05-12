'use client';
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { mockSavedScenarios } from '@/lib/mockData';
import { generateId } from '@/lib/utils';

const NOTIFICATIONS_CAP = 50;

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

function mergeUserFromApi(apiUser, prev) {
  if (!apiUser || typeof apiUser !== 'object') return prev;
  const biz = apiUser.business || apiUser.name;
  const initialsSrc = biz || apiUser.email || prev.business || 'A';
  const initials = String(initialsSrc)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return {
    ...prev,
    ...apiUser,
    name: biz || prev.name,
    business: biz || prev.business,
    initials,
    roles: Array.isArray(apiUser.roles) ? apiUser.roles : prev.roles || [],
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
        if (s.user) setUser(u => ({ ...defaultUser, ...s.user }));
        if (s.savedScenarios) setSavedScenarios(s.savedScenarios);
        if (s.onboardingDone !== undefined) setOnboardingDone(s.onboardingDone);
        if (s.humanReviewQueue) setHumanReviewQueue(s.humanReviewQueue);
        if (Array.isArray(s.inAppNotifications)) {
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
        if (cancelled || !me.ok) return;
        const j = await me.json();
        if (j.user) setUser((prev) => mergeUserFromApi(j.user, prev));
        setIsAuthenticated(true);
        const st = await fetch('/api/statements', { credentials: 'include' });
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
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem('smb_state', JSON.stringify({
        _v: 3,
        isAuthenticated, user,
        savedScenarios, onboardingDone, humanReviewQueue,
        inAppNotifications,
      }));
    } catch {}
  }, [isAuthenticated, user, savedScenarios, onboardingDone, humanReviewQueue, inAppNotifications, hydrated]);

  const login = async ({ email }) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.user) setUser((prev) => mergeUserFromApi(j.user, prev));
        setIsAuthenticated(true);
        const stRes = await fetch('/api/statements', { credentials: 'include' });
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
        return;
      }
    } catch {
      /* fall through */
    }
    setUser((u) => ({ ...u, email: email || u.email }));
    setIsAuthenticated(true);
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    setIsAuthenticated(false);
    setStatements([]);
    setCurrentStatementId(null);
  };

  const register = async (data) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: data.email,
          businessName: data.business || data.name,
          industry: data.industry,
          country: data.country,
          tier: data.tier || 'L1',
          monthlyVolume: data.monthlyVolume,
        }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.user) {
          setUser((prev) =>
            mergeUserFromApi(
              {
                ...j.user,
                monthlyVolume: data.monthlyVolume ?? j.user.monthlyVolume,
              },
              { ...defaultUser, ...prev },
            ),
          );
        }
        setIsAuthenticated(true);
        setOnboardingDone(false);
        const stRes = await fetch('/api/statements', { credentials: 'include' });
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
        return;
      }
    } catch {
      /* fall through */
    }
    setUser((u) => ({
      ...defaultUser,
      ...u,
      ...data,
      initials: (data.business || data.name || 'HR')
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    }));
    setIsAuthenticated(true);
    setOnboardingDone(false);
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

  /** Same acquirer and billing period as an existing statement. */
  const isDuplicate = (acquirer, period) =>
    statements.some((s) => s.acquirer === acquirer && s.period === period);

  const addStatement = async (stmt) => {
    const tempId = generateId();
    const full = { ...stmt, id: tempId };
    setStatements((prev) => [full, ...prev]);
    setCurrentStatementId(tempId);

    // Route to human review if parsing confidence < 60% (low = simulated <60%)
    if (stmt.parsingConfidence === 'low') {
      const reviewItem = {
        id: 'rev-' + tempId,
        statementId: tempId,
        fileName: stmt.fileName,
        submittedAt: new Date().toISOString(),
        status: 'pending',
        estimatedCompletion: '4 business hours',
      };
      setHumanReviewQueue((prev) => [reviewItem, ...prev]);
    }

    // Simulate email notification
    if (user.notifyParseComplete) {
      simulateEmail('parse_complete', stmt);
    }

    const pushParseInApp = (finalId, savedToServer) => {
      const suffix =
        stmt.parsingConfidence === 'low'
          ? ' — flagged for human review.'
          : '';
      pushNotification({
        kind: 'statement_parse',
        title: savedToServer ? 'Statement saved' : 'Statement added (this device)',
        body: `${stmt.fileName || 'Statement'} · ${stmt.acquirer || 'Acquirer'}${suffix}`,
        href: '/report',
        statementId: finalId,
      });
    };

    try {
      const { id: _omit, ...stmtForApi } = full;
      const res = await fetch('/api/statements', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stmtForApi),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.statement?.id) {
          setStatements((prev) => prev.map((s) => (s.id === tempId ? j.statement : s)));
          setCurrentStatementId(j.statement.id);
          setHumanReviewQueue((prev) =>
            prev.map((r) => (r.statementId === tempId ? { ...r, statementId: j.statement.id } : r)),
          );
          pushParseInApp(j.statement.id, true);
          return j.statement.id;
        }
      }
    } catch {
      /* DATABASE_URL unset or offline */
    }

    pushParseInApp(tempId, false);
    return tempId;
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
    setStatements([]);
    setSavedScenarios([]);
    setHumanReviewQueue([]);
    setInAppNotifications([]);
    setOnboardingDone(false);
    setCurrentStatementId(null);
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
      isDuplicate,
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
