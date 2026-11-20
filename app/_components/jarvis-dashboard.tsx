"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileText,
  Inbox,
  Mail,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

type Section = "overview" | "inbox" | "expenses" | "settings";
type ExpenseStorage = "loading" | "local" | "cloud";
type MailMonitorPreference = { enabled: boolean; query: string; ready: boolean; gmailAuthorized: boolean };
type Expense = {
  id: string;
  merchant: string;
  category: string;
  amount: number;
  date: string;
};

const STORAGE_KEY = "jarvis.expenses.v1";
const DEFAULT_MAIL_QUERY = "in:inbox is:unread newer_than:2h";
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const sampleExpenses: Expense[] = [
  { id: "sample-1", merchant: "Blue Tokai Coffee", category: "Food & drink", amount: 485, date: dateOffset(0) },
  { id: "sample-2", merchant: "Uber India", category: "Transport", amount: 640, date: dateOffset(1) },
  { id: "sample-3", merchant: "FreshCart Market", category: "Groceries", amount: 2_340, date: dateOffset(2) },
  { id: "sample-4", merchant: "Airtel", category: "Bills", amount: 999, date: dateOffset(4) },
];

const sampleEmails = [
  {
    id: "mail-1",
    sender: "Northstar Design",
    initials: "ND",
    color: "violet",
    subject: "Updated proposal — approval requested",
    preview: "The revised proposal is ready. Could you take a look before Friday?",
    time: "10:42 AM",
    tag: "Needs a reply",
  },
  {
    id: "mail-2",
    sender: "Cityline Travel",
    initials: "CT",
    color: "blue",
    subject: "Your itinerary is ready",
    preview: "Your booking details and check-in window are now available.",
    time: "9:18 AM",
    tag: "Time sensitive",
  },
  {
    id: "mail-3",
    sender: "Monthly statement",
    initials: "MS",
    color: "green",
    subject: "Your October account statement",
    preview: "Your latest statement is ready to view in your account.",
    time: "Yesterday",
    tag: "For your records",
  },
];

const navItems: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "inbox", label: "Priority inbox", icon: Inbox },
  { id: "expenses", label: "Expenses", icon: Wallet },
];

