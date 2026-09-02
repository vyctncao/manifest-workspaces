---
'manifest': patch
---

Drop a nested param entirely when the value it depends on becomes inapplicable, so Anthropic no longer receives a `thinking` object without a `type` at the top effort levels, and strip empty web-search domain filters before forwarding.
