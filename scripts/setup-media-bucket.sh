#!/bin/sh
# One-off AWS setup for keeping the site's media in S3 (server/storage.ts): a private bucket and a narrow key for the
# site that can only read, write, list and delete in that bucket. Safe to run again. Run on the server from the site
# folder, with a temporary admin key (delete that key afterwards):
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... sh scripts/setup-media-bucket.sh
# The site's key is written straight into .env (never printed), then the site needs: docker compose up -d --force-recreate
set -eu

REGION=${REGION:-eu-north-1}
ENV_FILE=${ENV_FILE:-.env}
USER_NAME=sawtik-site-media
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# The AWS CLI from its official image, so nothing is installed on the server
aws() { docker run --rm -i -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_DEFAULT_REGION="$REGION" -v "$WORK:/aws" amazon/aws-cli "$@"; }

[ -f "$ENV_FILE" ] || { echo "Run from the site folder ($ENV_FILE not found)"; exit 1; }
ACCOUNT=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')
BUCKET="sawtik-media-$ACCOUNT-$REGION"
echo "Account $ACCOUNT, region $REGION, bucket $BUCKET"

# ---------- Private bucket ----------
if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  if [ "$REGION" = "us-east-1" ]; then aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null; fi
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
# Unfinished uploads are cleaned up; files untouched for a month move to a cheaper tier by themselves
cat > "$WORK/lifecycle.json" <<JSON
{"Rules":[
 {"ID":"abort-uploads","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}},
 {"ID":"tiering","Status":"Enabled","Filter":{"Prefix":""},"Transitions":[{"Days":30,"StorageClass":"INTELLIGENT_TIERING"}]}]}
JSON
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file:///aws/lifecycle.json

# ---------- The site's own key: this bucket only ----------
cat > "$WORK/site.json" <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":"arn:aws:s3:::$BUCKET/*"},
 {"Effect":"Allow","Action":"s3:ListBucket","Resource":"arn:aws:s3:::$BUCKET"}]}
JSON
aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1 || aws iam create-user --user-name "$USER_NAME" >/dev/null
aws iam put-user-policy --user-name "$USER_NAME" --policy-name media --policy-document file:///aws/site.json

if grep -q '^MEDIA_AWS_ACCESS_KEY_ID=' "$ENV_FILE"; then
  echo "$ENV_FILE already has a media key: kept."
else
  KEYS=$(aws iam create-access-key --user-name "$USER_NAME" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text | tr -d '\r')
  printf '\n# Media storage (scripts/setup-media-bucket.sh)\nMEDIA_AWS_ACCESS_KEY_ID=%s\nMEDIA_AWS_SECRET_ACCESS_KEY=%s\n' \
    "$(echo "$KEYS" | awk '{print $1}')" "$(echo "$KEYS" | awk '{print $2}')" >> "$ENV_FILE"
  echo "Media key written to $ENV_FILE"
fi
grep -q '^MEDIA_BUCKET=' "$ENV_FILE" || printf 'MEDIA_BUCKET=%s\nMEDIA_AWS_REGION=%s\n' "$BUCKET" "$REGION" >> "$ENV_FILE"
echo "Done. Next: docker compose up -d --force-recreate, then move the existing files:"
echo "  docker exec sawtik-ai-tts-studio node scripts/migrate-media-to-s3.ts"
