import { describe, expect, it } from "vitest";
import { normalizeRemoteRef, parseSshSpec, quoteForRemoteShell } from "../src/ssh.js";

describe("parseSshSpec", () => {
  it("returns null without --ssh or EXTLENS_SSH", () => {
    expect(parseSshSpec([])).toBeNull();
  });

  it("parses the --ssh flag with the default remote port", () => {
    expect(parseSshSpec(["--ssh", "myserver"])).toEqual({
      destination: "myserver",
      remotePort: 8081,
    });
  });

  it("parses --remote-port", () => {
    expect(parseSshSpec(["--ssh", "user@host", "--remote-port", "9000"])).toEqual({
      destination: "user@host",
      remotePort: 9000,
    });
  });

  it("uses EXTLENS_SSH when the flag is absent", () => {
    process.env.EXLENS_SSH = "backup";
    process.env.EXLENS_REMOTE_PORT = "7000";
    try {
      expect(parseSshSpec([])).toEqual({ destination: "backup", remotePort: 7000 });
    } finally {
      delete process.env.EXLENS_SSH;
      delete process.env.EXLENS_REMOTE_PORT;
    }
  });

  it("lets the flag win over the env var", () => {
    process.env.EXLENS_SSH = "from-env";
    try {
      expect(parseSshSpec(["--ssh", "from-flag"])).toEqual({
        destination: "from-flag",
        remotePort: 8081,
      });
    } finally {
      delete process.env.EXLENS_SSH;
    }
  });

  it("rejects an out-of-range port", () => {
    expect(() => parseSshSpec(["--ssh", "host", "--remote-port", "99999"])).toThrow();
    expect(() => parseSshSpec(["--ssh", "host", "--remote-port", "abc"])).toThrow();
  });
});

describe("normalizeRemoteRef", () => {
  it("passes plain paths through", () => {
    expect(normalizeRemoteRef("/srv/extlens/run/abc/out")).toBe("/srv/extlens/run/abc/out");
  });

  it("strips a file:// prefix", () => {
    expect(normalizeRemoteRef("file:///srv/extlens/run/abc/out")).toBe(
      "/srv/extlens/run/abc/out",
    );
  });
});

describe("quoteForRemoteShell", () => {
  it("wraps a plain path in single quotes", () => {
    expect(quoteForRemoteShell("/a/b")).toBe("'/a/b'");
  });

  it("escapes embedded single quotes", () => {
    expect(quoteForRemoteShell("/a/it's/b")).toBe("'/a/it'\\''s/b'");
  });
});
