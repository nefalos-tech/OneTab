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

function windowWith(search: string, storage: { getItem: () => string } | "throwing") {
  const page: { location: { search: string } } = { location: { search } };
  if (storage === "throwing") {
    Object.defineProperty(page, "localStorage", {
      get() {
        throw new DOMException("blocked");
      },
    });
  } else {
    Object.defineProperty(page, "localStorage", { value: storage });
  }
  return page;
}

describe("sign-in diagnostic", () => {
  it("stays off unless the query is exactly 1", () => {
    expect(debugFrom(null)).toBe(false);
    expect(debugFrom("")).toBe(false);
    expect(debugFrom("?onetabDebug=true")).toBe(false);
    expect(debugFrom("?onetabDebug=1")).toBe(true);
  });

  it("stays off when storage holds 1 and the query is absent", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const getItem = vi.fn(() => "1");
    vi.stubGlobal("window", windowWith("", { getItem }));
    noteSignInDiagnostic(PROVIDER);
    expect(currentSignInNote()).toBeNull();
    expect(info).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("stays on for the query when storage throws", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const dataset: Record<string, string> = {};
    vi.stubGlobal("window", windowWith("?onetabDebug=1", "throwing"));
    vi.stubGlobal("document", { documentElement: { dataset } });
    noteSignInDiagnostic(PROVIDER);
    expect(currentSignInNote()).toBe("sign:provider_error:-32000");
    expect(info).toHaveBeenCalledWith("onetab-signin", PROVIDER);
    expect(dataset.onetabSignin).toBe("sign:provider_error:-32000");
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
    vi.stubGlobal("window", { location: { search: "?onetabDebug=1" } });
    expect(currentSignInNote()).toBe("sign:provider_error:-32000");
  });

  it("prints and marks only that classification when debug is on", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const dataset: Record<string, string> = {};
    vi.stubGlobal("window", { location: { search: "?onetabDebug=1" } });
    vi.stubGlobal("document", { documentElement: { dataset } });
    noteSignInDiagnostic({ ...PROVIDER, reason: "provider_error" });
    expect(info).toHaveBeenCalledWith("onetab-signin", PROVIDER);
    expect(dataset.onetabSignin).toBe("sign:provider_error:-32000");
    expect(JSON.stringify(info.mock.calls[0])).not.toContain("CANARY");
  });
});
