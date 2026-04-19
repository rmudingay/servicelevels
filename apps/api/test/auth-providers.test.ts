import assert from "node:assert/strict";
import test from "node:test";
import { authenticateLogin, authModeLabels, availableAuthModes } from "../src/auth/providers.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory-store.js";

test("auth provider labels and enabled modes reflect config", () => {
  const config = loadConfig({
    PUBLIC_AUTH_MODE: "oidc",
    ADMIN_AUTH_MODES: "local,ldap,saml"
  });

  assert.deepEqual(authModeLabels(), {
    local: "Static account",
    ldap: "LDAP",
    saml: "SAML",
    oauth: "OAuth2",
    oidc: "OpenID Connect"
  });
  assert.deepEqual(availableAuthModes(config), ["local", "ldap", "saml", "oidc"]);
});

test("authenticateLogin supports local auth and rejects incomplete requests", async () => {
  const config = loadConfig({
    ADMIN_AUTH_MODES: "local"
  });
  const store = new MemoryStore(config);

  const user = await authenticateLogin(store, config, {
    mode: "local",
    username: "admin",
    password: "change-me"
  });
  assert.equal(user?.username, "admin");

  const missing = await authenticateLogin(store, config, {
    mode: "local",
    username: "admin"
  });
  assert.equal(missing, null);

  const invalidMode = await authenticateLogin(store, config, {
    mode: "oauth",
    token: "token"
  });
  assert.equal(invalidMode, null);
});

test("authenticateLogin supports base64 SAML assertions", async () => {
  const config = loadConfig({
    ADMIN_AUTH_MODES: "saml"
  });
  const store = new MemoryStore(config);
  const assertion = Buffer.from(
    [
      "<samlp:Response>",
      "<saml:Assertion>",
      "<saml:Subject><saml:NameID>saml-user</saml:NameID></saml:Subject>",
      "<saml:Attribute Name=\"displayName\"><saml:AttributeValue>SAML User</saml:AttributeValue></saml:Attribute>",
      "<saml:Attribute Name=\"mail\"><saml:AttributeValue>saml@example.org</saml:AttributeValue></saml:Attribute>",
      "</saml:Assertion>",
      "</samlp:Response>"
    ].join(""),
    "utf8"
  ).toString("base64");

  const user = await authenticateLogin(store, config, {
    mode: "saml",
    assertion
  });

  assert.equal(user?.username, "saml-user");
  assert.equal(user?.displayName, "SAML User");
  assert.equal(user?.email, "saml@example.org");
  assert.equal(user?.authType, "sso");
});

test("authenticateLogin supports remote introspection and userinfo tokens", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {}));
    calls.push({
      url,
      headers,
      body: typeof init?.body === "string" ? init.body : undefined
    });

    if (url.includes("introspect")) {
      return new Response(
        JSON.stringify({
          active: true,
          preferred_username: "oauth-user",
          name: "OAuth User",
          email: "oauth@example.org"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        preferred_username: "oidc-user",
        name: "OIDC User",
        email: "oidc@example.org"
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const introspectionConfig = loadConfig({
      ADMIN_AUTH_MODES: "oauth",
      REMOTE_INTROSPECTION_URL: "https://idp.example.org/introspect",
      REMOTE_CLIENT_ID: "client-id",
      REMOTE_CLIENT_SECRET: "client-secret"
    });
    const introspectionStore = new MemoryStore(introspectionConfig);
    const oauthUser = await authenticateLogin(introspectionStore, introspectionConfig, {
      mode: "oauth",
      token: "opaque-token"
    });

    assert.equal(oauthUser?.username, "oauth-user");
    assert.match(calls[0]?.headers.authorization ?? "", /^Basic /);
    assert.equal(calls[0]?.body, "token=opaque-token");

    const userinfoConfig = loadConfig({
      ADMIN_AUTH_MODES: "oidc",
      REMOTE_USERINFO_URL: "https://idp.example.org/userinfo"
    });
    const userinfoStore = new MemoryStore(userinfoConfig);
    const oidcUser = await authenticateLogin(userinfoStore, userinfoConfig, {
      mode: "oidc",
      accessToken: "bearer-token"
    });

    assert.equal(oidcUser?.username, "oidc-user");
    assert.equal(calls[1]?.headers.authorization, "Bearer bearer-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authenticateLogin returns null for LDAP when the connector is not configured", async () => {
  const config = loadConfig({
    ADMIN_AUTH_MODES: "ldap"
  });
  const store = new MemoryStore(config);

  const user = await authenticateLogin(store, config, {
    mode: "ldap",
    username: "ldap-user",
    password: "secret"
  });

  assert.equal(user, null);
});
