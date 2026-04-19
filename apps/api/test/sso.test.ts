import assert from "node:assert/strict";
import test from "node:test";
import { browserRedirectModes, buildSsoState, completeBrowserSsoLogin, createBrowserRedirectUrl, getSamlMetadata, isBrowserRedirectMode, parseSsoState, setSsoTestOverrides } from "../src/auth/sso.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory-store.js";

test("SSO helper functions classify redirect modes and preserve trusted return paths", () => {
  const config = loadConfig({
    JWT_SECRET: "test-secret",
    APP_BASE_URL: "https://status.example.org",
    CORS_ORIGIN: "https://status.example.org"
  });

  assert.deepEqual(browserRedirectModes(), ["oidc", "oauth", "saml"]);
  assert.equal(isBrowserRedirectMode("oidc"), true);
  assert.equal(isBrowserRedirectMode("local"), false);

  const token = buildSsoState(config, {
    provider: "oidc",
    target: "status",
    returnTo: "https://evil.example.org/steal"
  });
  const parsed = parseSsoState(config, token);

  assert.ok(parsed);
  assert.equal(parsed?.provider, "oidc");
  assert.equal(parsed?.returnTo, "https://status.example.org/");
  assert.equal(parseSsoState(config, "not-a-token"), null);
});

test("SSO helpers honor test overrides for redirect URL, callback completion, and metadata", async () => {
  const config = loadConfig({
    APP_BASE_URL: "https://status.example.org",
    CORS_ORIGIN: "https://status.example.org"
  });
  const store = new MemoryStore(config);
  const state = buildSsoState(config, {
    provider: "oidc",
    target: "admin",
    returnTo: "https://status.example.org/admin"
  });

  setSsoTestOverrides({
    async createBrowserRedirectUrl() {
      return "https://idp.example.org/authorize";
    },
    async completeBrowserSsoLogin(currentStore) {
      const user = await currentStore.upsertExternalUser({
        username: "override-admin",
        displayName: "Override Admin",
        email: "override@example.org",
        authType: "sso",
        isAdmin: true
      });
      return {
        user,
        returnTo: "https://status.example.org/admin"
      };
    },
    async getSamlMetadata() {
      return "<EntityDescriptor />";
    }
  });

  try {
    const redirectUrl = await createBrowserRedirectUrl(config, "oidc", "admin", "/admin");
    assert.equal(redirectUrl, "https://idp.example.org/authorize");

    const completion = await completeBrowserSsoLogin(store, config, "oidc", state, new URL("https://status.example.org/callback?code=123&state=abc"));
    assert.equal(completion.user.username, "override-admin");
    assert.equal(completion.returnTo, "https://status.example.org/admin");

    const metadata = await getSamlMetadata(config);
    assert.equal(metadata, "<EntityDescriptor />");
  } finally {
    setSsoTestOverrides(null);
  }
});
