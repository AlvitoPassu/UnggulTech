import { withOperatorAuthLock } from "./candidateAuth.js";

export const SESSION_ID_KEY = "unggultech_operator_session_id";
export const GLOBAL_SESSION_BUSY_MESSAGE = "Saat ini terdapat pengguna lain yang sedang login ke sistem Unggul Monitoring. Silakan mencoba kembali setelah pengguna tersebut logout atau sesi berakhir.";
export const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 30_000;
export const MAX_ACTIVITY_AGE_MS = 45_000;
const TERMINAL_CODES = new Set(["UNAUTHORIZED", "TOKEN_EXPIRED", "MISSING_SESSION_ID",
  "INVALID_SESSION", "SESSION_NOT_FOUND", "SESSION_MISMATCH", "SESSION_TIMEOUT"]);

export const normalizeAuthError = async (error) => {
  if (typeof Blob !== "undefined" && error.response?.data instanceof Blob) {
    try { error.response.data = JSON.parse(await error.response.data.text()); } catch { /* non-JSON response */ }
  }
  return error;
};

export const loginErrorMessage = (error) => {
  const code = error.response?.data?.code || error.code;
  if (code === "GLOBAL_SESSION_BUSY") return GLOBAL_SESSION_BUSY_MESSAGE;
  if (code === "invalid_credentials") return "Username/email atau password salah. Pastikan kredensial benar.";
  if (code === "AUTH_COORDINATION_UNAVAILABLE") return error.message;
  if (error.response?.data?.message) return error.response.data.message;
  return "Login belum dapat dikonfirmasi. Periksa koneksi dan coba kembali.";
};

