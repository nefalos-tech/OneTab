import { describe, expect, it } from "vitest";
import { PaymentPreflightFailure } from "./preflight";
import { observedPaymentError, PaymentFailure, paymentFailure } from "./errors";

describe("payment errors", () => {
  it("keeps typed adapter codes and hides arbitrary store details", () => {
    expect(paymentFailure(new PaymentFailure("RETRY_BLOCKED"))).toMatchObject({ code: "RETRY_BLOCKED", status: 409 });
    expect(paymentFailure(new Error("FORBIDDEN secret token"))).toMatchObject({ code: "CONFIGURATION_UNAVAILABLE", status: 503 });
    expect(observedPaymentError("secret signed bytes")).toMatchObject({ code: "RPC_UNAVAILABLE" });
    expect(JSON.stringify(observedPaymentError("secret signed bytes"))).not.toContain("secret");
    expect(observedPaymentError(null)).toBeNull();
  });
  it("maps actionable preflight failures into the shared public vocabulary", () => {
    expect(paymentFailure(new PaymentPreflightFailure("INSUFFICIENT_SOL"))).toMatchObject({ code: "INSUFFICIENT_SOL", status: 422 });
    expect(paymentFailure(new PaymentPreflightFailure("WRONG_NETWORK"))).toMatchObject({ code: "CONFIGURATION_UNAVAILABLE" });
    expect(paymentFailure(new PaymentPreflightFailure("TOKEN_ACCOUNT_INVALID"))).toMatchObject({ code: "INVALID_PAYMENT" });
    expect(observedPaymentError("INVALID_SIGNATURE")).toMatchObject({ code: "INVALID_SIGNATURE" });
  });
});
