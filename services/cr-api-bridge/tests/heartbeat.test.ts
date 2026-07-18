import { describe, expect, it, vi } from "vitest";
import type { PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import {
  BRIDGE_HEARTBEAT_NAMESPACE,
  publishBridgeHeartbeat,
  publishWarClockHeartbeat,
} from "../src/heartbeat.js";

describe("bridge heartbeat", () => {
  it("publishes the expected CloudWatch metric", async () => {
    const commands: PutMetricDataCommand[] = [];
    const send = vi.fn(async (command: PutMetricDataCommand) => {
      commands.push(command);
      return {};
    });
    const timestamp = new Date("2026-07-18T12:00:00.000Z");

    await publishBridgeHeartbeat({ send } as never, timestamp);

    expect(send).toHaveBeenCalledOnce();
    const command = commands[0];
    expect(command?.input).toEqual({
      Namespace: BRIDGE_HEARTBEAT_NAMESPACE,
      MetricData: [
        {
          MetricName: "Heartbeat",
          Timestamp: timestamp,
          Unit: "Count",
          Value: 1,
        },
      ],
    });
  });

  it("publishes a separate successful war-clock metric", async () => {
    const commands: PutMetricDataCommand[] = [];
    const send = vi.fn(async (command: PutMetricDataCommand) => {
      commands.push(command);
      return {};
    });
    const timestamp = new Date("2026-07-18T12:00:00.000Z");

    await publishWarClockHeartbeat({ send } as never, timestamp);

    expect(commands[0]?.input.MetricData?.[0]).toMatchObject({
      MetricName: "WarClockHeartbeat",
      Timestamp: timestamp,
      Value: 1,
    });
  });
});
