import {
  LambdaWebClient,
  GetResourcePolicyCommand,
  PutResourcePolicyCommand,
  DeleteResourcePolicyCommand,
} from "@aws-sdk/client-lambda-web";

const client = new LambdaWebClient({});
export function originPolicy({ EndpointArn, DistributionArn }) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowCloudFront",
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "lambda:InvokeWebFunctionEndpoint",
        Resource: EndpointArn,
        Condition: { StringEquals: { "aws:SourceArn": DistributionArn } },
      },
      // Identity policies must not let a direct caller bypass the viewer-IP
      // overwrite or any protection on the distribution.
      {
        Sid: "DenyOtherOrigins",
        Effect: "Deny",
        Principal: "*",
        Action: "lambda:InvokeWebFunctionEndpoint",
        Resource: EndpointArn,
        Condition: { StringNotEquals: { "aws:SourceArn": DistributionArn } },
      },
    ],
  };
}
export async function applyPolicy(event, api = client) {
  const resourceArn = event.ResourceProperties.ResourceArn;
  let current;
  try {
    current = await api.send(new GetResourcePolicyCommand({ resourceArn }));
  } catch (error) {
    if (error.name !== "ResourceNotFoundException") throw error;
  }
  if (event.RequestType === "Delete") {
    if (current)
      await api.send(
        new DeleteResourcePolicyCommand({
          resourceArn,
          revisionId: current.revisionId,
        }),
      );
  } else {
    const policy = JSON.stringify(originPolicy(event.ResourceProperties));
    if (current?.policy !== policy)
      await api.send(
        new PutResourcePolicyCommand({
          resourceArn,
          policy,
          ...(current ? { revisionId: current.revisionId } : {}),
        }),
      );
  }
  return resourceArn;
}
export async function handler(event) {
  let status = "SUCCESS";
  let physicalId =
    event.PhysicalResourceId ?? event.ResourceProperties.ResourceArn;
  let reason = "Policy applied";
  try {
    physicalId = await applyPolicy(event);
  } catch (error) {
    status = "FAILED";
    reason = error.name ?? "PolicyError";
  }
  const body = JSON.stringify({
    Status: status,
    Reason: reason,
    PhysicalResourceId: physicalId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: {},
  });
  const response = await fetch(event.ResponseURL, {
    method: "PUT",
    headers: {
      "content-type": "",
      "content-length": String(Buffer.byteLength(body)),
    },
    body,
  });
  if (!response.ok) throw new Error("CloudFormation response failed");
}
