# Lead Intelligence: Account Opening Signals

Date: 2026-09-02

Stem Intelligence should treat new restaurant, bar, and off-premise account openings as a source-driven sales workflow, not as part of the ordering engine.

The goal is simple: spot credible opening signals early, create a lead card, suggest the most likely sales rep or team, and let a human assign or dismiss the lead quickly.

## Source Priority

1. City of Phoenix newly received liquor license applications
   - Highest-priority Phoenix signal.
   - Useful because it appears before many openings and carries location/licensing context.
   - Poll every 15 minutes.

2. Arizona Department of Liquor Licenses and Control license search
   - Use as validation and enrichment for license status, type, applicant, city, and county.
   - Poll less frequently or query on demand after a lead appears.

3. Mouth by Southwest
   - High-signal local food and drink source for Phoenix metro openings.
   - Use the public feed at `https://mouthbysouthwest.com/feed/`.
   - Watch labels/headlines such as New Restaurant Alert, Coming soon, New bar alert, opening soon, replacing, taking over, launches, signs lease, and opening date.
   - Some MXSW Insiders posts are subscriber-only. Store public headline/date/source metadata immediately, but only ingest article-body details through legitimate subscriber access.

4. Phoenix New Times Food & Drink
   - Useful for openings, coming-soon roundups, bars/breweries, and restaurant trend stories.
   - Use RSS where possible, plus category-page monitoring.

5. Eater Phoenix
   - Useful for confirmation and notable openings.
   - Usually less early than liquor applications and Mouth by Southwest.

6. Manual account tip
   - Lets reps, buyers, suppliers, and managers enter leads from field chatter.

## License Filtering

The new-license worker should keep every raw license hit, then classify it before it becomes a rep alert.

Use a 30-day alert window by default. Keep 90 days accessible for research, follow-up, and slower buildout/opening cycles.

Default buckets:

- Series 12 Restaurant: hot, on-premise
- Series 6 Bar: hot, on-premise
- Series 10 Beer and Wine Store: hot, off-premise
- Series 9 Liquor Store: separate off-premise bucket, not mixed into restaurant/bar alerts
- Series 7 Beer and Wine Bar: watch, on-premise unless the concept looks especially wine-relevant
- Series 11 Hotel/Motel: watch/hybrid until the restaurant or bar context is clear
- Producer, wholesale, and temporary event licenses: low/noise unless manually watched

Known-chain suppression should override the license bucket. For example, Circle K with a Series 10 license should be stored, classified as off-premise, then suppressed as known convenience-chain noise. A new independent market or bottle shop with Series 10 should stay hot for the off-premise team.

Seed known-chain rules for names like Circle K, QuikTrip, 7-Eleven, Walmart, Target, Walgreens, CVS, Costco, Safeway, Albertsons, Fry's, Bashas, Shell, Chevron, and ARCO. Keep this list editable so real rep feedback can tune it.

## Lead Card

Each lead should capture:

- Account name
- Account channel: on-premise, off-premise, hybrid, production, wholesale, event, unknown
- License series, license type label, and license bucket
- Address, city, ZIP, and territory hint
- Opening status: new signal, researching, qualified, assigned, visited, converted, dismissed
- Latest signal type: liquor license application, coming soon, new opening, opening date, new bar, permit, social post, manual
- Source history with links and timestamps
- Confidence and lead score
- Suggested rep and reason
- Assigned rep, assigned by, and assigned at

## Rep Assignment

Assignment should stay manual.

Stem can suggest a rep based on:

- Existing QuickBooks customer/account run by sales rep
- Whether the lead belongs to the on-premise or off-premise lane
- ZIP/city/territory proximity
- Similar restaurant group or ownership names
- Nearby active accounts
- Historical account ownership if the operator already exists in QuickBooks

The UI should show the suggestion as a nudge, for example:

`Suggested: Alex - owns 14 active accounts within Scottsdale/85251 and two accounts from the same restaurant group.`

The user should still choose Claim, Assign, Reassign, Visit, Dismiss, or Convert.

## Source Access Rules

- Public records and RSS feeds are safe first-class inputs.
- Publication feeds can store headlines, URLs, dates, excerpts, and extracted facts from accessible pages.
- Subscriber-only content should be treated as limited unless Stem has legitimate access.
- Facebook and Instagram should not be scraped directly. Use official APIs, approved social-listening vendors, manual watchlists, or notifications from owned/authorized accounts.

## First Build Slice

1. Apply the lead-intelligence migration.
2. Build a worker that polls `lead_sources` where `enabled = true`.
3. Start with City of Phoenix liquor applications, Mouth by Southwest RSS, Phoenix New Times RSS, and Eater Phoenix RSS.
4. Store every new item in `lead_source_hits`.
5. Extract likely account-opening facts.
6. Classify license series and apply known-chain suppression rules.
7. Deduplicate into `account_opening_leads`.
8. Generate suggested rep from current QuickBooks sales rep/account data and the on-premise/off-premise lane.
9. Notify the team when a lead is hot within the last 30 days or newly assigned.
