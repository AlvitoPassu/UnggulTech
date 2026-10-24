import { Router } from "express";
import { logAudit } from "../services/auditService.js";
import { operatorAuth } from "../middleware/authMiddleware.js";

export const createAuthRouter = ({ auth = operatorAuth, audit = logAudit } = {}) => {
  const router = Router();
  const operationRoute = (operation) => async (req, res) => {
    try {
      req.operatorIdentity = await auth.identify(req);
      const lease = await auth.operate(req.operatorIdentity, operation, req.body);
      // Successful acquisition, logout and expiration are audited in the RPC.
      return res.json({ active: !["release", "timeout"].includes(operation),
        released: lease.released === true, lease });
    } catch (error) {
      return auth.reject(req, res, error);
    }
  };

  router.post("/session", operationRoute("acquire"));
  router.post("/activity", operationRoute("extend"));
  router.post("/logout", operationRoute("release"));
  router.post("/logout-timeout", operationRoute("timeout"));
  router.get("/session-status", auth.requireAuth, (req, res) => res.json({
    active: true, lease: req.operatorLease,
    user: { id: req.user.id, email: req.user.email },
  }));

  router.post("/login-failed", async (req, res) => {
    // Arbitrary client strings might contain credentials; use a fixed reason.
    await audit({ action: "LOGIN_FAILED", resource: "auth",
      metadata: { reason: "credentials_rejected" }, req });
    return res.json({ status: "logged" });
  });
  return router;
};

export default createAuthRouter();
