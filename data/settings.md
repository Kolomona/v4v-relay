# Runtime Settings

The `settings.json` file controls bot behavior at runtime without requiring code changes or redeploys.

## Location

`data/settings.json` is mounted into the container at `/app/data/settings.json` and read at runtime.

## Reloading Settings

The bot caches settings on first read. To apply changes to `settings.json`:

1. **Local development**: Restart the bot or call `getRuntimeSettings()` to refresh
2. **Production**: Modify the file and restart the container

The deploy script preserves existing `settings.json` files on remote hosts, so settings persist across deployments.

## Karma Response Settings

The `karmaResponse` section controls how the bot responds to `++` and `--` messages.

### Parameters

#### `chance` (number, default: 0.3)
Probability of responding to any karma message. Range: `0` (never) to `1` (always).
- `0.2` = 20% chance of responding
- `0.5` = 50% chance of responding
- `1.0` = always respond (no randomness)

#### `cooldownMs` (number, default: 25000)
Global cooldown between ANY karma responses in milliseconds.
- Prevents the bot from responding too frequently across all channels
- Value of `25000` = 25 seconds between responses

#### `perTargetCooldownMs` (number, default: 60000)
Per-channel/target cooldown in milliseconds. Each unique target (channel) gets its own cooldown timer.
- Prevents the bot from responding too frequently in the same channel
- Value of `60000` = 60 seconds before the same channel sees another karma response
- Works independently from global cooldown (bot waits for both to expire)

#### `perUserCooldownMs` (number, default: 0)
Per-user cooldown in milliseconds. Each unique user who triggered a karma message gets their own cooldown timer.
- Prevents the same user from repeatedly triggering responses
- Value of `0` (default) = disabled
- Example: `30000` = 30 seconds before the same user can trigger another response
- Works independently from global and per-target cooldowns

## Example: Tuning Response Rates

### Conservative (less spam)
```json
{
  "karmaResponse": {
    "chance": 0.1,
    "cooldownMs": 60000,
    "perTargetCooldownMs": 120000,
    "perUserCooldownMs": 45000
  }
}
```

### Moderate (balanced)
```json
{
  "karmaResponse": {
    "chance": 0.2,
    "cooldownMs": 25000,
    "perTargetCooldownMs": 60000,
    "perUserCooldownMs": 0
  }
}
```

### Aggressive (more fun)
```json
{
  "karmaResponse": {
    "chance": 0.5,
    "cooldownMs": 5000,
    "perTargetCooldownMs": 15000,
    "perUserCooldownMs": 0
  }
}
```

## How Cooldowns Work Together

When a karma response is triggered, the bot checks ALL cooldowns:

1. **Global cooldown**: Has 25 seconds passed since any response?
2. **Per-target cooldown**: Has 60 seconds passed for this specific channel?
3. **Per-user cooldown** (if enabled): Has 30 seconds passed for this specific user?

If ANY cooldown is still active, the response is skipped. The random chance check happens only after all cooldowns pass.

## Future Extensions

The response policy engine in `src/responsePolicy.ts` is designed to be reusable. Other bot features can opt into the same rate-limiting system by:

1. Creating a `ResponsePolicy` with appropriate settings
2. Calling `responsePolicyEngine.shouldRespond(policy, context)`
3. Optionally adding settings to `settings.json` under a new key
