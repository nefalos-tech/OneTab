import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentSignInNote,
  debugFrom,
  noteSignInDiagnostic,
  readSignInDiagnostic,
  signInDiagnosticMark,
  type SignInDiagnostic,
} from "./sign-in-diagnostic";

const PROVIDER: SignInDiagnostic = { stage: "sign", reason: "provider_error", code: -32000 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sign-in diagnostic", () => {
  it("stays off unless the page flag is exactly 1", () => {
    expect(debugFrom(null)).toBe(false);
    expect(debugFrom({ search: "", flag: null })).toBe(false);
    expect(debugFrom({ search: "?onetabDebug=true", flag: null })).toBe(false);
    expect(debugFrom({ search: "?onetabDebug=1", flag: null })).toBe(true);
    expect(debugFrom({ search: "", flag: "1" })).toBe(true);
  });

  it("marks a stage, a reason, and an optional number", () => {
    expect(signInDiagnosticMark({ stage: "sign", reason: "no_account", code: null })).toBe("sign:no_account");
    expect(signInDiagnosticMark(PROVIDER)).toBe("sign:provider_error:-32000");
  });

  it("records the classification without printing it when debug is off", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    noteSignInDiagnostic(PROVIDER);
    expect(readSignInDiagnostic()).toEqual(PROVIDER);
    expect(info).not.toHaveBeenCalled();
    expect(Object.keys(readSignInDiagnostic() ?? {})).toEqual(["stage", "reason", "code"]);
  });

  it("returns the visible note only while debug is on", () => {
    noteSignInDiagnostic(PROVIDER);
    expect(currentSignInNote()).toBeNull();
    vi.stubGlobal("window", { location: { search: "?onetabDebug=1" }, localStorage: { getItem: () => null } });
    expect(currentSignInNote()).toBe("sign:provider_error:-32000");
  });

  it("prints and marks only that classification when debug is on", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const dataset: Record<string, string> = {};
    vi.stubGlobal("window", { location: { search: "?onetabDebug=1" }, localStorage: { getItem: () => null } });
    vi.stubGlobal("document", { documentElement: { dataset } });
    noteSignInDiagnostic({ ...PROVIDER, reason: "provider_error" });
    expect(info).toHaveBeenCalledWith("onetab-signin", PROVIDER);
    expect(dataset.onetabSignin).toBe("sign:provider_error:-32000");
    expect(JSON.stringify(info.mock.calls[0])).not.toContain("CANARY");
  });
});
