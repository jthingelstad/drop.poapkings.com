import {
  PutMetricDataCommand,
  type CloudWatchClient,
} from "@aws-sdk/client-cloudwatch";

export const BRIDGE_HEARTBEAT_NAMESPACE = "ElixirDrop/CRBridge";

async function publishHeartbeat(
  cloudWatch: Pick<CloudWatchClient, "send">,
  metricName: "Heartbeat" | "WarClockHeartbeat",
  timestamp: Date,
): Promise<void> {
  await cloudWatch.send(
    new PutMetricDataCommand({
      Namespace: BRIDGE_HEARTBEAT_NAMESPACE,
      MetricData: [
        {
          MetricName: metricName,
          Timestamp: timestamp,
          Unit: "Count",
          Value: 1,
        },
      ],
    }),
  );
}

export async function publishBridgeHeartbeat(
  cloudWatch: Pick<CloudWatchClient, "send">,
  timestamp: Date = new Date(),
): Promise<void> {
  await publishHeartbeat(cloudWatch, "Heartbeat", timestamp);
}

export async function publishWarClockHeartbeat(
  cloudWatch: Pick<CloudWatchClient, "send">,
  timestamp: Date = new Date(),
): Promise<void> {
  await publishHeartbeat(cloudWatch, "WarClockHeartbeat", timestamp);
}
