import { vi } from "vitest";

// Tests must not inherit the developer's environment.
//
// HookServer falls back to process.env.YOLODECK_TOKEN when no token option is passed.
// Once a real token is set on the machine (which is the recommended setup — see
// README Security), every test that POSTs without an Authorization header starts
// getting 401s, and the "runs open when no token is configured" case becomes
// untestable. The suite was only ever green because the variable didn't exist yet.
//
// Clearing it here makes the default hermetic: tests that want a token pass one
// explicitly via the `token` option.
delete process.env.YOLODECK_TOKEN;
delete process.env.YOLODECK_DEBUG;

// Replace the @elgato/streamdeck import with a no-op logger and action stubs.
// SessionManager and HookServer only touch `streamDeck.logger.*`; this keeps
// the plugin's source unchanged while letting tests run without the SDK runtime.
vi.mock("@elgato/streamdeck", () => {
  const logger = {
    setLevel: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
  return {
    default: {
      logger,
      actions: { registerAction: vi.fn() },
      connect: vi.fn(),
    },
  };
});
