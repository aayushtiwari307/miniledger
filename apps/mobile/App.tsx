import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import {
  API_BASE_URL,
  addLoan,
  ApiError,
  fetchLoans,
  fetchSummary,
  markLoanRepaid,
  requestOtp,
  verifyOtp,
  type LedgerSummary,
  type Loan,
} from "./src/api";
import { formatDate, formatMoney, formatRepaidDate, isRealDateOnly, normalizePhoneNumber } from "./src/format";

const TOKEN_KEY = "miniledger.auth-token";
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
function MiniLedgerApp() {
  const [token, setToken] = useState<string | null>(null);
  const [phone, setPhone] = useState("+91");
  const [otp, setOtp] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [summary, setSummary] = useState<LedgerSummary>({ totalLent: 0, totalRepaid: 0, overdueAmount: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [friendName, setFriendName] = useState("");
  const [amountText, setAmountText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [savingLoan, setSavingLoan] = useState(false);
  const [repayingLoanId, setRepayingLoanId] = useState<string | null>(null);
  const savingLoanRef = useRef(false);
  const repayingRef = useRef(false);

  const expireSessionIfUnauthorized = useCallback(async (error: unknown): Promise<boolean> => {
    if (!(error instanceof ApiError) || error.status !== 401) return false;
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    setToken(null);
    setLoans([]);
    setSummary({ totalLent: 0, totalRepaid: 0, overdueAmount: 0 });
    setOtpRequested(false);
    setOtp("");
    setScreenError("Your session has expired. Please log in again.");
    return true;
  }, []);

  const loadLedger = useCallback(async (activeToken: string) => {
    setRefreshing(true);
    setScreenError(null);
    try {
      const [nextLoans, nextSummary] = await Promise.all([
        fetchLoans(activeToken),
        fetchSummary(activeToken),
      ]);
      setLoans(nextLoans);
      setSummary(nextSummary);
    } catch (error: unknown) {
      const expired = await expireSessionIfUnauthorized(error);
      if (!expired) setScreenError(error instanceof Error ? error.message : "Could not load your ledger.");
    } finally {
      setRefreshing(false);
    }
  }, [expireSessionIfUnauthorized]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (savedToken && active) {
          setToken(savedToken);
          await loadLedger(savedToken);
        }
      } catch {
        if (active) setScreenError("Could not restore your saved session. Please log in again.");
      } finally {
        if (active) setRestoringSession(false);
      }
    })();
    return () => { active = false; };
  }, [loadLedger]);

  const overdueCount = useMemo(() => loans.filter((loan) => loan.status === "overdue").length, [loans]);

  async function handleRequestOtp() {
    setScreenError(null);
    setInfoMessage(null);
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!PHONE_PATTERN.test(normalizedPhone)) {
      setScreenError("Enter a valid phone number with country code, such as +919876543210.");
      return;
    }
    setLoginBusy(true);
    try {
      const result = await requestOtp(normalizedPhone);
      setPhone(normalizedPhone);
      setOtpRequested(true);
      setOtp("");
      setInfoMessage(`OTP requested. Check the API server terminal. The code expires in ${Math.floor(result.expiresInSeconds / 60)} minutes.`);
    } catch (error: unknown) {
      setScreenError(error instanceof Error ? error.message : "Could not request OTP.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleVerifyOtp() {
    setScreenError(null);
    setInfoMessage(null);
    if (!/^\d{6}$/.test(otp)) {
      setScreenError("Enter the six-digit code printed in the backend terminal.");
      return;
    }
    setLoginBusy(true);
    try {
      const normalizedPhone = normalizePhoneNumber(phone);
      if (!PHONE_PATTERN.test(normalizedPhone)) {
        setScreenError("Enter a valid phone number with country code, such as +919876543210.");
        return;
      }
      const result = await verifyOtp(normalizedPhone, otp);
      await SecureStore.setItemAsync(TOKEN_KEY, result.token);
      setToken(result.token);
      await loadLedger(result.token);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        setScreenError("Invalid or expired code. If you've used all attempts, request a new code after the cooldown.");
      } else {
        setScreenError(error instanceof Error ? error.message : "Could not verify OTP.");
      }
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    setToken(null);
    setPhone("+91");
    setOtp("");
    setOtpRequested(false);
    setLoans([]);
    setSummary({ totalLent: 0, totalRepaid: 0, overdueAmount: 0 });
    setScreenError(null);
    setInfoMessage("You have been logged out.");
  }

  async function handleAddLoan() {
    if (!token || savingLoanRef.current) return;
    setScreenError(null);
    const parsedAmount = Number(amountText);
    if (Array.from(friendName.trim()).length < 1 || Array.from(friendName.trim()).length > 80) {
      setScreenError("Friend name must contain 1–80 characters.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 99_999_999.99 || Math.abs(parsedAmount * 100 - Math.round(parsedAmount * 100)) >= 1e-6) {
      setScreenError("Enter an amount from ₹0.01 to ₹99,999,999.99 with no more than two decimal places.");
      return;
    }
    if (!isRealDateOnly(dueDate.trim())) {
      setScreenError("Enter a real date in YYYY-MM-DD format, for example 2026-10-24.");
      return;
    }

    savingLoanRef.current = true;
    setSavingLoan(true);
    try {
      await addLoan(token, { friendName: friendName.trim(), amount: parsedAmount, dueDate: dueDate.trim() });
      setFriendName("");
      setAmountText("");
      setDueDate("");
      setShowAddForm(false);
      setInfoMessage("Loan saved.");
      await loadLedger(token);
    } catch (error: unknown) {
      const expired = await expireSessionIfUnauthorized(error);
      if (!expired) setScreenError(error instanceof Error ? error.message : "Could not save the loan.");
    } finally {
      savingLoanRef.current = false;
      setSavingLoan(false);
    }
  }

  function handleRepay(loan: Loan) {
    if (!token || repayingRef.current) return;
    Alert.alert(
      "Mark this loan as repaid?",
      `Confirm that ${loan.friendName} has repaid ${formatMoney(loan.amount)}. This action cannot be undone in the app.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Mark repaid", style: "destructive", onPress: () => { void performRepay(loan); } },
      ],
    );
  }

  async function performRepay(loan: Loan) {
    if (!token || repayingRef.current) return;
    repayingRef.current = true;
    setScreenError(null);
    setRepayingLoanId(loan.id);
    try {
      await markLoanRepaid(token, loan.id);
      setInfoMessage(`${loan.friendName}'s loan was marked as repaid.`);
      // The server is authoritative: reload both loans and derived totals after repayment.
      await loadLedger(token);
    } catch (error: unknown) {
      const expired = await expireSessionIfUnauthorized(error);
      if (!expired) setScreenError(error instanceof Error ? error.message : "Could not mark loan as repaid.");
    } finally {
      repayingRef.current = false;
      setRepayingLoanId(null);
    }
  }

  if (restoringSession) return <CenteredLoading label="Opening your ledger…" />;

  if (!token) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#F5F7FC" />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.loginContainer} keyboardShouldPersistTaps="handled">
            <BrandHeader />
            <View style={styles.loginHero}>
              <Text style={styles.eyebrow}>PERSONAL LENDING, MADE CLEAR</Text>
              <Text style={styles.headline}>Good friends.{"\n"}Clear records.</Text>
              <Text style={styles.subtitle}>Keep track of what you lend, what comes back, and what needs a reminder.</Text>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelEyebrow}>SECURE SIGN-IN</Text>
              <Text style={styles.panelTitle}>{otpRequested ? "Check your code" : "Welcome to MiniLedger"}</Text>
              <Text style={styles.panelHint}>
                {otpRequested ? "Enter the six-digit mock OTP printed in the API server terminal. Resending is subject to a short cooldown." : "Sign in with your phone number. No SMS is sent in this demo."}
              </Text>

              <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
              <TextInput
                accessibilityLabel="Phone number with country code"
                autoCapitalize="none"
                autoComplete="tel"
                keyboardType="phone-pad"
                onChangeText={setPhone}
                placeholder="+919876543210"
                placeholderTextColor="#9BA2B5"
                style={styles.input}
                value={phone}
              />

              {otpRequested ? (
                <>
                  <Text style={styles.fieldLabel}>SIX-DIGIT OTP</Text>
                  <TextInput
                    accessibilityLabel="Six-digit OTP"
                    autoComplete="one-time-code"
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••"
                    placeholderTextColor="#9BA2B5"
                    style={[styles.input, styles.otpInput]}
                    value={otp}
                  />
                </>
              ) : null}

              {screenError ? <MessageBox kind="error" message={screenError} /> : null}
              {infoMessage ? <MessageBox kind="info" message={infoMessage} /> : null}

              <PrimaryButton
                disabled={loginBusy}
                label={loginBusy ? "Please wait…" : otpRequested ? "Verify and sign in" : "Send mock OTP"}
                onPress={() => void (otpRequested ? handleVerifyOtp() : handleRequestOtp())}
                loading={loginBusy}
              />
              {otpRequested ? (
                <View style={styles.textActionRow}>
                  <Pressable disabled={loginBusy} onPress={() => void handleRequestOtp()} style={styles.textAction}>
                    <Text style={styles.textActionLabel}>Resend code</Text>
                  </Pressable>
                  <Pressable disabled={loginBusy} onPress={() => { setOtpRequested(false); setOtp(""); setInfoMessage(null); setScreenError(null); }} style={styles.textAction}>
                    <Text style={styles.textActionLabel}>Change phone</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
            <Text style={styles.loginFooter}>Demo authentication · OTP appears in the backend log</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7FC" />
      <ScrollView contentContainerStyle={styles.dashboardContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.dashboardTopRow}>
          <BrandHeader compact />
          <Pressable accessibilityRole="button" onPress={() => void handleLogout()} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </View>

        <View style={styles.dashboardHero}>
          <Text style={styles.eyebrow}>YOUR MONEY, AT A GLANCE</Text>
          <Text style={styles.dashboardTitle}>Lending ledger</Text>
          <Text style={styles.subtitle}>Simple records. Fewer awkward reminders.</Text>
        </View>

        <View style={styles.summaryGrid}>
          <SummaryCard label="TOTAL LENT" amount={summary.totalLent} tone="primary" />
          <SummaryCard label="TOTAL REPAID" amount={summary.totalRepaid} tone="mint" />
          <SummaryCard label="OVERDUE" amount={summary.overdueAmount} tone="rose" fullWidth />
        </View>

        <View style={styles.actionRow}>
          <View>
            <Text style={styles.sectionTitle}>Your entries</Text>
            <Text style={styles.sectionCaption}>{loans.length} {loans.length === 1 ? "loan" : "loans"}{overdueCount ? ` · ${overdueCount} overdue` : ""}</Text>
          </View>
          <PrimaryButton compact label={showAddForm ? "Close form" : "+ Add loan"} onPress={() => { setShowAddForm((current) => !current); setScreenError(null); setInfoMessage(null); }} />
        </View>

        {screenError ? <MessageBox kind="error" message={screenError} /> : null}
        {infoMessage ? <MessageBox kind="info" message={infoMessage} /> : null}

        {showAddForm ? (
          <View style={styles.panel}>
            <Text style={styles.panelEyebrow}>NEW ENTRY</Text>
            <Text style={styles.panelTitle}>Add money lent</Text>
            <Text style={styles.fieldLabel}>FRIEND'S NAME</Text>
            <TextInput autoCapitalize="words" onChangeText={setFriendName} placeholder="e.g. Sam" placeholderTextColor="#9BA2B5" style={styles.input} value={friendName} maxLength={160} />
            <Text style={styles.fieldLabel}>AMOUNT (₹)</Text>
            <TextInput keyboardType="decimal-pad" onChangeText={setAmountText} placeholder="e.g. 750.00" placeholderTextColor="#9BA2B5" style={styles.input} value={amountText} />
            <Text style={styles.fieldLabel}>DUE DATE</Text>
            <TextInput autoCapitalize="none" onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor="#9BA2B5" style={styles.input} value={dueDate} maxLength={10} />
            <Text style={styles.formHint}>Use YYYY-MM-DD. Past dates are allowed so you can record overdue loans.</Text>
            <PrimaryButton disabled={savingLoan} loading={savingLoan} label={savingLoan ? "Saving…" : "Save loan"} onPress={() => void handleAddLoan()} />
          </View>
        ) : null}

        <View style={styles.listHeadingRow}>
          <Text style={styles.sectionTitle}>Recent loans</Text>
          <Pressable disabled={refreshing} onPress={() => void loadLedger(token)} style={styles.refreshButton}>
            {refreshing ? <ActivityIndicator size="small" color="#4656AF" /> : <Text style={styles.refreshText}>Refresh</Text>}
          </Pressable>
        </View>

        {loans.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyGlyph}><Text style={styles.emptyGlyphText}>₹</Text></View>
            <Text style={styles.emptyTitle}>Your ledger starts here</Text>
            <Text style={styles.emptyBody}>Add a loan to keep the amount, due date and repayment status in one place.</Text>
            {!showAddForm ? <PrimaryButton label="Add your first loan" onPress={() => setShowAddForm(true)} /> : null}
          </View>
        ) : loans.map((loan) => (
          <LoanCard key={loan.id} loan={loan} busy={repayingLoanId === loan.id} disabled={repayingLoanId !== null && repayingLoanId !== loan.id} onRepay={() => handleRepay(loan)} />
        ))}

        <Text style={styles.footer}>Amounts and overdue status are calculated by the MiniLedger API.</Text>
        <Text style={styles.endpointText}>API · {API_BASE_URL}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MiniLedgerApp />
    </SafeAreaProvider>
  );
}

