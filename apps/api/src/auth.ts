import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import type { AppConfig } from "./config.js";
import type { StatusRepository } from "./store/types.js";
import ipaddr from "ipaddr.js";
import { resolveEffectiveConfig } from "./settings.js";

export type AuthContext = {
  userId: string;
  username: string;
  isAdmin: boolean;
};

const cookieName = "service_levels_admin_token";

export function signAuthToken(config: AppConfig, context: AuthContext): string {
  return jwt.sign(context, config.jwtSecret, { expiresIn: "12h" });
}

export function readAuthToken(config: AppConfig, token: string | undefined): AuthContext | null {
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, config.jwtSecret) as AuthContext;
  } catch {
    return null;
  }
}

export function getCookieName(): string {
  return cookieName;
}

export function setAuthCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
}

export function clearAuthCookie(reply: FastifyReply): void {
  reply.clearCookie(cookieName, { path: "/" });
}

export function getRequestToken(request: FastifyRequest): string | undefined {
  return request.cookies[cookieName];
}

export function requireAdmin(store: StatusRepository, config: AppConfig) {
  return async function adminGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const context = readAuthToken(config, getRequestToken(request));
    if (!context?.isAdmin) {
      reply.code(401).send({ error: "Admin authentication required" });
      return;
    }

    const user = await store.findUserById(context.userId);
    if (!user || !user.enabled || !user.isAdmin) {
      reply.code(401).send({ error: "Admin authentication required" });
      return;
    }

    request.user = context;
  };
}

export function statusAccessGuard(store: StatusRepository, config: AppConfig) {
  return async function statusGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const effectiveConfig = await resolveEffectiveConfig(config, store);
    if (effectiveConfig.publicAuthMode === "public") {
      return;
    }

    if (effectiveConfig.publicAuthMode === "ip") {
      const ip = request.ip;
      const allowed = effectiveConfig.allowedIpRanges.some((range) => {
        try {
          const parsedRange = ipaddr.parseCIDR(range);
          return ipaddr.parse(ip).match(parsedRange);
        } catch {
          return false;
        }
      });

      if (allowed) {
        return;
      }
    }

    const context = readAuthToken(effectiveConfig, getRequestToken(request));
    if (context) {
      const user = await store.findUserById(context.userId);
      if (user && user.enabled) {
        return;
      }
    }

    reply.code(401).send({ error: "Status access denied" });
  };
}
