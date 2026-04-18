'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { mockStatements, mockNotifications, mockSavedScenarios, mockMerchantAgreements } from '@/lib/mockData';
import { generateId } from '@/lib/utils';

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
  card: 'VISA •••• 4210',
  notifyParseComplete: true,
  notifyReportReady: true,
  notifyStaleness: true,
  t3DataConsent: false,
};

export function AppProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(defaultUser);
  const [statements, setStatements] = useState(mockStatements);
  const [currentStatementId, setCurrentStatementId] = useState(mockStatements[0]?.id);
  const [notifications, setNotifications] = useState(mockNotifications);
  const [savedScenarios, setSavedScenarios] = useState(mockSavedScenarios);
  const [merchantAgreements, setMerchantAgreements] = useState(mockMerchantAgreements);
  const [hydrated, setHydrated] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [humanReviewQueue, setHumanReviewQueue] = useState([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('smb_state');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.isAuthenticated !== undefined) setIsAuthenticated(s.isAuthenticated);
        if (s.user) setUser(u => ({ ...defaultUser, ...s.user }));
        if (s.statements?.length) setStatements(s.statements);
        if (s.currentStatementId) setCurrentStatementId(s.currentStatementId);
        if (s.notifications?.length) setNotifications(s.notifications);
        if (s.savedScenarios) setSavedScenarios(s.savedScenarios);
        if (s.merchantAgreements) setMerchantAgreements(s.merchantAgreements);
        if (s.onboardingDone !== undefined) setOnboardingDone(s.onboardingDone);
        if (s.humanReviewQueue) setHumanReviewQueue(s.humanReviewQueue);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem('smb_state', JSON.stringify({
        isAuthenticated, user, statements, currentStatementId,
        notifications, savedScenarios, merchantAgreements, onboardingDone, humanReviewQueue,
      }));
    } catch {}
  }, [isAuthenticated, user, statements, currentStatementId, notifications, savedScenarios, merchantAgreements, onboardingDone, humanReviewQueue, hydrated]);

  const login = ({ email }) => {
    setUser(u => ({ ...u, email: email || u.email }));
    setIsAuthenticated(true);
  };

  const logout = () => {
    setIsAuthenticated(false);
  };

  const register = (data) => {
    setUser(u => ({
      ...defaultUser,
      ...u,
      ...data,
      initials: (data.business || data.name || 'HR').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
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

  // Staleness check: returns amber (90d) or red (180d) for a statement's benchmark data
  const checkStaleness = (stmt) => {
    if (!stmt?.dataAsOf) return null;
    const asOf = new Date(stmt.dataAsOf);
    const now = new Date();
    const daysOld = Math.floor((now - asOf) / (1000 * 60 * 60 * 24));
    if (daysOld >= 180) return { level: 'red', daysOld };
    if (daysOld >= 90) return { level: 'amber', daysOld };
    return null;
  };

  // Duplicate detection: returns true if a statement with same acquirer + period exists
  const isDuplicate = (acquirer, period) =>
    statements.some(s => s.acquirer === acquirer && s.period === period);

  const addStatement = (stmt) => {
    const id = generateId();
    const full = { ...stmt, id };
    setStatements(prev => [full, ...prev]);
    setCurrentStatementId(id);

    // Route to human review if parsing confidence < 60% (low = simulated <60%)
    if (stmt.parsingConfidence === 'low') {
      const reviewItem = {
        id: 'rev-' + id,
        statementId: id,
        fileName: stmt.fileName,
        submittedAt: new Date().toISOString(),
        status: 'pending',
        estimatedCompletion: '4 business hours',
      };
      setHumanReviewQueue(prev => [reviewItem, ...prev]);
    }

    // Simulate email notification
    if (user.notifyParseComplete) {
      simulateEmail('parse_complete', stmt);
    }

    addNotification({
      type: 'parse_complete',
      title: `Parsing complete — ${stmt.acquirer} ${stmt.period}`,
      message: `${stmt.fileName} parsed successfully. Effective rate ${stmt.parsedData?.effective_rate?.toFixed(2) ?? '—'}%.`,
      date: new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
      emailSent: user.notifyParseComplete,
    });

    if (user.notifyReportReady) {
      setTimeout(() => {
        addNotification({
          type: 'report_ready',
          title: `Report ready — ${stmt.acquirer} ${stmt.period}`,
          message: `Full analysis available. ${stmt.discrepancies?.length || 0} discrepancies detected.`,
          date: new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
          emailSent: true,
        });
      }, 800);
    }

    return id;
  };

  const simulateEmail = (type, data) => {
    // In production this calls a real email service (SendGrid/Resend)
    // For now this is a no-op simulation — toasts handle user feedback
    console.log('[Email simulation]', type, data?.fileName || '');
  };

  const updateStatement = (id, data) => {
    setStatements(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
  };

  const deleteStatement = (id) => {
    setStatements(prev => prev.filter(s => s.id !== id));
    if (currentStatementId === id) {
      const remaining = statements.filter(s => s.id !== id);
      setCurrentStatementId(remaining[0]?.id || null);
    }
    setHumanReviewQueue(prev => prev.filter(r => r.statementId !== id));
  };

  const addNotification = (notif) => {
    setNotifications(prev => [{ ...notif, id: Date.now(), read: false }, ...prev]);
  };

  const markNotificationRead = (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const dismissNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
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

  // Merchant agreement — version controlled
  const addMerchantAgreement = (data) => {
    const id = 'agr-' + generateId();
    const version = `v${merchantAgreements.length + 1}.0`;
    const newAgr = { ...data, id, version, status: 'Active' };
    setMerchantAgreements(prev => {
      const updated = prev.map(a => ({ ...a, status: 'Superseded' }));
      return [newAgr, ...updated];
    });
    addNotification({
      type: 'agreement_uploaded',
      title: 'Merchant agreement uploaded',
      message: `${data.fileName} (${version}) linked to your account. Discrepancy checking now enabled.`,
      date: new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
      emailSent: false,
    });
    return id;
  };

  const deleteAgreement = (id) => {
    setMerchantAgreements(prev => prev.filter(a => a.id !== id));
  };

  const getActiveAgreement = () => merchantAgreements.find(a => a.status === 'Active') || null;

  const exportUserData = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      user: { ...user, card: '[REDACTED]' },
      statements: statements.map(s => ({
        id: s.id, fileName: s.fileName, acquirer: s.acquirer,
        period: s.period, uploadDate: s.uploadDate, status: s.status,
        effectiveRate: s.parsedData?.effective_rate,
      })),
      merchantAgreements: merchantAgreements.map(a => ({
        id: a.id, fileName: a.fileName, version: a.version, uploadDate: a.uploadDate,
      })),
      savedScenarios,
    };
    return data;
  };

  const deleteAccount = () => {
    setStatements([]);
    setNotifications([]);
    setSavedScenarios([]);
    setMerchantAgreements([]);
    setHumanReviewQueue([]);
    setOnboardingDone(false);
    setIsAuthenticated(false);
    setUser(defaultUser);
    try { localStorage.removeItem('smb_state'); } catch {}
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const activeAgreement = getActiveAgreement();

  return (
    <AppContext.Provider value={{
      isAuthenticated, user, statements, currentStatementId, notifications,
      savedScenarios, merchantAgreements, activeAgreement, unreadCount, hydrated,
      onboardingDone, humanReviewQueue,
      login, logout, register, updateUser, updateTier,
      completeOnboarding,
      getCurrentStatement, addStatement, updateStatement, deleteStatement,
      setCurrentStatementId,
      addNotification, markNotificationRead, markAllRead, dismissNotification,
      saveScenario, deleteScenario,
      addMerchantAgreement, deleteAgreement, getActiveAgreement,
      checkStaleness, isDuplicate,
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
