---
'manifest': patch
---

Stop the dashboard refetching behind a hidden tab, and stop polling Auto-fix cohort eligibility every 15 seconds. SSE message bumps are now deferred while the tab is backgrounded and settled in a single catch-up when it returns, and the notification bell's 15s poll (which drove `/autofix/cohort` to 59% of all dashboard API traffic) is limited to the toggle state it was actually watching.
