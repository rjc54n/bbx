# Arbitrage scanner: EventBridge trigger

Status: written 11 October 2026, **not yet deployed**. The template has been parse-checked only (YAML), not validated by AWS or exercised, because the AWS CLI is not installed on the development machine or the owner's.

## Why

The `BBX Arbitrage Scanner` workflow is scheduled hourly (08:17-23:17 UTC), but GitHub's scheduler is best-effort. Between 8 and 11 October it started only three or four runs a day, at gaps of five to fourteen hours, and pushed some into the small hours (00:50, 01:53, 01:55, 02:09 UTC), which posted to Slack overnight. A genuine misprice could wait most of a working day for its alert.

Two changes:

- **Quiet hours (live).** Scheduled runs that start between 23:00 and 08:00 UK time exit before scanning (`in_quiet_hours` in `apps/arbitrage_bot/run_arbitrage.py`, `2b37fcd`). Manual runs ignore this. Nothing is marked notified while skipped, and the one-day Algolia lookback means the first run after 08:00 picks up overnight listings.
- **Reliable cadence (this file).** An EventBridge rule calls the workflow's `workflow_dispatch` endpoint at :17 every hour from 07:00 to 22:00 UTC. The dispatch passes `inputs.scheduled=true`, which sets `ARBITRAGE_SCHEDULED=1` so the quiet-hours guard applies. The rule is in UTC, so daylight saving needs no handling in AWS; the one trigger a day that lands in quiet hours (22:17 UTC in summer, 07:17 UTC in winter) exits in seconds.

The GitHub cron stays as a backup for now. The workflow's concurrency group stops overlapping runs and the S3 dedup state stops repeat alerts, so the cost of both firing is a redundant scan. Remove the `schedule:` block once EventBridge has run reliably for a week or so.

## Resources

[infra/arbitrage-scheduler.cfn.yml](../infra/arbitrage-scheduler.cfn.yml) is a CloudFormation template creating an EventBridge connection (holds the GitHub token), an API destination (`POST .../actions/workflows/arbitrage.yml/dispatches`, 1 request per second), an invoke role limited to that destination, and the hourly rule with two retries. It needs no other AWS resources and does not touch the S3 state bucket. Deploy it in `eu-west-2` (London), where the S3 state bucket lives, so everything sits in one region; the template does not depend on the bucket's region, so another region would also work.

## Deploying

1. **Create the token.** In GitHub, create a fine-grained personal access token with an expiry of your choosing, repository access limited to `rjc54n/bbx`, and the single permission *Actions: Read and write*. It is a secret: pass it to the deploy command and nowhere else.
2. **Deploy through the console (no AWS CLI needed).** In the AWS console, switch to **Europe (London) eu-west-2**, open **CloudFormation > Create stack > With new resources**, choose *Upload a template file*, and upload `infra/arbitrage-scheduler.cfn.yml`. Name the stack `bbx-arbitrage-scheduler`, paste the token into `GitHubToken` (the other parameters have the right defaults), tick *I acknowledge that AWS CloudFormation might create IAM resources* on the last page, and create the stack. Wait for `CREATE_COMPLETE`. If it ends in `ROLLBACK_COMPLETE`, open the stack's *Events* tab, read the first failed resource's reason, and send it to me; delete the failed stack before retrying.

   The AWS CLI route works too if you install it later:

```bash
aws cloudformation validate-template --region eu-west-2 --template-body file://infra/arbitrage-scheduler.cfn.yml
```

```bash
aws cloudformation deploy --region eu-west-2 --stack-name bbx-arbitrage-scheduler --template-file infra/arbitrage-scheduler.cfn.yml --capabilities CAPABILITY_IAM --parameter-overrides GitHubToken=<token>
```

3. **Verify.** Wait for the next :17 between 08:00 and 22:00 UK time and check that a `BBX Arbitrage Scanner` run appears with event `workflow_dispatch` within a minute or two:

```bash
gh run list --workflow "BBX Arbitrage Scanner" --limit 5
```

   Check three consecutive hours before trusting it, and confirm a Slack alert still arrives for a genuine candidate. If no run appears, look at the rule's failed-invocation metric in CloudWatch and the response code (GitHub returns 204 on success; 401/403 is the token, 404 is the repository or workflow name, 422 is the input).
4. **Quiet-hours check.** The first run each day that lands in quiet hours should log "Quiet hours (23:00-08:00 UK time)" and finish in under a minute.

## Operating

- **Token expiry.** The token expires; renew it by updating the stack (*Update > Use existing template*) with a new `GitHubToken`. A lapsed token makes dispatches fail with 401 and the scanner silently stops (the workflow's own failure alert fires only when it runs). Put the expiry date in a calendar.
- **Pause.** Update the stack in the console with `ScheduleState=DISABLED` (*Update > Use existing template*), or disable the rule under EventBridge > Rules.
- **Remove.** Delete the `bbx-arbitrage-scheduler` stack in the CloudFormation console (or `aws cloudformation delete-stack --region eu-west-2 --stack-name bbx-arbitrage-scheduler`).
- **Cost.** EventBridge rules and API-destination invocations at about 16 a day are negligible. The connection stores the token in a managed Secrets Manager secret; check the current pricing on the account, but it is at most a few cents a month. The repository is public, so Actions minutes are free.

## Open points

- The template has not been validated by AWS. The first deploy may need a correction, most likely in the `Input` string or the header parameters.
- No alert fires if the trigger stops. If that matters, a CloudWatch alarm on the rule's `FailedInvocations` metric, or a Slack message from a run that has not happened in six hours, would close it; neither is built.