export function JarvisDashboard() {
  const [section, setSection] = useState<Section>("overview");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);
  const [expenseStorage, setExpenseStorage] = useState<ExpenseStorage>("loading");
  const [savingExpense, setSavingExpense] = useState(false);
  const [mailMonitor, setMailMonitor] = useState<MailMonitorPreference>({ enabled: false, query: DEFAULT_MAIL_QUERY, ready: false, gmailAuthorized: false });
  const [monitorSaving, setMonitorSaving] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [connection, setConnection] = useState<"gmail" | "whatsapp" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadExpenses() {
      try {
        const response = await fetch("/api/expenses", { cache: "no-store" });
        if (response.ok) {
          const result: unknown = await response.json();
          if (
            typeof result === "object" && result !== null &&
            "expenses" in result && Array.isArray(result.expenses)
          ) {
            if (!cancelled) {
              setExpenses(result.expenses as Expense[]);
              setExpenseStorage("cloud");
              setReady(true);
            }
            return;
          }
        }
      } catch {
        // Fall back to this browser if the private database is not configured yet.
      }

      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            if (!cancelled) setExpenses(parsed as Expense[]);
          }
        }
      } catch {
        if (!cancelled) setNotice("I couldn’t read saved expenses in this browser.");
      }

      if (!cancelled) {
        setExpenseStorage("local");
        setReady(true);
      }
    }

    void loadExpenses();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/mail-monitor", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const result: unknown = await response.json();
        if (typeof result !== "object" || result === null) return;
        const value = result as Partial<MailMonitorPreference>;
        if (
          typeof value.enabled === "boolean" &&
          typeof value.query === "string" &&
          typeof value.ready === "boolean" &&
          typeof value.gmailAuthorized === "boolean" &&
          !cancelled
        ) setMailMonitor({ enabled: value.enabled, query: value.query, ready: value.ready, gmailAuthorized: value.gmailAuthorized });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ready && expenseStorage === "local") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
    }
  }, [expenses, expenseStorage, ready]);

  const allExpenses = useMemo(
    () => expenseStorage === "cloud" ? expenses : [...expenses, ...sampleExpenses],
    [expenseStorage, expenses],
  );
  const monthPrefix = currentMonth();
  const monthlyExpenses = allExpenses.filter((expense) => expense.date.startsWith(monthPrefix));
  const monthlyTotal = monthlyExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const greeting = getGreeting();

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const merchant = String(form.get("merchant") ?? "").trim();
    const category = String(form.get("category") ?? "Other");
    const date = String(form.get("date") ?? new Date().toISOString().slice(0, 10));
    if (!merchant || !Number.isFinite(amount) || amount <= 0) return;

    const expense = { id: crypto.randomUUID(), merchant, category, amount, date };
    setSavingExpense(true);
    if (expenseStorage === "cloud") {
      try {
        const response = await fetch("/api/expenses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ merchant, category, amount, date }),
        });
        if (!response.ok) throw new Error("Cloud save failed.");
        const result = await response.json() as { expense: Expense };
        setExpenses((current) => [result.expense, ...current]);
        setNotice("Expense saved to your private workspace.");
      } catch {
        setNotice("I couldn’t sync that expense. Please try again.");
        setSavingExpense(false);
        return;
      }
    } else {
      setExpenses((current) => [expense, ...current]);
      setNotice("Expense added to this browser.");
    }

    setSavingExpense(false);
    setShowExpenseForm(false);
    window.setTimeout(() => setNotice(null), 2800);
  }

  async function removeExpense(id: string) {
    if (expenseStorage === "cloud") {
      try {
        const response = await fetch(`/api/expenses?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Cloud delete failed.");
      } catch {
        setNotice("I couldn’t sync that removal. Please try again.");
        window.setTimeout(() => setNotice(null), 2800);
        return;
      }
    }
    setExpenses((current) => current.filter((expense) => expense.id !== id));
    setNotice(expenseStorage === "cloud" ? "Expense removed from your private workspace." : "Expense removed from this browser.");
    window.setTimeout(() => setNotice(null), 2800);
  }

  async function saveMailMonitor(enabled: boolean, query: string) {
    if (enabled && !mailMonitor.ready) {
      setNotice("Finish Gmail consent, database, and WhatsApp setup before enabling mail alerts.");
      window.setTimeout(() => setNotice(null), 3200);
      return;
    }
    setMonitorSaving(true);
    try {
      const response = await fetch("/api/mail-monitor", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, query }),
      });
      const result = await response.json() as { error?: string; enabled?: boolean; query?: string; ready?: boolean; gmailAuthorized?: boolean };
      if (!response.ok || typeof result.enabled !== "boolean" || typeof result.query !== "string") {
        throw new Error(result.error ?? "Could not save mail-monitor settings.");
      }
      setMailMonitor({ enabled: result.enabled, query: result.query, ready: Boolean(result.ready), gmailAuthorized: Boolean(result.gmailAuthorized) });
      setNotice(enabled ? "Hourly mail monitoring is on." : "Mail monitoring is paused.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save mail-monitor settings.");
    } finally {
      setMonitorSaving(false);
      window.setTimeout(() => setNotice(null), 3200);
    }
  }

  return (
    <div className="jarvis-app min-h-dvh text-slate-100">
      <aside className="jarvis-sidebar hidden md:flex">
        <Brand />
        <div className="sidebar-caption">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              className={`nav-button ${section === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => setSection(item.id)}
              type="button"
            >
              <item.icon size={17} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === "inbox" ? <span className="nav-count">2</span> : null}
            </button>
          ))}
          <Link className="nav-button" href="/s">
            <MessageCircle size={17} strokeWidth={1.8} />
            <span>Talk to JARVIS</span>
            <ChevronRight className="ml-auto opacity-40" size={15} />
          </Link>
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-caption">PREFERENCES</div>
        <button
          className={`nav-button ${section === "settings" ? "active" : ""}`}
          onClick={() => setSection("settings")}
          type="button"
        >
          <Settings2 size={17} strokeWidth={1.8} />
          <span>Connections & settings</span>
        </button>
        <div className="profile-card">
          <div className="profile-avatar">J</div>
          <div className="min-w-0">
            <div className="profile-name">Personal workspace</div>
            <div className="profile-plan">Local preview</div>
          </div>
          <span className="profile-online" aria-label="Workspace active" />
        </div>
      </aside>

      <div className="jarvis-main">
        <header className="topbar">
          <div className="md:hidden"><Brand compact /></div>
          <div className="topbar-context hidden md:block">
            <span className="topbar-overline">PERSONAL ASSISTANT</span>
            <span className="topbar-divider">/</span>
            <span>{sectionTitle(section)}</span>
          </div>
          <div className="topbar-right">
            <div className="system-status"><span className="status-dot preview-dot" /> PREVIEW MODE</div>
            <button
              aria-label="Connections and settings"
              className="icon-button md:hidden"
              onClick={() => setSection("settings")}
              type="button"
            >
              <Settings2 size={17} />
            </button>
            <div className="topbar-date"><Clock3 size={14} /> {getLocalTime()}</div>
          </div>
        </header>

        <nav className="mobile-nav md:hidden" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              aria-current={section === item.id ? "page" : undefined}
              className={`mobile-nav-item ${section === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => setSection(item.id)}
              type="button"
            >
              <item.icon size={16} /> {item.label}
            </button>
          ))}
          <Link className="mobile-nav-item" href="/s"><MessageCircle size={16} /> Chat</Link>
        </nav>

        <main className="workspace-content">
          {section === "overview" ? (
            <Overview
              monthlyTotal={monthlyTotal}
              onConnectAlerts={() => setConnection("whatsapp")}
              onNavigate={setSection}
            />
          ) : null}
          {section === "inbox" ? (
            <InboxPage onConnect={() => setConnection("gmail")} />
          ) : null}
          {section === "expenses" ? (
            <ExpensesPage
              expenses={allExpenses}
              monthlyExpenses={monthlyExpenses}
              monthlyTotal={monthlyTotal}
              onAdd={() => setShowExpenseForm(true)}
              onRemove={removeExpense}
              storage={expenseStorage}
              personalCount={expenses.length}
            />
          ) : null}
          {section === "settings" ? (
            <SettingsPage
              onConnectGmail={() => setConnection("gmail")}
              onConnectAlerts={() => setConnection("whatsapp")}
              onManageExpenses={() => setSection("expenses")}
              expenseStorage={expenseStorage}
              mailMonitor={mailMonitor}
              monitorSaving={monitorSaving}
              onSaveMailMonitor={saveMailMonitor}
              onChangeMailQuery={(query) => setMailMonitor((current) => ({ ...current, query }))}
            />
          ) : null}
        </main>
        <footer className="workspace-footer">
          <span><ShieldCheck size={14} /> Your workspace</span>
          <span>JARVIS · PERSONAL ASSISTANT</span>
        </footer>
      </div>

      {showExpenseForm ? (
        <Modal title="Add an expense" onClose={() => setShowExpenseForm(false)}>
          <p className="modal-copy">{expenseStorage === "cloud" ? "Record a purchase. It will sync to your private workspace across devices." : "Record a purchase. Until cloud storage is connected, it stays in this browser only."}</p>
          <form className="expense-form" onSubmit={addExpense}>
            <label>Merchant<input autoFocus name="merchant" placeholder="e.g. Grocery store" required /></label>
            <div className="form-row">
              <label>Amount in ₹<input min="1" name="amount" placeholder="0" required type="number" /></label>
              <label>Category
                <select defaultValue="Food & drink" name="category">
                  <option>Food & drink</option><option>Groceries</option><option>Transport</option>
                  <option>Bills</option><option>Shopping</option><option>Health</option><option>Other</option>
                </select>
              </label>
            </div>
            <label>Date<input defaultValue={dateOffset(0)} name="date" required type="date" /></label>
            <div className="modal-actions">
              <button className="button-secondary" onClick={() => setShowExpenseForm(false)} type="button">Cancel</button>
              <button className="button-primary" disabled={savingExpense} type="submit"><Plus size={15} /> {savingExpense ? "Saving…" : "Save expense"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {connection ? (
        <Modal title={connection === "gmail" ? "Connect Gmail" : "Set up WhatsApp"} onClose={() => setConnection(null)}>
          <div className="integration-mark"><div className="integration-icon">{connection === "gmail" ? <Mail size={19} /> : <MessageCircle size={19} />}</div><span>ACCOUNT CONNECTION</span></div>
          <p className="modal-copy">
            {connection === "gmail"
              ? "Create a Google Cloud OAuth Web client and save its client ID and secret in the ignored .secrets/google-oauth.json file. Then create and attach the connector using the README steps. Open JARVIS chat afterward and grant read-only Gmail access when Google asks."
              : "JARVIS can send you WhatsApp messages about important mail. This uses WhatsApp Business Cloud and a business phone number; it does not place phone calls or connect to a personal WhatsApp session."}
          </p>
          <div className="permission-note"><ShieldCheck size={16} /><span>{connection === "gmail" ? "Gmail access is read-only. JARVIS cannot send, delete, archive, or edit messages." : "Alerts stay off until you enable hourly monitoring. After that, JARVIS sends only to the recipient number you configure, using your approved template."}</span></div>
          <div className="modal-actions"><button className="button-secondary" onClick={() => setConnection(null)} type="button">Close</button>{connection === "gmail" ? <Link className="button-primary" href="/s" onClick={() => setConnection(null)}>Open JARVIS chat <ArrowRight size={15} /></Link> : null}</div>
        </Modal>
      ) : null}

      {notice ? <div className="toast"><Check size={15} /> {notice}</div> : null}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <div className="brand-mark"><span /><span /><span /></div>
      <div><div className="brand-name">JARVIS</div><div className="brand-subtitle">PERSONAL SYSTEMS</div></div>
    </div>
  );
}

function Overview({
  monthlyTotal,
  onConnectAlerts,
  onNavigate,
}: {
  monthlyTotal: number;
  onConnectAlerts: () => void;
  onNavigate: (section: Section) => void;
}) {
  return (
    <>
      <div className="page-heading overview-heading">
        <div><div className="eyebrow"><span className="eyebrow-line" /> YOUR DAY, AT A GLANCE</div><h1>{getGreeting()}<span className="heading-period">.</span></h1><p>Ready when you are. Here’s what needs your attention.</p></div>
        <Link className="button-primary chat-cta" href="/s"><Sparkles size={16} /> Talk to JARVIS <ArrowRight size={15} /></Link>
      </div>

      <div className="overview-grid">
        <section className="hero-card">
          <div className="hero-copy">
            <div className="hero-kicker"><span className="hero-kicker-dot" /> YOUR PERSONAL ASSISTANT</div>
            <h2>At your<br /><em>service.</em></h2>
            <p>Ask me to think something through, plan your day, or keep an eye on what matters.</p>
            <Link className="hero-link" href="/s">Start a conversation <ArrowRight size={15} /></Link>
          </div>
          <div className="reactor" aria-hidden="true"><div className="reactor-ring ring-one" /><div className="reactor-ring ring-two" /><div className="reactor-ring ring-three" /><div className="reactor-core"><Zap size={21} fill="currentColor" /></div><div className="reactor-label">STANDBY</div></div>
          <div className="hero-coordinate">ASSISTANT CORE <span>·</span> 01</div>
        </section>

        <section className="mail-card panel-card">
          <div className="card-topline"><div className="card-icon mail-icon"><Mail size={17} /></div><span className="live-label"><span className="status-dot" /> PREVIEW</span></div>
          <div className="metric-label">PRIORITY INBOX</div>
          <div className="metric-value">02<span className="metric-unit"> items</span></div>
          <p className="metric-footnote">Sample messages · Gmail not connected</p>
          <div className="card-rule" />
          <div className="mini-mail"><span className="mini-mail-dot" /><div><strong>Needs your attention</strong><small>Example email that may need a reply</small></div><ArrowRight size={14} /></div>
          <button className="text-action" onClick={() => onNavigate("inbox")} type="button">Review sample inbox <ArrowRight size={14} /></button>
        </section>

        <section className="spend-card panel-card">
          <div className="card-topline"><div className="card-icon spend-icon"><CircleDollarSign size={17} /></div><span className="sample-label">SAMPLE DATA</span></div>
          <div className="metric-label">SPENDING THIS MONTH</div>
          <div className="metric-value money-value">{money.format(monthlyTotal)}</div>
          <p className="metric-footnote">Includes example transactions</p>
          <div className="spend-sparkline" aria-label="Illustrative spending trend"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
          <button className="text-action" onClick={() => onNavigate("expenses")} type="button">Open expense tracker <ArrowRight size={14} /></button>
        </section>

        <section className="inbox-panel panel-card">
          <div className="section-card-heading"><div><div className="eyebrow small-eyebrow">A QUICK LOOK</div><h3>Priority inbox</h3></div><button className="icon-button" aria-label="Open inbox" onClick={() => onNavigate("inbox")} type="button"><ArrowRight size={16} /></button></div>
          <div className="preview-notice"><span className="notice-dot" /> Preview only <span>·</span> Connect Gmail to see your mail</div>
          <div className="email-list compact-list">
            {sampleEmails.slice(0, 2).map((mail) => <EmailRow email={mail} key={mail.id} />)}
          </div>
          <button className="text-action" onClick={() => onNavigate("inbox")} type="button">See sample messages <ArrowRight size={14} /></button>
        </section>

        <section className="followup-panel panel-card">
          <div className="section-card-heading"><div><div className="eyebrow small-eyebrow">NEXT STEPS</div><h3>Follow-up, your way</h3></div><div className="card-icon alert-icon"><Bell size={17} /></div></div>
          <div className="followup-empty"><div className="followup-orbit"><CalendarDays size={18} /></div><div><strong>Nothing connected yet</strong><p>Connect your mail and choose when JARVIS should nudge you.</p></div></div>
          <button className="text-action" onClick={onConnectAlerts} type="button">Set up WhatsApp alerts <ArrowRight size={14} /></button>
        </section>
      </div>

      <section className="suggestion-strip">
        <div className="suggestion-icon"><Sparkles size={16} /></div><div className="suggestion-copy"><strong>A thought for later</strong><span>JARVIS can also help prepare for meetings, track routines, and turn messages into reminders.</span></div><button onClick={() => onNavigate("settings")} type="button">Explore ideas <ArrowRight size={14} /></button>
      </section>
    </>
  );
}

function InboxPage({ onConnect }: { onConnect: () => void }) {
  const [selected, setSelected] = useState<(typeof sampleEmails)[number] | null>(null);
  return (
    <>
      <PageTitle eyebrow="MAIL & FOLLOW-UPS" title="Priority inbox" subtitle="JARVIS can surface what matters and suggest the next step." action={<button className="button-primary" onClick={onConnect} type="button"><Plus size={15} /> Connect Gmail</button>} />
      <div className="preview-banner"><div className="preview-banner-icon"><Mail size={18} /></div><div><strong>Preview inbox — sample messages</strong><p>Connect Gmail to review your messages here. The first connection is planned as read-only.</p></div><button className="button-secondary" onClick={onConnect} type="button">Connect account <ArrowRight size={14} /></button></div>
      <div className="inbox-toolbar"><div className="inbox-filter active"><Inbox size={15} /> For you <span>2</span></div><div className="inbox-toolbar-note"><Search size={15} /> Showing 3 sample messages</div></div>
      <section className="panel-card inbox-page-list">
        {sampleEmails.map((email) => <button className="email-row-button" key={email.id} onClick={() => setSelected(email)} type="button"><EmailRow email={email} /><ChevronRight className="email-chevron" size={16} /></button>)}
      </section>
      <div className="privacy-callout"><ShieldCheck size={17} /><span><strong>Your approval stays in the loop.</strong> JARVIS can draft replies and reminders, then ask before sending or contacting you.</span></div>
      {selected ? <Modal title={selected.subject} onClose={() => setSelected(null)}><div className="email-detail-from"><div className={`sender-avatar ${selected.color}`}>{selected.initials}</div><div><strong>{selected.sender}</strong><small>{selected.time} · Sample message</small></div></div><p className="email-detail-copy">{selected.preview}</p><div className="suggested-action"><Sparkles size={16} /><div><strong>Suggested next step</strong><p>Review the message and decide whether you’d like a reminder or a draft reply.</p></div></div><div className="modal-actions"><button className="button-secondary" onClick={() => setSelected(null)} type="button">Close</button><button className="button-primary" onClick={() => { setSelected(null); onConnect(); }} type="button">Connect Gmail <ArrowRight size={15} /></button></div></Modal> : null}
    </>
  );
}

function ExpensesPage({ expenses, monthlyExpenses, monthlyTotal, onAdd, onRemove, storage, personalCount }: { expenses: Expense[]; monthlyExpenses: Expense[]; monthlyTotal: number; onAdd: () => void; onRemove: (id: string) => void; storage: ExpenseStorage; personalCount: number }) {
  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const expense of monthlyExpenses) totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthlyExpenses]);
  const maxCategory = Math.max(...categories.map(([, amount]) => amount), 1);

  return (
    <>
      <PageTitle eyebrow="PERSONAL FINANCE" title="Expense tracker" subtitle={storage === "cloud" ? "Your entries sync across your devices." : "Entries stay in this browser until cloud storage is connected."} action={<button className="button-primary" onClick={onAdd} type="button"><Plus size={15} /> Add expense</button>} />
      <div className="finance-summary-grid">
        <section className="panel-card finance-total"><div className="metric-label">SPENDING THIS MONTH</div><div className="finance-value">{money.format(monthlyTotal)}</div><div className="finance-caption"><span className="sample-label">{storage === "cloud" ? "PRIVATE WORKSPACE" : "SAMPLE DATA INCLUDED"}</span><span>·</span><span>{personalCount} personal entries{storage === "cloud" ? " synced" : " on this device"}</span></div><div className="finance-bars" aria-hidden="true"><span style={{ height: "38%" }} /><span style={{ height: "56%" }} /><span style={{ height: "43%" }} /><span style={{ height: "76%" }} /><span style={{ height: "54%" }} /><span style={{ height: "89%" }} /><span style={{ height: "61%" }} /><span style={{ height: "96%" }} /><span style={{ height: "71%" }} /><span style={{ height: "83%" }} /><span style={{ height: "68%" }} /><span style={{ height: "90%" }} /></div><div className="finance-months"><span>01 NOV</span><span>18 NOV</span></div></section>
        <section className="panel-card categories-card"><div className="section-card-heading"><div><div className="eyebrow small-eyebrow">BREAKDOWN</div><h3>By category</h3></div><div className="card-icon spend-icon"><CreditCard size={17} /></div></div><div className="category-list">{categories.slice(0, 4).map(([category, amount], index) => <div className="category-item" key={category}><div className="category-label"><span className={`category-dot cat-${index}`} />{category}<strong>{money.format(amount)}</strong></div><div className="category-track"><span className={`category-fill cat-${index}`} style={{ width: `${Math.max(8, (amount / maxCategory) * 100)}%` }} /></div></div>)}</div></section>
      </div>
      <section className="panel-card transactions-card"><div className="section-card-heading transaction-heading"><div><div className="eyebrow small-eyebrow">ACTIVITY</div><h3>Recent transactions</h3></div><div className="sample-label">{storage === "cloud" ? "SYNCED WORKSPACE" : "EXAMPLES + THIS DEVICE"}</div></div><div className="transaction-table"><div className="transaction-head"><span>MERCHANT</span><span>CATEGORY</span><span>DATE</span><span>AMOUNT</span><span /></div>{[...expenses].sort((a, b) => b.date.localeCompare(a.date)).map((expense) => <div className="transaction-row" key={expense.id}><div className="merchant-cell"><div className={`merchant-icon ${categoryClass(expense.category)}`}><ReceiptIcon category={expense.category} /></div><div><strong>{expense.merchant}</strong>{expense.id.startsWith("sample-") ? <small>Example transaction</small> : <small>{storage === "cloud" ? "Saved to private workspace" : "Saved in this browser"}</small>}</div></div><span className="transaction-category">{expense.category}</span><span className="transaction-date">{formatDate(expense.date)}</span><strong className="transaction-amount">−{money.format(expense.amount)}</strong>{expense.id.startsWith("sample-") ? <span /> : <button aria-label={`Remove ${expense.merchant} expense`} className="remove-expense" onClick={() => onRemove(expense.id)} type="button"><X size={14} /></button>}</div>)}</div><div className="transaction-foot"><FileText size={14} /> {storage === "cloud" ? "Personal entries are stored in your private workspace and sync across devices." : "Example entries are illustrative. Your own entries are saved only in this browser until cloud storage is connected."}</div></section>
    </>
  );
}

function SettingsPage({
  onConnectGmail,
  onConnectAlerts,
  onManageExpenses,
  expenseStorage,
  mailMonitor,
  monitorSaving,
  onSaveMailMonitor,
  onChangeMailQuery,
}: {
  onConnectGmail: () => void;
  onConnectAlerts: () => void;
  onManageExpenses: () => void;
  expenseStorage: ExpenseStorage;
  mailMonitor: MailMonitorPreference;
  monitorSaving: boolean;
  onSaveMailMonitor: (enabled: boolean, query: string) => void;
  onChangeMailQuery: (query: string) => void;
}) {
  return (
    <>
      <PageTitle eyebrow="YOUR ASSISTANT" title="Connections & settings" subtitle="Choose what JARVIS can access and how it gets your attention." />
      <div className="settings-grid">
        <section className="panel-card settings-card">
          <div className="settings-card-top">
            <div className="integration-icon gmail-color"><Mail size={19} /></div>
            <span className="connection-state"><span className="state-dot" /> SETUP REQUIRED</span>
          </div>
          <h3>Gmail</h3>
          <p>Summarize important mail, identify deadlines, and prepare follow-up suggestions.</p>
          <div className="scope-row"><ShieldCheck size={15} /><span>Read-only access · Gmail consent in chat</span></div>
          <button className="button-secondary full-width" onClick={onConnectGmail} type="button">Set up Gmail <ArrowRight size={15} /></button>
        </section>
        <section className="panel-card settings-card mail-monitor-card">
          <div className="settings-card-top">
            <div className="integration-icon whatsapp-color"><MessageCircle size={19} /></div>
            <span className={`connection-state ${mailMonitor.enabled && mailMonitor.ready ? "connected" : ""}`}>
              <span className="state-dot" />
              {mailMonitor.ready ? mailMonitor.enabled ? "MONITORING ON" : "MONITORING OFF" : "SETUP REQUIRED"}
            </span>
          </div>
          <h3>WhatsApp mail alerts</h3>
          <p>After Gmail consent, JARVIS checks once an hour and sends a concise alert for new mail that needs timely action.</p>
          <label className="mail-query-field">
            Gmail search rule
            <input
              aria-label="Gmail search rule for scheduled monitoring"
              disabled={!mailMonitor.ready || monitorSaving}
              onChange={(event) => onChangeMailQuery(event.currentTarget.value)}
              value={mailMonitor.query}
            />
          </label>
          <div className="scope-row"><ShieldCheck size={15} /><span>Only after Gmail consent and WhatsApp setup</span></div>
          <button
            className={`button-${mailMonitor.enabled ? "secondary" : "primary"} full-width`}
            aria-pressed={mailMonitor.enabled}
            disabled={monitorSaving || (!mailMonitor.ready && !mailMonitor.enabled)}
            onClick={() => onSaveMailMonitor(!mailMonitor.enabled, mailMonitor.query)}
            type="button"
          >
            {monitorSaving ? "Saving…" : mailMonitor.enabled ? "Pause mail alerts" : "Enable hourly mail alerts"}
          </button>
          {!mailMonitor.ready ? <button className="text-link-button" onClick={mailMonitor.gmailAuthorized ? onConnectAlerts : onConnectGmail} type="button">{mailMonitor.gmailAuthorized ? "Review WhatsApp setup steps" : "Connect Gmail in chat first"}</button> : null}
          {mailMonitor.ready ? <button className="text-link-button" disabled={monitorSaving} onClick={() => onSaveMailMonitor(mailMonitor.enabled, mailMonitor.query)} type="button">Save search rule</button> : null}
        </section>
        <section className="panel-card settings-card"><div className="settings-card-top"><div className="integration-icon finance-icon"><Wallet size={19} /></div><span className={`connection-state ${expenseStorage === "cloud" ? "connected" : ""}`}><span className="state-dot" /> {expenseStorage === "cloud" ? "SYNCED" : expenseStorage === "loading" ? "CHECKING" : "LOCAL ONLY"}</span></div><h3>Expenses</h3><p>{expenseStorage === "cloud" ? "Manual entries sync across your devices in your private workspace. Bank imports can be added later." : "Manual entries stay in this browser until the private database is connected. Bank imports can be added later."}</p><div className="scope-row"><ShieldCheck size={15} /><span>Default currency · INR ₹</span></div><button className="button-secondary full-width" onClick={onManageExpenses} type="button">Manage expense entries <ArrowRight size={15} /></button></section>
      </div>
      <section className="future-ideas panel-card"><div className="eyebrow small-eyebrow">ROOM TO GROW</div><h3>What else could JARVIS take off your plate?</h3><div className="ideas-grid"><div><CalendarDays size={17} /><strong>Calendar briefings</strong><span>A morning rundown of your day and travel time.</span></div><div><Bell size={17} /><strong>Follow-up reminders</strong><span>Turn email deadlines into reminders you approve.</span></div><div><ArrowDownRight size={17} /><strong>Spending patterns</strong><span>Spot subscriptions and unusual changes month to month.</span></div></div></section>
    </>
  );
}

function PageTitle({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {eyebrow}</div><h1>{title}<span className="heading-period">.</span></h1><p>{subtitle}</p></div>{action ? <div className="page-heading-action">{action}</div> : null}</div>;
}

function EmailRow({ email }: { email: (typeof sampleEmails)[number] }) {
  return <div className="email-row"><div className={`sender-avatar ${email.color}`}>{email.initials}</div><div className="email-row-copy"><div className="email-row-top"><strong>{email.sender}</strong><span>{email.time}</span></div><div className="email-subject">{email.subject}</div><div className="email-preview">{email.preview}</div></div><span className="email-tag">{email.tag}</span></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-labelledby="modal-title" aria-modal="true" className="modal-panel" role="dialog"><div className="modal-header"><h2 id="modal-title">{title}</h2><button aria-label="Close" className="icon-button" onClick={onClose} type="button"><X size={17} /></button></div>{children}</section></div>;
}

function ReceiptIcon({ category }: { category: string }) {
  if (category === "Transport") return <ArrowDownRight size={16} />;
  if (category === "Bills") return <FileText size={16} />;
  return <CreditCard size={16} />;
}

function categoryClass(category: string) {
  if (category === "Transport") return "merchant-blue";
  if (category === "Groceries") return "merchant-green";
  if (category === "Bills") return "merchant-amber";
  return "merchant-violet";
}

function sectionTitle(section: Section) {
  if (section === "overview") return "Overview";
  if (section === "inbox") return "Priority inbox";
  if (section === "expenses") return "Expenses";
  return "Connections & settings";
}

function getGreeting() {
  const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getLocalTime() {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date());
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${date}T00:00:00+05:30`));
}

function dateOffset(daysAgo: number) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" })
    .formatToParts(now)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00+05:30`);
  date.setDate(date.getDate() - daysAgo);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" }).format(date);
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Kolkata" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}
