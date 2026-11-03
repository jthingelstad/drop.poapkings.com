# Paid alarm retirement

Retire the active-environment warning, overlapping p99 threshold and eight-input DynamoDB SystemErrors alarm. Actual capacity refusals, the sustained p95 latency signal, HTTP/edge 5xx, table throttles and failed-work queues remain. Native metrics and request logs remain available for diagnostics.

Authorized by Jamie on November 1, 2026: keep essential safety checks and retire redundant or non-actionable paid alarms. Restore the previous template by reverting this change. Diagnostics remaining in logs or standard metrics are not automatically healthy; missing samples do not prove success.

## November 3, 2026: one alarm

Authorized by Jamie on November 3, 2026 ("cut CloudWatch alarms to the ~8 listed ... and delete the rest, one PR per repo"): the account keeps alarms only where someone acts on them. This stack keeps `elixir-drop-prod-refresh-age` and removes `elixir-drop-api-errors`, `elixir-drop-api-latency-p95`, `elixir-drop-api-throttles`, `elixir-drop-cr-result-dlq`, `elixir-drop-cr-result-errors`, `elixir-drop-dynamodb-throttles`, `elixir-drop-prod-refresh-dlq`, `elixir-drop-prod-war-clock-stale` and `elixir-drop-web-5xx-rate`. The alarm topic, its subscriptions and the metric filters (`WarClockSaved`, `RequestLatency`) stay; Grafana still charts the metrics. Restore an alarm by reverting this change.
