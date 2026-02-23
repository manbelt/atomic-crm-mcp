import { decodeJwt, SignJWT, jwtVerify } from "jose";
import { logger } from "./logger.js";
import { config } from "../config.js";

/**
 * Session data structure
 */
export interface SessionData {
  userId: string;
  email: string;
  role: string;
  companyId?: string;
  permissions: string[];
  metadata: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  secretKey: string;
  issuer: string;
  audience: string;
  expiresIn: number; // seconds
  algorithm: "HS256" | "HS384" | "HS512";
}

/**
 * Default session configuration
 */
export const DEFAULT_SESSION_CONFIG: Partial<SessionConfig> = {
  issuer: "atomic-crm",
  audience: "atomic-crm-api",
  expiresIn: 3600, // 1 hour
  algorithm: "HS256",
};

/**
 * Stateless session manager using JWT
 * Designed for horizontal scaling - no server-side session storage required
 */
export class StatelessSessionManager {
  private secretKey: Uint8Array;
  private config: SessionConfig;

  constructor(config: Partial<SessionConfig> & { secretKey: string }) {
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config } as SessionConfig;
    this.secretKey = new TextEncoder().encode(this.config.secretKey);
  }

  /**
   * Create a new session token
   */
  async createSession(data: Omit<SessionData, "createdAt" | "expiresAt">): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const sessionData: SessionData = {
      ...data,
      createdAt: now,
      expiresAt: now + this.config.expiresIn,
    };

    try {
      const token = await new SignJWT({ ...sessionData })
        .setProtectedHeader({ alg: this.config.algorithm })
        .setIssuedAt(now)
        .setIssuer(this.config.issuer)
        .setAudience(this.config.audience)
        .setExpirationTime(now + this.config.expiresIn)
        .setSubject(data.userId)
        .sign(this.secretKey);

      logger.info("Session created", { userId: data.userId, expiresAt: sessionData.expiresAt });
      return token;
    } catch (error) {
      logger.error("Failed to create session", error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Verify and decode a session token
   */
  async verifySession(token: string): Promise<SessionData | null> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      });

      // Validate required fields
      if (!payload.sub || !payload.userId || !payload.email) {
        logger.warn("Invalid session payload - missing required fields");
        return null;
      }

      return {
        userId: payload.userId as string,
        email: payload.email as string,
        role: payload.role as string,
        companyId: payload.companyId as string | undefined,
        permissions: payload.permissions as string[] || [],
        metadata: payload.metadata as Record<string, unknown> || {},
        createdAt: payload.createdAt as number,
        expiresAt: payload.exp as number,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "JWTExpired") {
          logger.debug("Session token expired");
        } else {
          logger.warn("Session verification failed", { error: error.message });
        }
      }
      return null;
    }
  }

  /**
   * Refresh a session token (extend expiration)
   */
  async refreshSession(token: string): Promise<string | null> {
    const session = await this.verifySession(token);
    
    if (!session) {
      return null;
    }

    // Create new session with same data but fresh expiration
    return this.createSession({
      userId: session.userId,
      email: session.email,
      role: session.role,
      companyId: session.companyId,
      permissions: session.permissions,
      metadata: session.metadata,
    });
  }

  /**
   * Revoke a session (for stateless JWT, this requires a blocklist)
   * Note: For full revocation support, use Redis blocklist
   */
  async revokeSession(_token: string): Promise<boolean> {
    // Stateless JWTs cannot be truly revoked without a blocklist
    // This is a placeholder for integration with a Redis blocklist
    logger.warn("Session revocation called but no blocklist configured");
    return true;
  }

  /**
   * Extract session from Authorization header
   */
  extractSessionFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      return null;
    }

    return parts[1];
  }

  /**
   * Get session from request
   */
  async getSessionFromRequest(authHeader: string | undefined): Promise<SessionData | null> {
    const token = this.extractSessionFromHeader(authHeader);
    
    if (!token) {
      return null;
    }

    return this.verifySession(token);
  }
}

/**
 * Session blocklist for revocation support (requires Redis)
 */
export interface SessionBlocklist {
  add(token: string, expiresAt: number): Promise<void>;
  has(token: string): Promise<boolean>;
  cleanup(): Promise<void>;
}

/**
 * Redis-based session blocklist
 */
export class RedisSessionBlocklist implements SessionBlocklist {
  private prefix = "session-blocklist:";

  constructor(private redis: {
    setex: (key: string, seconds: number, value: string) => Promise<unknown>;
    exists: (key: string) => Promise<number>;
    keys: (pattern: string) => Promise<string[]>;
    del: (key: string) => Promise<number>;
  }) {}

  /**
   * Add token to blocklist
   */
  async add(token: string, expiresAt: number): Promise<void> {
    const ttl = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
    const key = `${this.prefix}${this.hashToken(token)}`;
    await this.redis.setex(key, ttl, "1");
  }

  /**
   * Check if token is blocklisted
   */
  async has(token: string): Promise<boolean> {
    const key = `${this.prefix}${this.hashToken(token)}`;
    const result = await this.redis.exists(key);
    return result === 1;
  }

  /**
   * Clean up expired entries (Redis handles this automatically with TTL)
   */
  async cleanup(): Promise<void> {
    // Redis TTL handles cleanup automatically
  }

  /**
   * Hash token for storage (don't store raw tokens)
   */
  private hashToken(token: string): string {
    // Simple hash - in production use crypto.subtle.digest
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

/**
 * Singleton session manager instance
 */
let sessionManager: StatelessSessionManager | null = null;

/**
 * Initialize the session manager
 */
export function initializeSessionManager(secretKey: string, config?: Partial<SessionConfig>): StatelessSessionManager {
  if (!sessionManager) {
    sessionManager = new StatelessSessionManager({ secretKey, ...config });
  }
  return sessionManager;
}

/**
 * Get the session manager instance
 */
export function getSessionManager(): StatelessSessionManager | null {
  return sessionManager;
}
