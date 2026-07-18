import {
  PutMetricDataCommand,
  type CloudWatchClient,
} from "@aws-sdk/client-cloudwatch";

export const BRIDGE_HEARTBEAT_NAMESPACE = "ElixirDrop/CRBridge";

export async function publishBridgeHeartbeat(
  cloudWatch: Pick<CloudWatchClient, "send">,
  timestamp: Date = new Date(),
): Promise<void> {
  await cloudWatch.send(
    new PutMetricDataCommand({
      Namespace: BRIDGE_HEARTBEAT_NAMESPACE,
      MetricData: [
        {
          MetricName: "Heartbeat",
          Timestamp: timestamp,
          Unit: "Count",
          Value: 1,
        },
      ],
    }),
  );
}
