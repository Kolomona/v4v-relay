# Helipad Webhook Capture

Captured from remote container logs on 2026-05-06 01:58:56 UTC after redeploy.

## Webhook Raw Body

```json
{
  "direction": "incoming",
  "index": 99999,
  "time": 1778032736,
  "value_msat": 100000,
  "value_msat_total": 100000,
  "action": 2,
  "list_type": "boost",
  "sender": "Test Sender",
  "app": "Helipad",
  "message": "This is a test trigger message",
  "podcast": "Test Podcast",
  "episode": "Test Episode",
  "tlv": "{\"action\":\"boost\",\"app_name\":\"Helipad\",\"app_version\":\"0.2.2\",\"episode\":\"Test Episode\",\"message\":\"This is a test trigger message\",\"podcast\":\"Test Podcast\",\"sender_name\":\"Test Sender\",\"value_msat\":100000,\"value_msat_total\":100000}",
  "remote_podcast": null,
  "remote_episode": null,
  "reply_sent": false,
  "custom_key": null,
  "custom_value": null,
  "memo": null,
  "payment_info": null
}
```

## Webhook Parsed Body

```json
{
  "direction": "incoming",
  "index": 99999,
  "time": 1778032736,
  "value_msat": 100000,
  "value_msat_total": 100000,
  "action": 2,
  "list_type": "boost",
  "sender": "Test Sender",
  "app": "Helipad",
  "message": "This is a test trigger message",
  "podcast": "Test Podcast",
  "episode": "Test Episode",
  "tlv": "{\"action\":\"boost\",\"app_name\":\"Helipad\",\"app_version\":\"0.2.2\",\"episode\":\"Test Episode\",\"message\":\"This is a test trigger message\",\"podcast\":\"Test Podcast\",\"sender_name\":\"Test Sender\",\"value_msat\":100000,\"value_msat_total\":100000}",
  "remote_podcast": null,
  "remote_episode": null,
  "reply_sent": false,
  "custom_key": null,
  "custom_value": null,
  "memo": null,
  "payment_info": null
}
```

## Webhook Headers

```json
{
  "content-type": "application/json",
  "user-agent": "Helipad/0.2.2",
  "authorization": "Bearer [REDACTED]",
  "accept": "*/*",
  "host": "104.248.14.255:7777",
  "content-length": "748"
}
```

## Formatted Output Seen In App Logs

```text
From webserver: 100 sats from Test Sender via Helipad | Test Episode | null | 04"This is a test trigger message"00
```