export const createSessionSecret = () => {
  // 256 bits from Web Crypto. Never fall back to Math.random or timestamps.
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// This decode only prevents mixing provider identities in the UI. Backend
// getUser/getClaims and the database remain the authorization boundary.
const authSessionId = (session) => {
  try { return JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id; }
  catch { return undefined; }
};
const sameAuthSession = (a, b) => a?.user?.id === b?.user?.id
  && (authSessionId(a) ? authSessionId(a) === authSessionId(b) : a?.access_token === b?.access_token);

export const shouldAttachOperatorCredentials = (url, baseURL, origin) => {
  try {
    const target = new URL(url, baseURL || origin);
    return target.origin === origin && target.pathname.startsWith("/api/");
  } catch { return false; }
};

// Framework-independent lifecycle, shared by React and local automated tests.
export class OperatorSessionClient {
  constructor({ auth, createCandidate, withAuthLock = withOperatorAuthLock, api, storage,
    now = () => globalThis.performance.timeOrigin + globalThis.performance.now(), makeSecret = createSessionSecret }) {
    Object.assign(this, { auth, createCandidate, withAuthLock, api, storage, now, makeSecret });
    this.session = null;
    this.sessionId = null;
    this.status = "loading";
    this.notice = "";
    this.deadline = 0;
    this.serverExpiry = 0;
    this.generation = 0;
    this.requestRevision = 0;
    this.confirmedRevision = 0;
    this.confirmationVersion = 0;
    this.listeners = new Set();
    this.dirty = false;
    this.activityVersion = 0;
    this.pendingActivity = null;
    this.activityAnchor = null;
    this.lastActivityAttempt = -Infinity;
    this.extending = false;
    this.closing = false;
  }

  snapshot() {
    return { authStatus: this.status, session: this.session, user: this.session?.user || null,
      sessionId: this.sessionId, sessionNotice: this.notice, deadline: this.deadline,
      isExtending: this.extending };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(this.snapshot()); }
  setNotice(notice) { this.notice = notice; this.emit(); }
  clear(status = "unauthenticated") {
    this.generation += 1;
    this.status = status;
    this.session = null;
    this.sessionId = null;
    this.deadline = 0;
    this.serverExpiry = 0;
    this.dirty = false;
    this.pendingActivity = null;
    this.storage.removeItem(SESSION_ID_KEY);
    this.activityAnchor = null;
    this.emit();
  }
  headers() {
    return { Authorization: `Bearer ${this.session.access_token}`, "X-Session-Id": this.sessionId };
  }
  async localSignOut(session = this.session, candidate = this.candidate) {
    this.cleaning = true;
    try {
      const cleanup = async () => {
        const target = candidate || this.auth;
        // Check and sign-out are coordinated with promotion across all tabs.
        const { data } = await target.getSession();
        if (session && !sameAuthSession(session, data?.session)) return;
        const { error } = await target.signOut({ scope: "local" });
        if (error) throw error;
      };
      if (candidate) await cleanup();
      else await this.withAuthLock(cleanup);
    } catch {
      this.setNotice(this.notice || "Sesi aplikasi berakhir. Pembersihan autentikasi lokal belum dapat dikonfirmasi.");
    } finally {
      if (candidate) { await candidate.dispose?.(); if (this.candidate === candidate) this.candidate = null; }
      this.cleaning = false;
    }
  }
  acceptLease(lease, requestStarted, generation, revision = ++this.requestRevision) {
    if (generation !== this.generation || revision < this.confirmedRevision || this.closing) return false;
    const { remaining, expiry } = this.validateLease(lease, requestStarted);
    // A delayed status response must not undo a more recent activity confirmation.
    if (expiry < this.serverExpiry) return false;
    // Use database remaining time, conservatively accounting for request latency.
    this.deadline = requestStarted + remaining;
    this.serverExpiry = expiry;
    this.confirmedRevision = revision;
    this.confirmationVersion += 1;
    this.activityVersion = Math.max(this.activityVersion, Number(lease.lastActivityRevision) || 0);
    // Server-time estimate anchored to response receipt: outbound latency makes
    // honest events earlier. Browser absolute wall timestamps are never sent.
    this.activityAnchor = { serverTime: Date.parse(lease.serverNow), localTime: this.now() };
    this.status = "authenticated";
    this.emit();
    return true;
  }
  validateLease(lease, requestStarted) {
    const remaining = Date.parse(lease?.expiresAt) - Date.parse(lease?.serverNow);
    const expiry = Date.parse(lease?.expiresAt);
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > INACTIVITY_TIMEOUT_MS + 1000) {
      throw new Error("Invalid server lease");
    }
    if (requestStarted + remaining <= this.now()) throw new Error("Lease expired while awaiting response");
    return { remaining, expiry };
  }

  async restore() {
    // React StrictMode and retries share validation, never registration.
    if (this.restoring) return this.restoring;
    this.restoring = this.restoreStored();
    try { return await this.restoring; } finally { this.restoring = null; }
  }
  async restoreStored() {
    const generation = this.generation;
    try {
      const { data, error } = await this.auth.getSession();
      if (error) throw error;
      if (generation !== this.generation) return false;
      const secret = this.storage.getItem(SESSION_ID_KEY);
      if (!data.session || !/^[0-9a-f]{64}$/.test(secret || "")) {
        // A new tab without its application identity must not sign out another tab.
        this.clear();
        return false;
      }
      this.session = data.session;
      this.sessionId = secret;
      return await this.checkStatus();
    } catch {
      if (generation === this.generation) {
        this.status = "unavailable";
        this.setNotice("Sesi belum dapat diverifikasi. Periksa koneksi lalu muat ulang halaman.");
      }
      return false;
    }
  }

  async checkStatus() {
    if (!this.session || !this.sessionId || this.closing || this.loggingIn) return false;
    const generation = this.generation;
    const revision = ++this.requestRevision;
    const confirmationAtStart = this.confirmationVersion;
    const started = this.now();
    const accessToken = this.session.access_token;
    try {
      const { data } = await this.api.get("/api/auth/session-status", { headers: this.headers() });
      if (generation !== this.generation || this.closing || revision < this.confirmedRevision) return false;
      this.validateLease(data.lease, started);
      if (this.candidate) await this.promoteCandidate(generation);
      this.notice = "";
      return this.acceptLease(data.lease, started, generation, revision);
    } catch (error) {
      await this.rejectSession(error, generation, accessToken);
      if (["UNAUTHORIZED", "TOKEN_EXPIRED"].includes(error.response?.data?.code)
        && this.session && accessToken !== this.session.access_token) return false;
      if (generation === this.generation && !this.closing && revision >= this.confirmedRevision
        && confirmationAtStart === this.confirmationVersion) {
        this.status = "unavailable";
        this.setNotice("Sesi belum dapat diverifikasi. Periksa koneksi dan coba kembali.");
      }
      return false;
    }
  }

  async login(identifier, password) {
    if (this.loggingIn || this.closing || this.cleaning || this.sessionId) {
      throw new Error("Existing or pending operator session");
    }
    this.loggingIn = true;
    const generation = ++this.generation;
    this.notice = "";
    let signedIn = false;
    let admissionStarted = false;
    let candidate;
    let candidateHeaders;
    try {
      if (!this.createCandidate) throw new Error("Isolated authentication client is required");
      // Verify cross-tab coordination support before issuing Auth/admission.
      await this.withAuthLock(async () => {});
      candidate = this.createCandidate();
      this.candidate = candidate;
      const email = identifier.trim().includes("@") ? identifier.trim() : `${identifier.trim()}@unggultech.com`;
      const { data, error } = await candidate.signInWithPassword({ email, password });
      if (error) {
        await this.api.post("/api/auth/login-failed", {}).catch(() => {});
        throw error;
      }
      signedIn = true;
      if (generation !== this.generation) throw new Error("Login cancelled");
      this.session = data.session;
      this.sessionId = this.makeSecret();
      // Candidate tokens/identity stay in memory until authoritative admission.
      const started = this.now();
      this.deadline = started + INACTIVITY_TIMEOUT_MS;
      admissionStarted = true;
      candidateHeaders = this.headers();
      const revision = ++this.requestRevision;
      const { data: registration } = await this.api.post("/api/auth/session", {}, { headers: this.headers() });
      if (generation !== this.generation || this.closing) throw new Error("Login cancelled");
      this.validateLease(registration.lease, started);
      await this.promoteCandidate(generation);
      if (!this.acceptLease(registration.lease, started, generation, revision)) throw new Error("Login cancelled");
      return { user: this.session.user, session: this.session };
    } catch (error) {
      await normalizeAuthError(error);
      if (generation === this.generation) {
        if (signedIn && admissionStarted && (!error.response || error.response.status >= 500)) {
          // Validate the same candidate in memory; never persist ambiguous Auth.
          // Closing/reloading loses this attempt and its bounded DB lease expires.
          this.status = "unavailable";
          this.setNotice("Login belum dikonfirmasi. Periksa kembali sesi saat koneksi tersedia.");
        } else {
          const failedSession = this.session;
          this.clear();
          if (signedIn) await this.localSignOut(failedSession, candidate);
          else { await candidate?.dispose?.(); this.candidate = null; }
        }
      } else if (candidate) {
        // Admission cancelled locally: release exact identity best-effort; TTL
        // remains the fallback if the request or browser disappears.
        if (candidateHeaders) await this.api.post("/api/auth/logout", {}, { headers: candidateHeaders }).catch(() => {});
        await candidate.signOut({ scope: "local" }).catch(() => {});
        await candidate.dispose?.();
        if (this.candidate === candidate) this.candidate = null;
      }
      throw error;
    } finally { this.loggingIn = false; }
  }

  async promoteCandidate(generation) {
    return this.withAuthLock(() => this.applyCandidate(generation));
  }

  async applyCandidate(generation) {
    if (generation !== this.generation || this.closing) throw new Error("Login cancelled");
    const candidate = this.candidate;
    if (!candidate) return;
    const expected = this.session;
    const { data, error } = await this.auth.setSession({ access_token: expected.access_token, refresh_token: expected.refresh_token });
    if (error) throw error;
    if (generation !== this.generation || this.closing) throw new Error("Login cancelled");
    if (!sameAuthSession(expected, data.session)) throw new Error("Provider session identity changed");
    this.session = data.session;
    this.storage.setItem(SESSION_ID_KEY, this.sessionId);
    this.candidate = null;
    // Do NOT sign out the admitted refresh token after copying with SDK setSession.
    await candidate.dispose?.();
  }

  onAuthStateChange(event, newSession) {
    if (this.candidate || !this.session) return;
    if (event === "SIGNED_OUT") {
      // BC messages can arrive after another tab has promoted a new session.
      // Read SDK persistence outside the auth callback lock before clearing.
      queueMicrotask(() => { void this.reconcileProviderSignOut(); });
    }
    else if (["SIGNED_IN", "TOKEN_REFRESHED"].includes(event)) this.refreshToken(newSession);
  }

  async reconcileProviderSignOut() {
    const generation = this.generation;
    const confirmationAtStart = this.confirmationVersion;
    try {
      const { data, error } = await this.auth.getSession();
      if (error) throw error;
      if (generation !== this.generation || this.candidate || !this.session) return;
      if (!sameAuthSession(this.session,data.session)) this.clear(this.status === "session_expired" ? "session_expired" : "unauthenticated");
    } catch {
      if (generation === this.generation && this.session && !this.candidate
        && confirmationAtStart === this.confirmationVersion) {
        this.status = "unavailable";
        this.setNotice("Sesi belum dapat diverifikasi. Periksa kembali sesi saat koneksi tersedia.");
      }
    }
  }

  refreshToken(newSession) {
    if (this.session && sameAuthSession(this.session, newSession)) {
      this.session = newSession;
      this.emit(); // no acquire, activity, or expiry reset
    } else if (this.session && newSession) this.clear();
  }

  recordInteraction(flush = true) {
    if (this.status !== "authenticated" || this.closing || this.now() >= this.deadline) return;
    this.dirty = true;
    this.activityVersion += 1;
    const at = this.now();
    if (!this.activityAnchor) return;
    this.pendingActivity = { revision: this.activityVersion, localTime: at,
      occurredAt: new Date(this.activityAnchor.serverTime + at - this.activityAnchor.localTime).toISOString() };
    if (flush) void this.flushActivity();
  }
  async flushActivity(force = false) {
    if (this.status !== "authenticated" || this.closing || this.extending
      || !this.pendingActivity || !this.dirty || (!force && this.now() - this.lastActivityAttempt < ACTIVITY_THROTTLE_MS)) return false;
    if (this.now() - this.pendingActivity.localTime > MAX_ACTIVITY_AGE_MS) {
      this.pendingActivity = null;
      this.dirty = false;
      return false;
    }
    if (this.now() >= this.deadline) { await this.expire(); return false; }
    const generation = this.generation;
    const activity = this.pendingActivity;
    const revision = ++this.requestRevision;
    const accessToken = this.session.access_token;
    const started = this.now();
    this.lastActivityAttempt = started;
    this.extending = true;
    this.emit();
    try {
      const { data } = await this.api.post("/api/auth/activity", {
        activityRevision: activity.revision, activityAt: activity.occurredAt,
      }, { headers: this.headers() });
      if (this.closing || generation !== this.generation) return false;
      const accepted = this.acceptLease(data.lease, started, generation, revision);
      if (this.pendingActivity === activity) { this.dirty = false; this.pendingActivity = null; }
      if (accepted) this.setNotice("");
      return true;
    } catch (error) {
      await this.rejectSession(error, generation, accessToken);
      if (["ACTIVITY_STALE", "INVALID_ACTIVITY"].includes(error.response?.data?.code) && this.pendingActivity === activity) {
        this.pendingActivity = null; this.dirty = false;
      }
      if (generation === this.generation && revision >= this.confirmedRevision) this.setNotice("Aktivitas belum dikonfirmasi server. Periksa koneksi; sesi belum diperpanjang.");
      return false;
    } finally { this.extending = false; this.emit(); }
  }

  async rejectSession(error, generation = this.generation, accessToken) {
    await normalizeAuthError(error);
    if (generation !== this.generation || !TERMINAL_CODES.has(error.response?.data?.code)) return false;
    if (accessToken && this.session && accessToken !== this.session.access_token
      && ["UNAUTHORIZED", "TOKEN_EXPIRED"].includes(error.response.data.code)) return false;
    const expired = ["TOKEN_EXPIRED", "SESSION_TIMEOUT"].includes(error.response.data.code);
    const session = this.session, candidate = this.candidate;
    this.clear(expired ? "session_expired" : "unauthenticated");
    this.setNotice(error.response.data.message || "Sesi telah berakhir. Silakan login kembali.");
    await this.localSignOut(session, candidate);
    return true;
  }

  async logout() {
    if (!this.session || !this.sessionId || this.closing) return false;
    this.closing = true;
    const generation = this.generation;
    try {
      const { data } = await this.api.post("/api/auth/logout", {}, { headers: this.headers() });
      if (!data.released) throw new Error("Release not confirmed");
      if (generation !== this.generation) return false;
      const session = this.session, candidate = this.candidate;
      this.clear();
      this.setNotice("");
      await this.localSignOut(session, candidate);
      return true;
    } catch (error) {
      await this.rejectSession(error, generation);
      this.setNotice("Logout belum dikonfirmasi backend. Coba kembali; slot tidak dinyatakan telah dilepas.");
      return false;
    } finally { this.closing = false; }
  }

  async expire() {
    if (!this.session || !this.sessionId || this.closing) return;
    this.closing = true;
    const generation = this.generation;
    const started = this.now();
    const revision = ++this.requestRevision;
    let confirmed = false;
    try {
      const { data } = await this.api.post("/api/auth/logout-timeout", {}, { headers: this.headers() });
      confirmed = data.released === true;
    } catch (error) {
      await normalizeAuthError(error);
      if (error.response?.data?.code === "SESSION_STILL_ACTIVE") {
        this.closing = false;
        this.acceptLease(error.response.data.lease, started, generation, revision);
        return;
      }
    } finally { this.closing = false; }
    if (generation !== this.generation) return;
    const session = this.session, candidate = this.candidate;
    this.clear("session_expired");
    this.setNotice(confirmed ? "Sesi Anda telah berakhir karena tidak ada aktivitas selama 10 menit."
      : "Sesi lokal telah berakhir. Pelepasan slot backend belum dikonfirmasi; slot akan tersedia setelah kedaluwarsa.");
    await this.localSignOut(session, candidate);
  }
}
