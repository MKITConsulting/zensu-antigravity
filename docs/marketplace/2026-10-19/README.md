# Antigravity Marketplace submission evidence

This directory preserves the evidence from the Google Antigravity publisher interest
form submitted on 2026-10-19 for Zensu, using `integrations@zensu.dev` as the contact
and `https://zensu.dev/antigravity/` as the documentation URL.

- [Google confirmation screenshot](marketplace-submitted.png): the original browser
  capture showing that the response was sent. Google's German interface is preserved
  unchanged as source evidence.
- [Submission record](marketplace-submission.json): the original locally recorded
  form URL, confirmation text, contact and related publication and CI verification.
- [SHA-256 checksums](SHA256SUMS): hashes of the two original files, copied byte-for-byte
  from the local evidence directory into version control.

The record's `recordedAt` value is `2026-10-19T17:07:30Z` (19:07:30 Europe/Berlin).
It is the local recording time, not a Google-issued submission timestamp. The record
also includes verification added later that day, including the documentation PR's
successful main CI.

The screenshot confirms successful form submission. It does not display the submitted
field values, a receipt number or Marketplace approval. The JSON is an operator record,
not a receipt issued by Google. Google's confirmation text remains verbatim in both
files; all explanatory documentation is in English.

Verify the archive from this directory:

```bash
shasum -a 256 -c SHA256SUMS
```

Keep these historical files unchanged. Record later correspondence or approval as a new
dated entry and update the current status in [the distribution guide](../../distribution.md).
