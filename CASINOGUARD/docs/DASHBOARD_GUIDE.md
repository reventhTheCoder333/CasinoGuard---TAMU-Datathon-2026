# CASINOGUARD dashboard guide

This guide explains everything you can see on the CASINOGUARD screen: what each item means, where its value comes from, and how to read it correctly.

**Two things apply to the whole screen:**

- **The data is synthetic.** Seeded and simulated records are generated and don't describe real people or transactions.
- **An alert is a suspicious indicator, not proof of wrongdoing.** It means a pattern matched a detector's rules. A qualified analyst must review it before any action is taken.

## Local mode and Databricks mode

The dashboard runs in one of two modes.

- **Local mode** (the default): CASINOGUARD runs its own six detectors on synthetic data, and the left panel is the simulator. Most of this guide describes this mode.
- **Databricks mode:** detection results are read from Databricks and the dashboard is read-only. The differences are listed in the Databricks mode section at the end of this guide.

## Screen layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. Header: name, notice, Synthetic data badge, connection status     │
├──────────────────────────────────────────────────────────────────────┤
│ 2. Summary tiles: alerts, flagged accounts, transactions, volume     │
├────────────┬───────────────────────────────────────┬─────────────────┤
│ 3.         │ 4. Transaction network graph          │ 6. Alerts       │
│ Simulator  │                                       │                 │
│            ├───────────────────────────────────────┤                 │
│            │ 5. Transaction stream                 │                 │
└────────────┴───────────────────────────────────────┴─────────────────┘
  7. The investigation panel slides in from the right when you open an alert.
