# Reels on AWS Lambda

Calm and Quran reels can be rendered in AWS Lambda instead of on the site's server, so customers do not wait in the
shared render line: each reel gets its own machine (10 GB, 6 vCPU) and any number render at the same time.

## How it works

1. The site uploads the voice (or recitation) to S3: `reels/<job>/voice.wav`.
2. It invokes the function `sawtik-reel-render` with the render options (scenes, captions, style, sticker…).
3. The function runs the same renderer as the site (`server/calm-render.ts`, bundled with `bootstrap.ts`), downloads
   the scenes from Pixabay, and writes `reels/<job>/reel.mp4` to S3.
4. The customer's page streams the reel from S3 through a 30-minute signed link (`/api/video/jobs/:id/file`
   redirects there); «تحميل» uses the same link with a download name.
5. If Lambda fails for any reason the reel is made on the site's server instead (and refunded if that fails too).
6. Everything under `reels/` is deleted by S3 after a day.

Medical reels (they carry the doctor's logo) always render on the server.

Admin → الإعدادات والتسعير → «تجهيز ريلز الآيات والسكينة على AWS Lambda»: never / when the server is busy / always.
Nothing goes to AWS until the function and bucket are configured in `.env` and this is switched on.

## Setup (once, on the production server)

```sh
cd /var/www/sawt
AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… REGION=eu-central-1 sh lambda/reel/setup-aws.sh
```

It creates (or updates): the private bucket `sawtik-reels-<account>-<region>` with the one-day rule, the ECR
repository and image, the function's role, the function (10240 MB, 900 s, 2 GB /tmp, x86_64), and a narrow IAM user
`sawtik-site-reels` for the site. It prints the `.env` lines:

```
REEL_AWS_ACCESS_KEY_ID=…
REEL_AWS_SECRET_ACCESS_KEY=…
REEL_LAMBDA_FUNCTION=sawtik-reel-render
REEL_BUCKET=sawtik-reels-…
REEL_AWS_REGION=eu-central-1
```

Then rebuild the site (`docker compose build && docker compose up -d`) and pick the mode in the admin settings.
To ship a new renderer later, run the same script again (it rebuilds and updates the image).

## Cost (AWS list prices, eu-central-1, x86)

| Item | Per 45 s reel |
| --- | --- |
| Lambda: 10 GB × ~70 s = 700 GB-s × $0.0000166667 | ~$0.012 |
| S3 requests and one day of storage | < $0.0001 |
| S3 transfer out to the customer (~11 MB × $0.09/GB) | ~$0.001 |
| **Total** | **~1.3 cents** |

Lambda's free tier (400,000 GB-s a month, shared with the motion renders) covers roughly 500 reels a month.
ECR keeps the ~0.5 GB image for about $0.05 a month. The render time on Lambda is an estimate until measured.

Check in the AWS console: Service Quotas → Lambda → *Concurrent executions* (new accounts may be limited to 10).

## Testing without AWS

`REEL_LOCAL_DIR=<folder>` makes the handler read and write that folder instead of S3; the bundle
(`esbuild lambda/reel/bootstrap.ts --bundle --platform=node --format=cjs --external:sharp`) can then be run against
a stand-in Runtime API. This is how the image's code was checked before any AWS setup.
