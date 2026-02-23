import { logger } from "./logger.js";

/**
 * Alert severity levels
 */
export type AlertSeverity = "info" | "warning" | "error" | "critical";

/**
 * Alert configuration
 */
export interface AlertConfig {
  enabled: boolean;
  channels: AlertChannel[];
  throttleMs: number;
  aggregationWindowMs: number;
}

/**
 * Alert channel interface
 */
export interface AlertChannel {
  name: string;
  send(alert: Alert): Promise<void>;
}

/**
 * Alert structure
 */
export interface Alert {
  id: string;
  name: string;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

/**
 * Alert rule definition
 */
export interface AlertRule {
  name: string;
  description: string;
  severity: AlertSeverity;
  condition: (metrics: Record<string, unknown>) => boolean;
  details: (metrics: Record<string, unknown>) => Record<string, unknown>;
  throttleMs?: number;
}

/**
 * Built-in alert rules
 */
export const BUILTIN_ALERT_RULES: AlertRule[] = [
  {
    name: "high_error_rate",
    description: "Error rate exceeds 5%",
    severity: "warning",
    condition: (m) => {
      const rate = m.errorRate as number;
      return typeof rate === "number" && rate > 0.05;
    },
    details: (m) => ({ errorRate: m.errorRate, threshold: 0.05 }),
    throttleMs: 300000, // 5 minutes
  },
  {
    name: "critical_error_rate",
    description: "Error rate exceeds 20%",
    severity: "critical",
    condition: (m) => {
      const rate = m.errorRate as number;
      return typeof rate === "number" && rate > 0.2;
    },
    details: (m) => ({ errorRate: m.errorRate, threshold: 0.2 }),
    throttleMs: 60000, // 1 minute
  },
  {
    name: "high_response_time",
    description: "P95 response time exceeds 2 seconds",
    severity: "warning",
    condition: (m) => {
      const p95 = m.p95ResponseTime as number;
      return typeof p95 === "number" && p95 > 2000;
    },
    details: (m) => ({ p95ResponseTime: m.p95ResponseTime, threshold: 2000 }),
    throttleMs: 300000,
  },
  {
    name: "pool_exhaustion",
    description: "Database pool utilization exceeds 90%",
    severity: "critical",
    condition: (m) => {
      const util = m.poolUtilization as number;
      return typeof util === "number" && util > 0.9;
    },
    details: (m) => ({ poolUtilization: m.poolUtilization, threshold: 0.9 }),
    throttleMs: 60000,
  },
  {
    name: "pool_degraded",
    description: "Database pool utilization exceeds 70%",
    severity: "warning",
    condition: (m) => {
      const util = m.poolUtilization as number;
      return typeof util === "number" && util > 0.7;
    },
    details: (m) => ({ poolUtilization: m.poolUtilization, threshold: 0.7 }),
    throttleMs: 300000,
  },
  {
    name: "rate_limit_exceeded",
    description: "Rate limit rejections are occurring",
    severity: "warning",
    condition: (m) => {
      const rejected = m.rateLimitRejected as number;
      return typeof rejected === "number" && rejected > 0;
    },
    details: (m) => ({ rateLimitRejected: m.rateLimitRejected }),
    throttleMs: 300000,
  },
  {
    name: "cache_unhealthy",
    description: "Cache service is unhealthy",
    severity: "warning",
    condition: (m) => {
      const healthy = m.cacheHealthy as boolean;
      return healthy === false;
    },
    details: (m) => ({ cacheHealthy: m.cacheHealthy }),
    throttleMs: 300000,
  },
  {
    name: "security_event",
    description: "Security-related event detected",
    severity: "error",
    condition: (m) => {
      const events = m.securityEvents as number;
      return typeof events === "number" && events > 0;
    },
    details: (m) => ({ securityEvents: m.securityEvents }),
    throttleMs: 0, // Always alert immediately
  },
];

/**
 * Alerting service
 */
export class AlertingService {
  private config: AlertConfig;
  private rules: AlertRule[];
  private alertHistory: Map<string, Alert> = new Map();
  private lastAlertTime: Map<string, number> = new Map();

  constructor(config: Partial<AlertConfig> = {}) {
    this.config = {
      enabled: true,
      channels: [],
      throttleMs: 60000,
      aggregationWindowMs: 60000,
      ...config,
    };
    this.rules = [...BUILTIN_ALERT_RULES];
  }

  /**
   * Add an alert channel
   */
  addChannel(channel: AlertChannel): void {
    this.config.channels.push(channel);
  }

