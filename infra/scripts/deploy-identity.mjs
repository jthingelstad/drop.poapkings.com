/**
 * Who deploys Drop, in one place (2026-09-26). CI assumes
 * elixir-drop-github-deploy with GitHub's OIDC token from this repository's
 * `production` environment, which admits only `main`; a local deploy runs
 * as AWS_PROFILE=cloud-engineer. The elixir-drop user and its key in .env
 * stay for the Control Room and the referee (credential_process), and no
 * longer carry deployment permissions.
 */

export const GITHUB_REPO = "jthingelstad/drop.poapkings.com";
export const DEPLOY_ROLE = "elixir-drop-github-deploy";
export const DEPLOYMENT_POLICY = "elixir-drop-deployment";

const GITHUB_OIDC = "token.actions.githubusercontent.com";
// The name form and the immutable-id form (owner and repository ids), so a
// change to the repository's OIDC subject setting does not lock CI out.
export const GITHUB_SUBJECTS = [
  `repo:${GITHUB_REPO}:environment:production`,
  "repo:jthingelstad@5351/drop.poapkings.com@1268382394:environment:production",
];

export const githubDeployTrustFor = (accountId) => ({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: {
        Federated: `arn:aws:iam::${accountId}:oidc-provider/${GITHUB_OIDC}`,
      },
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: {
        StringEquals: {
          [`${GITHUB_OIDC}:aud`]: "sts.amazonaws.com",
          [`${GITHUB_OIDC}:sub`]: GITHUB_SUBJECTS,
        },
      },
    },
  ],
});

export function deploymentPolicyFor({
  region,
  accountId,
  stackName,
  bucketName,
  webBucketName,
  executionRoleArn,
}) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "cloudformation:CreateStack",
          "cloudformation:DescribeStackEvents",
          "cloudformation:DescribeStacks",
          "cloudformation:UpdateStack",
        ],
        Resource: `arn:aws:cloudformation:${region}:${accountId}:stack/${stackName}/*`,
      },
      {
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:ListBucket",
          "s3:PutObject",
        ],
        Resource: [
          `arn:aws:s3:::${bucketName}`,
          `arn:aws:s3:::${bucketName}/*`,
        ],
      },
      {
        Effect: "Allow",
        Action: [
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject",
        ],
        Resource: [
          `arn:aws:s3:::${webBucketName}`,
          `arn:aws:s3:::${webBucketName}/*`,
        ],
      },
      {
        Effect: "Allow",
        Action: ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
        Resource: `arn:aws:cloudfront::${accountId}:distribution/*`,
      },
      {
        Effect: "Allow",
        Action: "iam:PassRole",
        Resource: executionRoleArn,
        Condition: {
          StringEquals: {
            "iam:PassedToService": "cloudformation.amazonaws.com",
          },
        },
      },
    ],
  };
}

const STATIC_CREDENTIAL_NAMES = new Set([
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
]);

/** Lift .env settings into the environment, never its static AWS key: that
 *  key is the Control Room's, which has no deployment permission. */
export function applyEnv(values, target = process.env) {
  for (const [key, value] of Object.entries(values)) {
    if (STATIC_CREDENTIAL_NAMES.has(key)) continue;
    if (!target[key]) target[key] = value;
  }
  return target;
}

/** The identities that may deploy and smoke: CI's role, or the local
 *  cloud-engineer profile. */
export const isDeployIdentity = (arn = "") =>
  arn.includes(`:assumed-role/${DEPLOY_ROLE}/`) ||
  arn.includes(":assumed-role/ProjectsCloudEngineer/");