```

On screens narrower than 1,240 pixels, the panels stack and the page scrolls.

---

## 1. Header

| Item | What it means |
|---|---|
| **CASINOGUARD · Financial intelligence** | The product name. |
| **Alerts are suspicious indicators, not proof of wrongdoing.** | A permanent reminder of how to treat every alert. It's hidden on narrower screens, but the same notice appears in every investigation panel. |
| **Synthetic data** | Reminds you that the demo runs on generated data. Hover over it for more detail. It stays on even if someone submits a transaction through the API, so check the **Source** column in the transaction stream for individual records. |
| **Connection status** | The state of the live link to the backend (see below). |

| Status | Dot | Meaning |
|---|---|---|
| **Connecting** | Grey | The page has just opened and is connecting for the first time. |
| **Live** | Green | Connected. Transactions and alerts appear as they happen. |
| **Reconnecting** | Amber | The connection dropped. The page retries automatically, waiting up to 10 seconds between tries, and reloads all data once it's back. The numbers on screen may be out of date until then. |

### Red banners

These appear under the header only when something is wrong.

| Banner | Meaning | What to do |
|---|---|---|
| **Can't load data from the API** | The dashboard couldn't get data from the backend. | Check that the backend is running on port 8000. |
| **Detection is degraded** | One or more detectors failed on the last run and may be missing alerts. The banner names them. The other detectors keep working. | Check the backend logs. Don't treat a lack of alerts from the named detector as a clean result. |

---

## 2. Summary tiles

The tiles update after every transaction. The example values are what you see straight after starting or resetting the demo.

| Tile | Example | What it counts |
|---|---|---|
| **Open alerts** | 6 (3 high priority) | All alerts on record. The small text shows how many are high priority. The demo has no way to close an alert, so this only goes down when you reset the demo or when alerts merge. |
| **Flagged accounts** | 12 of 15 known accounts | Different accounts named in at least one alert. "Known accounts" means every account seen in a profile or transaction, excluding the casino and its cages. |
| **Transactions analysed** | 49 | All transactions in memory. The six detectors run again each time a transaction arrives or an account is registered. |
| **Synthetic volume** | $61,650 | The sum of every transaction amount. |

**How to read the volume figure:** it measures activity, not money held or lost. The same money can count several times, for example as a deposit, then a wager, then a withdrawal. If someone submits transactions through the API, those amounts are included too.

---

## 3. Simulator panel (left)

The simulator generates demo activity. It only creates transactions and account records, and these go through the same pipeline as real submissions. **The simulator never creates alerts: the detectors decide.**

### Controls

| Control | What it does |
|---|---|
| **Run all six scenarios** | Runs the six scenarios in order, which takes about 30 seconds. It's disabled while a run is in progress. |
| **Normal background traffic** | Sends ordinary player activity about once every 2 seconds: deposits, wagers and modest withdrawals from 12 players. This activity is designed not to trigger alerts. A player who reaches the hourly deposit limit sits out for a while, so the "sent" count can pause briefly. |
| **Scenarios list** | Click one to run only that scenario. They're disabled while a run is in progress. |
| **Stop** | Stops the current run and background traffic. Records already sent stay in place. It's disabled when nothing is running. |
| **Reset demo** | Restores the original seed data straight away, with no confirmation. It discards all simulated activity, alerts and API submissions. Alert numbers start again from CG-0001. |

### The six scenarios

| Scenario | Icon colour | What it generates | Target detector |
|---|---|---|---|
| **Layered transfer chain** | Blue | Transfers of $12,000, $11,700, $11,350 and $11,050 through five accounts, 4 minutes apart. | Suspicious chains |
| **Split cage deposits** | Orange | Deposits of $4,200, $3,800, $3,100 and $2,900 at four cages, 13 minutes apart. | Structuring |
| **Deposit and quick cash-out** | Green | A $9,500 deposit, a $150 wager, then a $9,200 withdrawal, all within 14 minutes. | Rapid cash-outs |
| **Sudden activity spike** | Amber | 17 wagers spread over the past 7 days, then 18 more today. | Unusual volume |
| **Funds in a loop** | Pink | Transfers of $7,500, $7,300 and $7,050 around three accounts, ending back at the first. | Circular flows |
| **Linked identities** | Violet | Three new accounts, where A and B share a phone number and A and C share a payment card, each followed by a small deposit. | Multiple accounts |

Some alerts appear before a scenario finishes, then update. For example, the chain alert appears at the third hop and grows when the fourth arrives.

**About the timestamps:** scenarios are spaced in simulated minutes but sent in seconds, and the activity spike's history is backdated. The times on screen are therefore the times of the simulated events, not when they reached the system.

### Run results

This section appears after the first run and lists up to 12 runs, most recent first.

| Item | Meaning |
|---|---|
| **Queued** | Waiting for an earlier scenario to finish. |
| **3/5** with a progress bar | Running: 3 of 5 records sent so far. |
| **Finished** | All records were sent. |
| **Stopped** | You stopped the run before it finished. |
| **Failed** | An error stopped the run. The message appears under it. |
| **CG-0007 4-hop chain…** | An alert the detectors actually raised during this run. Click it to investigate. The title reflects the alert when it was first raised, so it can differ from the latest version in the alert feed. |
| **The detectors raised no alert for this run.** | The run finished but no new alert was raised. This is a real result and isn't hidden. |

### Integrations

| Status | Meaning |
|---|---|
| **Not configured** | Credentials for Databricks or SerpApi haven't been set, so the integration makes no network calls. |
| **Configured** | The required credentials are set. This doesn't confirm that the credentials work. |
| **CSV export** | Tableau can use the CSV files below. Direct publishing to Tableau isn't built. |

**alerts.csv** and **transactions.csv** download the current data for use in Tableau or a spreadsheet.

---

## 4. Transaction network graph (centre)

The graph shows who transacted with whom. Each circle or square is an account, and each line is a relationship between two accounts.

### Nodes (accounts)

| Appearance | Meaning |
|---|---|
| **Small grey circle** | An account with no alerts. |
| **Dark circle with a coloured ring and centre dot** | An account named in at least one alert. The ring colour shows the detector. |
| **Ring split into segments** | Several detectors flagged this account, with one segment for each. Treat this as a prompt to look closer, not as a stronger finding in itself. |
| **Grey square** | One of the casino's own accounts. The larger one is `CASINO` and the smaller ones are cages (`CAGE001` and so on). |
| **Bigger circle** | More money passed through the account. The scale is logarithmic and capped, so size only gives a rough idea. Use the details card for exact figures. |
| **Amber rings pulsing outward** | The account is part of an alert raised in the last 6 seconds. |
| **White outline** | The node you clicked. |

### Detector colours

| Colour | Detector |
|---|---|
| Blue | Suspicious chains |
| Orange | Structuring |
| Green | Rapid cash-outs |
| Amber | Unusual volume |
| Pink | Circular flows |
| Violet | Multiple accounts |

The same colours and icons appear on the alert filter buttons, which also act as a key to the graph.

### Lines

| Appearance | Meaning |
|---|---|
| **Pale line with an arrow** | Money flowed in the arrow's direction. |
| **Coloured line with an arrow** | The flow includes a transaction that's evidence in an alert. If several alerts share it, the colour comes from just one of them. |
| **Thicker line** | A larger total amount, on a logarithmic and capped scale. |
| **Two curved lines between the same accounts** | Money flowed in both directions. Each line is one direction. |
| **Dashed violet line** | The two accounts share a phone number, email or payment card. No money is implied. |
| **White dot moving along a line** | A new transaction just arrived on that link. |

### Labels

- Flagged accounts and `CASINO` are always labelled. Other accounts get labels when you zoom in.
- When zoomed out, simulated accounts drop their run prefix, so `SIM001_CHAIN_A` shows as `CHAIN_A`. This means two nodes can look alike. Zoom in or click a node to see its full name.
- The **legend** along the bottom of the graph summarises these symbols.

### Controls and interactions

| Control | What it does |
|---|---|
| **Find account…** | Finds an account by full or partial name, then centres on and selects it. Press Enter to search. A red border means nothing matched. |
| **Flagged only** | Shows only flagged accounts and the links that are evidence in alerts. The casino or a cage appears only if one of those links uses it. |
| **Hide casino** | Removes the casino and cages so that person-to-person patterns stand out. It also hides all deposits, wagers and withdrawals, because they run through those accounts. |
| **Fit** | Zooms to show everything. |
| **Scroll / drag the background** | Zooms and pans. |
| **Drag a node** | Moves it. Layout positions have no meaning, so distance between nodes doesn't represent anything. |
| **Hover** | Shows a short summary: for a node, its transactions and total volume; for a link, its count and amount (`3 × · $14.7k`) or the shared identifier. |
| **Click a node or line** | Opens a details card at the top left of the graph. |
| **Click an empty area** | Closes the details card and clears any alert focus. |

### Details card

| Field | Meaning |
|---|---|
| **Transactions** | For a node, all transactions it sent or received. For a line, the transactions on that link and direction. |
| **Sent / Received** | Total money out of and into the account. |
| **Total** | Total money on that link and direction. |
| **Alert list** | Alerts that involve this node or line. Click one to investigate. If there are none, it says so. `CASINO` normally shows none because it's excluded from being flagged. |

### Alert focus

When you open an alert, the graph dims everything else and a **Showing CG-0007 · Clear** label appears at the top. The bright parts are the alert's accounts and the links carrying its transactions. The casino or a cage may be bright because a transaction passed through it, not because it was flagged.

---

## 5. Transaction stream (centre, below the graph)

This table lists the most recent transactions, newest first. A brief blue flash marks the newest row. The heading shows how many are listed out of the total, for example "Latest 49 of 49". The table holds at most 80 rows, and the full list is available through `/api/transactions` or `transactions.csv`.

| Column | Meaning |
|---|---|
| **Time** | When the transaction happened, as month-day and time in **UTC**. |
| **ID** | The transaction's unique ID. |
| **Flagged** tag | The transaction is named as direct evidence in a chain, structuring, circular or cash-out alert. See the note below. |
| **Flow** | Sender → receiver. |
| **Type** | See the table below. |
| **Amount** | Shown in whole dollars. |
| **Source** | Where the record came from: **Seed** (starting synthetic data), **Simulated** (the simulator) or **API** (submitted through the API, with unverified origin). |

| Type | Meaning | Direction |
|---|---|---|
| **Deposit** | Funds paid in. | Customer → casino or cage |
| **Wager** | A bet. | Customer → casino |
| **Withdrawal** | Funds paid out. | Casino → customer |
| **Transfer** | Money moved directly between accounts. | Account → account |

**A missing "Flagged" tag doesn't mean a transaction is unrelated to an alert.** Unusual volume and multiple-account alerts work from counts and account links, so their transactions aren't tagged, and neither are the wagers considered in a cash-out alert. The investigation panel's timeline shows the full set for each alert.

---

## 6. Alerts panel (right)

### Filters

- **All / High / Medium** limits the list by priority.
- **The six detector buttons** limit the list to one detector. Click the active one again to clear it. Each number is that detector's total alert count, and it doesn't change when you apply the priority filter.

### What each detector looks for

The limits are the detectors' current default settings. They're illustrative, and aren't tuned to real data or any specific regulation.

| Detector | Pattern | Conditions for an alert |
|---|---|---|
| **Suspicious chains** | Similar amounts passing through a line of accounts, which can be a sign of layering. | 3–5 hops in time order, within 15 minutes, with the smallest amount at least 80% of the largest. |
| **Structuring** | Several smaller funding transactions that together cross a threshold. | 3 or more transactions, each under $10,000, totalling at least $10,000 within 60 minutes. Excludes wagers and casino payouts. |
| **Rapid cash-outs** | Money deposited and withdrawn with little play. | Within 60 minutes of a deposit: at least 80% withdrawn and at most 20% wagered. |
| **Unusual volume** | An account far busier than usual. | A day's transaction count at least 3 standard deviations above the account's earlier active days, with at least 7 days of history. |
| **Circular flows** | Money looping back to where it started. | A loop of 3–6 accounts. There's no time limit, so the transfers may be far apart. |
| **Multiple accounts** | Separate accounts that appear connected. | 2 or more accounts linked by a shared phone number, email or payment card, directly or through another account. |

Chain and circular detection ignore paths through the casino and cages, since those accounts touch nearly everyone.

### Alert card

| Item | Meaning |
|---|---|
| **High priority** (triangle) / **Medium priority** (circle) | Suggested review order. See the rules below. |
| **"51s ago"** | When the alert was last updated. For seed alerts, this counts from when the server started or the demo was reset. |
| **Title and summary** | Written from the detector's actual values. The summary is cut to two lines; the investigation panel has the full text. |
| **Icon and detector name** | The detector that raised the alert. |
| **Dollar amount** | The amount involved: total moved for chains, structuring and circular flows, or the deposit for cash-outs. Volume and multiple-account alerts show no amount. |
| **Updated ×2** | New evidence has changed the alert twice since it was raised. |
| **CG-0007** | The alert's ID, in the order raised. New alerts appear at the top. |

A **new alert** slides in with a brief amber glow. A selected alert has a blue outline.

### How priority is set

**Priority sets review order only. It isn't a risk score or a measure of guilt.** It comes from these fixed rules, and each investigation panel states the reason for its alert.

| Detector | High priority when | Otherwise |
|---|---|---|
| Suspicious chains | 4 or more hops, or $25,000 or more in total | Medium |
| Structuring | $25,000 or more in total | Medium |
| Rapid cash-outs | At least 95% withdrawn from a deposit of at least $5,000 | Medium |
| Unusual volume | At least 5× the usual daily count | Medium |
| Circular flows | $10,000 or more in the loop | Medium |
| Multiple accounts | 4 or more linked accounts | Medium |

### How alerts change over time

- **Growing evidence updates the alert.** A longer chain or a further deposit in the same window changes the existing alert and doesn't create a second one.
- **Linked groups can merge.** If a new account connects two linked groups, they become one alert and the other alert disappears from the list.
- **Alerts stay on record.** An alert isn't removed if a later run stops reporting it. For example, later wagers could take a cash-out below the detector's limits, and the alert would still show what was flagged at the time.

---

## 7. Investigation panel

Click an alert anywhere on the screen to open this panel. Close it with **×** or the **Esc** key. It refreshes by itself if new evidence changes the alert.

| Section | What it shows |
|---|---|
| **Header** | The alert ID, a Synthetic tag, the title, priority and detector. |
| **Summary** | The full description of what happened. |
| **Indicator, not proof** | A reminder that automated detection can't establish intent or wrongdoing. |
| **Why this was flagged** | Each condition tested (see below). |
| **Shared identifiers** | Multiple-account alerts only: each shared phone, email or card, and the accounts using it. |
| **Transaction timeline** | The transactions behind the alert, oldest first, with amount, time in UTC, type and ID. It may say there are no recorded transactions, because accounts can be linked before they transact. |
| **Accounts involved** | One card per account, with its overall transactions, money sent and received. **Also in** links to other alerts that name the same account. |
| **Possible innocent explanations** | Ordinary reasons the pattern could occur. Consider these before drawing any conclusion. |
| **Suggested next steps** | What an analyst could check next. |
| **Raw detector output** | Expand this to see exactly what the detector returned. |
| **Footer line** | When the alert was first detected and last updated, in UTC, and its revision number. |

### Reading "Why this was flagged"

| Column | Meaning |
|---|---|
| **✓ Condition** | A rule the detector tested. A tick means the rule is met. |
| **Observed** | The value in this alert. |
| **Limit** | The limit the detector requires. `≥ 3` means 3 or more, and `≤ 15 min` means 15 minutes or less. |

For example, this row means the chain had 4 hops, and the detector requires at least 3:

| Condition | Observed | Limit |
|---|---|---|
| ✓ Hops in the chain | 4 | ≥ 3 |

Some conditions have notes worth knowing:

| Condition | Note |
|---|---|
| **Smallest ÷ largest amount** | 1.00 means identical amounts. 0.92 means the smallest is 92% of the largest. |
| **Share of deposit withdrawn / wagered** | Shown as a decimal, so 0.99 means 99%. |
| **Length of the window** (structuring) | The time window the detector uses, so its observed value always equals its limit. |
| **Z-score against history** | How many standard deviations the day's count is above the account's history. Higher means more unusual. |

### Notes under the table

- **No variation in history (unusual volume):** if an account's history is perfectly even, a true z-score can't be calculated. The detector reports a nominal score just above the limit, so don't compare that number with other alerts. The seed `VOLUME_A` alert is an example.
- **No time limit (circular flows):** the transfers in a loop may be far apart, so check the dates in the timeline.
- **Priority:** the reason for this alert's priority.

---

## The six alerts you see at the start

These come from running the detectors on the seed data. They aren't hardcoded, and each one has its own scenario in the seed.

| ID | Detector | Priority | Finding |
|---|---|---|---|
| CG-0006 | Unusual volume | High | `VOLUME_A` had 20 transactions on 2026-11-05, about 10× its usual 2 per active day. |
| CG-0005 | Rapid cash-outs | High | `CASH_A` withdrew 99% of a $9,000 deposit after 15 minutes, with $100 wagered. |
| CG-0004 | Circular flows | High | $14,700 looped through `CIRCLE_A`, `CIRCLE_B` and `CIRCLE_C`. |
| CG-0003 | Multiple accounts | Medium | `LINK_A` and `LINK_B` share a phone number and payment card. They have no transactions, so its timeline is empty. |
| CG-0002 | Structuring | Medium | `STRUCT_A` made 3 deposits totalling $10,500 within 60 minutes. |
| CG-0001 | Suspicious chains | Medium | $14,700 moved through `CHAIN_A` to `CHAIN_D` in 8 minutes. |

`PLAYER001` also appears in the seed data as normal activity, with no alerts.

---

## Databricks mode

When `CASINOGUARD_DATA_SOURCE=databricks`, alerts come straight from the Databricks table `aml_alerts_gold` and CASINOGUARD doesn't run any detectors. These parts of the screen change:

| Area | In Databricks mode |
|---|---|
| **Header** | A blue **Source: Databricks** badge appears. **Synthetic data** shows only while the data is labelled synthetic (`CASINOGUARD_DATA_CLASSIFICATION`). |
| **Red banner** | "Couldn't load from Databricks" means the last load failed, for example because of a rejected token or a missing table. The screen keeps the last good data, and the banner says so. |
| **Tiles** | They count what Databricks returned: **Alerts from Databricks**, and transactions **Loaded from Databricks**. |
| **Left panel** | **Data source** replaces the simulator (see below). |
| **Transaction stream** | Every row's Source is **Databricks**. |
| **Alert IDs** | Databricks IDs are 64-character hashes, so the screen shows the first 8 characters. Hover to see the full ID; the investigation panel shows it in full. |
| **Alert times** | "11m ago" counts from the row's `detected_at`, which is when Databricks detected it. |
| **Detectors** | Only five appear. Multiple-account activity is intentionally excluded from the Databricks pipeline. |
| **Blue banner** | A simulation is running, and the results on screen are from before it. |

### Data source panel

| Item | Meaning |
|---|---|
| **Connected / Loading / Refresh failed** | The state of the last load from Databricks. |
| **Full simulation / Individual** | Full embeds all five suspicious patterns in a day of ordinary activity. Individual embeds one, chosen from the five detectors. All five detectors run either way. |
| **Simulate data** | Generates the data, uploads it to Databricks and runs the pipeline job, showing each step as it happens: generate, upload, run, check freshness, load. A failed step is marked ✕ with Databricks' error and a link to the job run. It's disabled until a job is configured. |
| **Scenario and seed** | The mode that ran, and the random seed that produced its data. |
| **Embedded vs detected** | After a run: ✓ for each embedded pattern that Databricks detected, with a link to the alert; ✕ for a missed one; ! for an alert that wasn't embedded. Green means an exact match. Amber means Databricks' results differ, but the alerts shown are still exactly what Databricks returned. |
| **Refresh from Databricks** | Reloads alerts, transactions and accounts now. A stopped warehouse can take a minute to start. Afterwards it shows "Updated with new data." or "Already up to date." |
| **Workspace, SQL warehouse** | Which Databricks workspace and warehouse the backend queries. |
| **Last loaded** | When the last successful load finished, in UTC. |
| **Alert rows read** | Rows in the alerts table, including any that couldn't be shown. |
| **Tables** | The three tables used for alerts, transactions and account profiles. |
| **Rows not shown** | Rows with an unknown pattern or unreadable evidence, with the reason for each. Fix them in the Databricks pipeline. |

### Investigation panel differences

- **Blue Databricks tag:** shown next to the alert ID.
- **Red "Not every condition below is met" warning:** the evidence Databricks supplied doesn't satisfy the detector's rules. This alert needs checking upstream. For example, the current circular alerts list `CIRCLE_B → CIRCLE_C → CIRCLE_B`, which has only 2 distinct accounts, while a loop needs at least 3.
- **Data quality note:** an account appears more than once in the alert's account list.
- **Limits:** these come from the row's `thresholds_json`, the values the Databricks pipeline used. If a row has none, CASINOGUARD's reference values are shown, with a note saying so.
- **Source line:** at the bottom, it names the table and the full Databricks alert ID.
