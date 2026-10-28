#!/bin/sh
# One-off AWS setup for rendering calm / Quran reels in Lambda (see README.md). Safe to run again: existing pieces are
# kept and the function's image is updated. Run from the repo root on a machine with Docker (the production server):
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... REGION=eu-central-1 sh lambda/reel/setup-aws.sh
# The keys must be allowed to create S3 buckets, ECR repositories, IAM roles/users and Lambda functions. At the end
# it prints the lines for the site's .env (a separate, narrow key for the site: invoke this function, read/write
# reels/ in this bucket).
set -eu

REGION=${REGION:-eu-central-1}
# 10240 MB = 6 vCPU; new accounts are capped at 3008 MB (about 2 vCPU) until AWS raises the limit
MEMORY=${MEMORY:-10240}
NAME=sawtik-reel-render
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# The AWS CLI from its official image, so nothing is installed on the server
aws() { docker run --rm -i -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_DEFAULT_REGION="$REGION" -v "$WORK:/aws" amazon/aws-cli "$@"; }

ACCOUNT=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')
BUCKET="sawtik-reels-$ACCOUNT-$REGION"
IMAGE="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$NAME:latest"
echo "Account $ACCOUNT, region $REGION, bucket $BUCKET"

# ---------- S3: private bucket, everything under reels/ deleted after a day ----------
if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  if [ "$REGION" = "us-east-1" ]; then aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null; fi
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
cat > "$WORK/lifecycle.json" <<EOF
{"Rules":[{"ID":"reels-one-day","Status":"Enabled","Filter":{"Prefix":"reels/"},"Expiration":{"Days":1}}]}
EOF
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file:///aws/lifecycle.json

# ---------- Image: build here, push to ECR ----------
aws ecr describe-repositories --repository-names "$NAME" >/dev/null 2>&1 || aws ecr create-repository --repository-name "$NAME" >/dev/null
# Lambda takes a plain single-platform image (no provenance attestation)
docker build --provenance=false --platform linux/amd64 -f lambda/reel/Dockerfile -t "$IMAGE" .
aws ecr get-login-password | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
docker push "$IMAGE"
docker logout "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com" >/dev/null

# ---------- Role the function runs as: logs, and reels/ in the bucket ----------
cat > "$WORK/trust.json" <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
cat > "$WORK/bucket.json" <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"arn:aws:s3:::$BUCKET/reels/*"}]}
EOF
aws iam get-role --role-name "$NAME-role" >/dev/null 2>&1 || {
  aws iam create-role --role-name "$NAME-role" --assume-role-policy-document file:///aws/trust.json >/dev/null
  aws iam attach-role-policy --role-name "$NAME-role" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10 # a new role takes a few seconds before Lambda accepts it
}
aws iam put-role-policy --role-name "$NAME-role" --policy-name reels-bucket --policy-document file:///aws/bucket.json
ROLE_ARN="arn:aws:iam::$ACCOUNT:role/$NAME-role"

# ---------- Function: MEMORY (10 GB = 6 vCPU), 15 minutes, 2 GB of /tmp ----------
if aws lambda get-function --function-name "$NAME" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$NAME" --image-uri "$IMAGE" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$NAME"
  aws lambda update-function-configuration --function-name "$NAME" --memory-size "$MEMORY" >/dev/null
else
  aws lambda create-function --function-name "$NAME" --package-type Image --code "ImageUri=$IMAGE" --role "$ROLE_ARN" \
    --memory-size "$MEMORY" --timeout 900 --ephemeral-storage Size=2048 --architectures x86_64 \
    --environment "Variables={REEL_BUCKET=$BUCKET}" >/dev/null
fi
aws lambda wait function-updated-v2 --function-name "$NAME" 2>/dev/null || aws lambda wait function-active-v2 --function-name "$NAME"
FUNCTION_ARN="arn:aws:lambda:$REGION:$ACCOUNT:function:$NAME"

# ---------- The site's own key: invoke this function, reels/ in this bucket ----------
cat > "$WORK/site.json" <<EOF
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":"lambda:InvokeFunction","Resource":"$FUNCTION_ARN"},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"arn:aws:s3:::$BUCKET/reels/*"}]}
EOF
aws iam get-user --user-name sawtik-site-reels >/dev/null 2>&1 || aws iam create-user --user-name sawtik-site-reels >/dev/null
aws iam put-user-policy --user-name sawtik-site-reels --policy-name reels --policy-document file:///aws/site.json
echo
echo "Concurrent Lambda runs allowed in this account (new accounts may have 10):"
aws lambda get-account-settings --query 'AccountLimit.ConcurrentExecutions' --output text
echo
if [ "${CREATE_SITE_KEY:-1}" = "1" ] && [ "$(aws iam list-access-keys --user-name sawtik-site-reels --query 'length(AccessKeyMetadata)' --output text | tr -d '\r')" = "0" ]; then
  echo "Add to /var/www/sawt/.env, then rebuild the site:"
  aws iam create-access-key --user-name sawtik-site-reels --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text |
    awk '{ print "REEL_AWS_ACCESS_KEY_ID=" $1; print "REEL_AWS_SECRET_ACCESS_KEY=" $2 }'
else
  echo "The site key already exists; .env lines (keep the existing REEL_AWS_ACCESS_KEY_ID / REEL_AWS_SECRET_ACCESS_KEY):"
fi
echo "REEL_LAMBDA_FUNCTION=$NAME"
echo "REEL_BUCKET=$BUCKET"
echo "REEL_AWS_REGION=$REGION"