  /**
   * Add a custom alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  /**
   * Check metrics against all rules and fire alerts
   */
  async checkMetrics(metrics: Record<string, unknown>): Promise<Alert[]> {
    if (!this.config.enabled) {
      return [];
    }

    const now = Date.now();
    const firedAlerts: Alert[] = [];

    for (const rule of this.rules) {
      try {
        if (rule.condition(metrics)) {
          const alertKey = rule.name;
          const lastAlert = this.lastAlertTime.get(alertKey) || 0;
          const throttleMs = rule.throttleMs ?? this.config.throttleMs;

          // Check if we should throttle this alert
          if (now - lastAlert < throttleMs) {
            continue;
          }

          // Create or update alert
          let alert = this.alertHistory.get(alertKey);
          
          if (!alert || now - new Date(alert.firstSeen).getTime() > this.config.aggregationWindowMs) {
            alert = {
              id: this.generateId(),
              name: rule.name,
              severity: rule.severity,
              message: rule.description,
              details: rule.details(metrics),
              timestamp: new Date().toISOString(),
              count: 1,
              firstSeen: new Date().toISOString(),
              lastSeen: new Date().toISOString(),
            };
          } else {
            alert.count++;
            alert.lastSeen = new Date().toISOString();
            alert.details = rule.details(metrics);
          }

          this.alertHistory.set(alertKey, alert);
          this.lastAlertTime.set(alertKey, now);

          // Fire alert
          await this.fireAlert(alert);
          firedAlerts.push(alert);
        }
      } catch (error) {
        logger.error("Error checking alert rule", error instanceof Error ? error : undefined, {
          rule: rule.name,
        });
      }
    }

    return firedAlerts;
  }

  /**
   * Fire an alert to all channels
   */
  private async fireAlert(alert: Alert): Promise<void> {
    logger.warn(`Alert fired: ${alert.name}`, {
      alert: {
        id: alert.id,
        name: alert.name,
        severity: alert.severity,
        message: alert.message,
        count: alert.count,
      },
    });

    // Send to all channels
    const results = await Promise.allSettled(
      this.config.channels.map((channel) =>
        channel.send(alert).catch((error) => {
          logger.error(`Alert channel ${channel.name} failed`, error instanceof Error ? error : undefined);
          throw error;
        })
      )
    );

    // Log any failures
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error(`Failed to send alert via ${this.config.channels[index].name}`, undefined);
      }
    });
  }

  /**
   * Manually trigger an alert
   */
  async triggerAlert(
    name: string,
    severity: AlertSeverity,
    message: string,
    details: Record<string, unknown> = {}
  ): Promise<Alert> {
    const alert: Alert = {
      id: this.generateId(),
      name,
      severity,
      message,
      details,
      timestamp: new Date().toISOString(),
      count: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    await this.fireAlert(alert);
    return alert;
  }

  /**
   * Get alert history
   */
  getHistory(): Alert[] {
    return Array.from(this.alertHistory.values());
  }

  /**
   * Clear alert history
   */
  clearHistory(): void {
    this.alertHistory.clear();
    this.lastAlertTime.clear();
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Log-based alert channel (writes to logger)
 */
export class LogAlertChannel implements AlertChannel {
  name = "log";

  async send(alert: Alert): Promise<void> {
    const message = `ALERT: ${alert.message}`;
    const metadata = { alert };

    if (alert.severity === "critical" || alert.severity === "error") {
      logger.error(message, undefined, metadata);
    } else if (alert.severity === "warning") {
      logger.warn(message, metadata);
    } else {
      logger.info(message, metadata);
    }
  }
}

/**
 * Webhook alert channel
 */
export class WebhookAlertChannel implements AlertChannel {
  name = "webhook";

  constructor(private url: string, private headers: Record<string, string> = {}) {}

  async send(alert: Alert): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify(alert),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed with status ${response.status}`);
    }
  }
}

/**
 * Slack alert channel
 */
export class SlackAlertChannel implements AlertChannel {
  name = "slack";

  constructor(private webhookUrl: string) {}

  async send(alert: Alert): Promise<void> {
    const color = {
      info: "#36a64f",
      warning: "#ff9900",
      error: "#ff0000",
      critical: "#8b0000",
    }[alert.severity];

    const payload = {
      attachments: [
        {
          color,
          title: `Alert: ${alert.name}`,
          text: alert.message,
          fields: [
            { title: "Severity", value: alert.severity, short: true },
            { title: "Count", value: alert.count.toString(), short: true },
            { title: "First Seen", value: alert.firstSeen, short: true },
            { title: "Last Seen", value: alert.lastSeen, short: true },
          ],
          footer: "Atomic CRM MCP",
          ts: Math.floor(new Date(alert.timestamp).getTime() / 1000),
        },
      ],
    };

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed with status ${response.status}`);
    }
  }
}

/**
 * Singleton alerting instance
 */
let alertingInstance: AlertingService | null = null;

/**
 * Initialize alerting service
 */
export function initializeAlerting(config?: Partial<AlertConfig>): AlertingService {
  if (!alertingInstance) {
    alertingInstance = new AlertingService(config);
    // Add log channel by default
    alertingInstance.addChannel(new LogAlertChannel());
  }
  return alertingInstance;
}

/**
 * Get alerting instance
 */
export function getAlerting(): AlertingService | null {
  return alertingInstance;
}
