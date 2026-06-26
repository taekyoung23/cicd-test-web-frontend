# Frontend Deployment Runbook

## Scope

This runbook is for the `frontend-cicd` Jenkins pipeline that deploys the static SecureVoiceGuard frontend to S3 and invalidates CloudFront.

## Quick Checks

1. Open the failed Jenkins build and inspect the failed stage.
2. Check the Jenkins Console Log around the failed stage.
3. Confirm the three static files exist in the workspace:
   - `index.html`
   - `app.js`
   - `style.css`
4. Check whether the files were uploaded to `mzc-securevoiceguard-web-dev`.
5. Check the CloudFront invalidation status for distribution `E2ZAHL4TTM1M8O`.
6. Verify the service URL:
   - `https://mzmt.shop/`
   - `https://mzmt.shop/app.js`
   - `https://mzmt.shop/style.css`

## Stage Guide

### Static File Validation

Check for missing or empty files and required references:

- `index.html` should reference `./style.css`
- `index.html` should reference `./app.js`
- `app.js` should contain `/api/login`
- `app.js` should contain `/api/analysis/request`
- `app.js` should contain `/api/guest`

### S3 Upload

If S3 upload fails, check:

- Jenkins Role permissions
- Bucket name: `mzc-securevoiceguard-web-dev`
- Object paths:
  - `index.html`
  - `app.js`
  - `style.css`

### CloudFront Invalidation

If invalidation fails, check:

- Distribution ID: `E2ZAHL4TTM1M8O`
- Jenkins Role CloudFront permissions
- Invalidation status in the AWS Console

### Post-Deploy Verification

If verification fails, check:

- Whether `https://mzmt.shop/` returns HTTP 200
- Whether the HTML contains `SecureVoiceGuard`
- Whether `app.js` and `style.css` return successfully
- Whether CloudFront cache propagation is still in progress

## Notes

This frontend pipeline deploys only three static files with `aws s3 cp`. It does not use `aws s3 sync --delete`.
