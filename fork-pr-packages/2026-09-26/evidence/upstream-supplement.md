# Supplemental upstream observations

Observed through GitHub's public pull-request pages on 2026-09-26. These observations supersede cache-miss limitations in the source-review artifacts. No messages or PRs were sent. Review comments on other PRs are not proof that this fork head passes CI.

- [PR11910](https://github.com/paperclipai/paperclip/pull/11910) is open. It preserves connection usability after a per-call timeout or a JSON-RPC application error. It does not provide the fork's broader ambiguous-write no-replay contract. Recommend a focused separate contribution for that extra outcome, coordinated with the existing timeout fix; do not duplicate its basic change without attribution.
- [PR10784](https://github.com/paperclipai/paperclip/pull/10784) is open. It adds redaction for two unsupported authentication header names. Change05 also sanitizes managed gateway paths, serialized errors, free text, direct logger calls and child bindings. A separate focused PR can be justified by this broader logging boundary; cite this overlap and avoid claiming the two-header fix is new.
- [PR5951](https://github.com/paperclipai/paperclip/pull/5951) is open. It removes return-assignee exclusion from the approved transition. Change06 retains independent participant preference and covers consecutive stages. Recommend a credited successor or contribution to that PR after the missing concurrency proof is settled. The existing PR has a changes-requested review asking for template compliance and integration with newer stage traversal.

No observed page establishes a released equivalent for Changes04,05,06. No retirement recommendation is justified without a passing regression on the released upstream implementation.
