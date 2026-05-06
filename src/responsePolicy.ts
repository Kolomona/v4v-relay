export interface ResponsePolicy {
  key: string;
  chance?: number;
  cooldownMs?: number;
  perTargetCooldownMs?: number;
  perUserCooldownMs?: number;
}

export interface ResponseContext {
  user?: string;
  target?: string;
  now?: number;
}

export class ResponsePolicyEngine {
  private lastGlobalResponseMs: Map<string, number> = new Map();
  private lastTargetResponseMs: Map<string, number> = new Map();
  private lastUserResponseMs: Map<string, number> = new Map();

  shouldRespond(policy: ResponsePolicy, context: ResponseContext = {}): boolean {
    const now = context.now ?? Date.now();
    const chance = this.normalizeChance(policy.chance);

    if (this.isGlobalCoolingDown(policy, now)) return false;
    if (this.isTargetCoolingDown(policy, context.target, now)) return false;
    if (this.isUserCoolingDown(policy, context.user, now)) return false;

    if (Math.random() > chance) return false;

    this.recordResponse(policy, context, now);
    return true;
  }

  private normalizeChance(chance: number | undefined): number {
    if (chance === undefined) return 1;
    if (chance <= 0) return 0;
    if (chance >= 1) return 1;
    return chance;
  }

  private isGlobalCoolingDown(policy: ResponsePolicy, now: number): boolean {
    const cooldownMs = policy.cooldownMs;
    if (!cooldownMs || cooldownMs <= 0) return false;

    const last = this.lastGlobalResponseMs.get(policy.key) ?? 0;
    return now - last < cooldownMs;
  }

  private isTargetCoolingDown(policy: ResponsePolicy, target: string | undefined, now: number): boolean {
    const cooldownMs = policy.perTargetCooldownMs;
    if (!cooldownMs || cooldownMs <= 0 || !target) return false;

    const mapKey = `${policy.key}:${target.toLowerCase()}`;
    const last = this.lastTargetResponseMs.get(mapKey) ?? 0;
    return now - last < cooldownMs;
  }

  private isUserCoolingDown(policy: ResponsePolicy, user: string | undefined, now: number): boolean {
    const cooldownMs = policy.perUserCooldownMs;
    if (!cooldownMs || cooldownMs <= 0 || !user) return false;

    const mapKey = `${policy.key}:${user.toLowerCase()}`;
    const last = this.lastUserResponseMs.get(mapKey) ?? 0;
    return now - last < cooldownMs;
  }

  private recordResponse(policy: ResponsePolicy, context: ResponseContext, now: number): void {
    if (policy.cooldownMs && policy.cooldownMs > 0) {
      this.lastGlobalResponseMs.set(policy.key, now);
    }

    if (policy.perTargetCooldownMs && policy.perTargetCooldownMs > 0 && context.target) {
      const mapKey = `${policy.key}:${context.target.toLowerCase()}`;
      this.lastTargetResponseMs.set(mapKey, now);
    }

    if (policy.perUserCooldownMs && policy.perUserCooldownMs > 0 && context.user) {
      const mapKey = `${policy.key}:${context.user.toLowerCase()}`;
      this.lastUserResponseMs.set(mapKey, now);
    }
  }
}

export const responsePolicyEngine = new ResponsePolicyEngine();