function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.brandRow, compact && styles.brandRowCompact]}>
      <View style={styles.brandMark}><Text style={styles.brandInitial}>M</Text></View>
      <View style={styles.brandCopy}>
        <Text style={styles.brandName}>MiniLedger</Text>
        {!compact ? <Text style={styles.brandTagline}>A little more clarity with money</Text> : null}
      </View>
      {!compact ? <View style={styles.devBadge}><Text style={styles.devBadgeText}>MOCK OTP</Text></View> : null}
    </View>
  );
}

function SummaryCard({ label, amount, tone, fullWidth = false }: { label: string; amount: number; tone: "primary" | "mint" | "rose"; fullWidth?: boolean }) {
  return (
    <View style={[styles.summaryCard, styles[`summary_${tone}`], fullWidth && styles.summaryFullWidth]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryAmount, tone === "primary" && styles.summaryPrimaryAmount]}>{formatMoney(amount)}</Text>
    </View>
  );
}

function LoanCard({ loan, busy, disabled, onRepay }: { loan: Loan; busy: boolean; disabled: boolean; onRepay: () => void }) {
  const badgeStyle = loan.status === "overdue" ? styles.badgeOverdue : loan.status === "repaid" ? styles.badgeRepaid : styles.badgeOutstanding;
  const label = loan.status === "overdue" ? "OVERDUE" : loan.status === "repaid" ? "REPAID" : "OUTSTANDING";
  return (
    <View style={[styles.loanCard, loan.status === "overdue" && styles.loanCardOverdue]}>
      <View style={styles.loanTopRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initialFor(loan.friendName)}</Text></View>
        <View style={styles.loanIdentity}>
          <Text style={styles.friendName}>{loan.friendName}</Text>
          <Text style={styles.dueDate}>Due {formatDate(loan.dueDate)}</Text>
        </View>
        <View style={styles.loanAmountBlock}>
          <Text style={styles.loanAmount}>{formatMoney(loan.amount)}</Text>
          <View style={[styles.statusBadge, badgeStyle]}><Text style={[styles.statusBadgeText, loan.status === "overdue" && styles.overdueText]}>{label}</Text></View>
        </View>
      </View>
      {loan.status !== "repaid" ? (
        <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={onRepay} style={({ pressed }) => [styles.repayButton, pressed && !busy && !disabled && styles.buttonPressed, (busy || disabled) && styles.disabledButton]}>
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          <Text style={styles.repayButtonText}>{busy ? "Updating…" : "Mark as repaid"}</Text>
        </Pressable>
      ) : (
        <Text style={styles.repaidNote}>Repaid on {loan.repaidAt ? formatRepaidDate(loan.repaidAt) : "recorded"}</Text>
      )}
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled = false, loading = false, compact = false }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; compact?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, compact && styles.primaryButtonCompact, pressed && !disabled && styles.buttonPressed, disabled && styles.disabledButton]}>
      {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function MessageBox({ kind, message }: { kind: "error" | "info"; message: string }) {
  return (
    <View style={kind === "error" ? styles.errorMessage : styles.infoMessage}>
      <Text style={kind === "error" ? styles.errorMessageText : styles.infoMessageText}>{message}</Text>
    </View>
  );
}

function CenteredLoading({ label }: { label: string }) {
  return (
    <SafeAreaView style={[styles.safeArea, styles.loadingScreen]}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7FC" />
      <ActivityIndicator size="large" color="#4656AF" />
      <Text style={styles.loadingLabel}>{label}</Text>
    </SafeAreaView>
  );
}

function initialFor(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "?";
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F5F7FC" },
  flex: { flex: 1 },
  loginContainer: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 30 },
  dashboardContainer: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 34 },
  brandRow: { flexDirection: "row", alignItems: "center", marginBottom: 30 },
  brandRowCompact: { marginBottom: 0, flex: 1 },
  brandMark: { height: 46, width: 46, borderRadius: 15, backgroundColor: "#3446A8", alignItems: "center", justifyContent: "center", marginRight: 12 },
  brandInitial: { color: "#FFFFFF", fontSize: 25, fontWeight: "800" },
  brandCopy: { flex: 1 },
  brandName: { color: "#18213F", fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  brandTagline: { color: "#7D8499", fontSize: 11, marginTop: 3 },
  devBadge: { borderRadius: 7, borderWidth: 1, borderColor: "#D9DDF0", backgroundColor: "#EFF1FC", paddingHorizontal: 8, paddingVertical: 5 },
  devBadgeText: { color: "#4957A0", fontWeight: "800", fontSize: 11, letterSpacing: 0.5 },
  loginHero: { marginBottom: 25 },
  eyebrow: { color: "#5968B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 12 },
  headline: { color: "#17203D", fontSize: 37, fontWeight: "800", letterSpacing: -1.2, lineHeight: 43 },
  subtitle: { color: "#737B91", fontSize: 13, lineHeight: 20, marginTop: 10, maxWidth: 320 },
  panel: { backgroundColor: "#FFFFFF", borderRadius: 22, padding: 20, borderWidth: 1, borderColor: "#ECEEF5", shadowColor: "#1D2755", shadowOpacity: 0.045, shadowRadius: 17, shadowOffset: { width: 0, height: 7 }, elevation: 2, marginBottom: 16 },
  panelEyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.1, color: "#979DB0", marginBottom: 7 },
  panelTitle: { color: "#222B49", fontSize: 19, fontWeight: "800", marginBottom: 6 },
  panelHint: { color: "#858CA0", fontSize: 12, lineHeight: 18, marginBottom: 20 },
  fieldLabel: { color: "#7E869B", fontSize: 11, fontWeight: "800", letterSpacing: 1.0, marginBottom: 8, marginTop: 8 },
  input: { height: 49, borderRadius: 12, borderWidth: 1, borderColor: "#E0E4F0", backgroundColor: "#FAFBFE", paddingHorizontal: 13, color: "#222B49", fontSize: 14, marginBottom: 9 },
  otpInput: { fontSize: 21, fontWeight: "800", letterSpacing: 8, textAlign: "center" },
  primaryButton: { minHeight: 49, backgroundColor: "#3446A8", borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 16, marginTop: 7 },
  primaryButtonCompact: { minHeight: 41, paddingHorizontal: 13, borderRadius: 11, marginTop: 0 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  buttonPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  disabledButton: { opacity: 0.65 },
  textAction: { alignItems: "center", paddingTop: 16, paddingBottom: 2, paddingHorizontal: 8 },
  textActionRow: { flexDirection: "row", justifyContent: "center", gap: 18 },
  textActionLabel: { color: "#4656AF", fontSize: 12, fontWeight: "700" },
  loginFooter: { textAlign: "center", color: "#A1A6B6", fontSize: 11, lineHeight: 16, marginTop: 5 },
  dashboardTopRow: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  logoutButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "#DCE1F1", backgroundColor: "#FFFFFF" },
  logoutText: { color: "#59628C", fontSize: 11, fontWeight: "700" },
  dashboardHero: { marginBottom: 19 },
  dashboardTitle: { color: "#17203D", fontSize: 29, fontWeight: "800", letterSpacing: -0.8 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  summaryCard: { width: "48%", flexGrow: 1, minHeight: 94, borderRadius: 17, paddingHorizontal: 15, paddingVertical: 15, justifyContent: "space-between" },
  summaryFullWidth: { width: "100%", minHeight: 82 },
  summary_primary: { backgroundColor: "#3446A8" },
  summary_mint: { backgroundColor: "#E5F6EE", borderWidth: 1, borderColor: "#D9F0E4" },
  summary_rose: { backgroundColor: "#FCEDEC", borderWidth: 1, borderColor: "#F7DFDE" },
  summaryLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.05, color: "#7E879E" },
  summaryAmount: { fontSize: 21, fontWeight: "800", color: "#223051", letterSpacing: -0.4 },
  summaryPrimaryAmount: { color: "#FFFFFF" },
  actionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 17 },
  sectionTitle: { color: "#202947", fontSize: 17, fontWeight: "800" },
  sectionCaption: { color: "#9198AA", fontSize: 11, marginTop: 4 },
  listHeadingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3, marginBottom: 12 },
  refreshButton: { minWidth: 55, alignItems: "center", paddingVertical: 6 },
  refreshText: { color: "#4656AF", fontSize: 11, fontWeight: "700" },
  loanCard: { backgroundColor: "#FFFFFF", borderRadius: 17, borderWidth: 1, borderColor: "#E9ECF4", padding: 15, marginBottom: 11 },
  loanCardOverdue: { borderColor: "#F1C7C4", backgroundColor: "#FFFCFC" },
  loanTopRow: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#EDEFFD", alignItems: "center", justifyContent: "center", marginRight: 11 },
  avatarText: { color: "#3446A8", fontSize: 16, fontWeight: "800" },
  loanIdentity: { flex: 1, minWidth: 0 },
  friendName: { color: "#222B49", fontSize: 14, fontWeight: "800", marginBottom: 5 },
  dueDate: { color: "#8E95A8", fontSize: 11 },
  loanAmountBlock: { alignItems: "flex-end", marginLeft: 8 },
  loanAmount: { color: "#222B49", fontSize: 14, fontWeight: "800", marginBottom: 7 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3, color: "#68718A" },
  badgeOutstanding: { backgroundColor: "#F0F2F9" },
  badgeOverdue: { backgroundColor: "#FCE4E2" },
  badgeRepaid: { backgroundColor: "#E2F5EB" },
  overdueText: { color: "#B13D38" },
  repayButton: { minHeight: 38, borderRadius: 10, backgroundColor: "#4656AF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14 },
  repayButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  repaidNote: { color: "#27835E", fontSize: 11, fontWeight: "700", marginTop: 13 },
  emptyState: { backgroundColor: "#FFFFFF", borderRadius: 19, borderWidth: 1, borderColor: "#E9ECF4", paddingHorizontal: 22, paddingVertical: 27, alignItems: "center" },
  emptyGlyph: { width: 54, height: 54, borderRadius: 18, backgroundColor: "#EDEFFD", alignItems: "center", justifyContent: "center", marginBottom: 13 },
  emptyGlyphText: { color: "#3446A8", fontSize: 25, fontWeight: "800" },
  emptyTitle: { color: "#222B49", fontSize: 15, fontWeight: "800", marginBottom: 7 },
  emptyBody: { color: "#858CA0", fontSize: 11, lineHeight: 17, textAlign: "center", marginBottom: 15 },
  formHint: { color: "#9298A9", fontSize: 11, lineHeight: 15, marginBottom: 7 },
  errorMessage: { backgroundColor: "#FFF0EF", borderRadius: 11, padding: 11, marginBottom: 12, borderWidth: 1, borderColor: "#F7DEDC" },
  errorMessageText: { color: "#A43430", fontSize: 11, lineHeight: 16 },
  infoMessage: { backgroundColor: "#EDF8F2", borderRadius: 11, padding: 11, marginBottom: 12, borderWidth: 1, borderColor: "#D9EFE3" },
  infoMessageText: { color: "#267653", fontSize: 11, lineHeight: 16 },
  footer: { textAlign: "center", color: "#9BA1B1", fontSize: 11, lineHeight: 15, marginTop: 25 },
  endpointText: { textAlign: "center", color: "#9298A9", fontSize: 10, marginTop: 5 },
  loadingScreen: { alignItems: "center", justifyContent: "center" },
  loadingLabel: { color: "#727A91", fontSize: 12, marginTop: 12 },
});
